/**
 * Tests for the refactored typed-data encoding pipeline: the parsed type
 * graph, the value walker (via the event recorder contract), the byte
 * encoder, error paths, and the large-array allocation benchmark.
 */
import { assert } from '@metamask/utils';

import { SignTypedDataVersion, TypedDataUtils } from '../sign-typed-data';
import { ByteEncoder } from './byte-encoder';
import { TypeDependencyGraph } from './dependency-graph';
import { TypedDataEncodingError } from './encoding-error';
import { V3_ENCODING_POLICY, V4_ENCODING_POLICY } from './encoding-policy';
import { parseTypeNode } from './type-parser';
import { walkTypedValue } from './value-walker';
import type { TypedValueEvent } from './value-walker';

const mailTypes = {
  Person: [
    { name: 'name', type: 'string' },
    { name: 'wallet', type: 'address' },
  ],
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person[]' },
    { name: 'contents', type: 'string' },
  ],
};

const mailMessage = {
  from: {
    name: 'Cow',
    wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
  },
  to: [{ name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' }],
  contents: 'Hello, Bob!',
};

/**
 * A test sink that records every event it receives.
 *
 * @returns The recorder and the recorded events.
 */
function createEventRecorder() {
  const events: TypedValueEvent[] = [];
  return {
    events,
    sink: {
      emit: (event: TypedValueEvent) => events.push(event),
    },
  };
}

describe('TypeDependencyGraph', () => {
  it('parses each distinct type string at most once', () => {
    const graph = new TypeDependencyGraph(mailTypes);

    expect(graph.parseType('Person')).toBe(graph.parseType('Person'));
    expect(graph.parseType('Person[]')).toBe(graph.parseType('Person[]'));
    const arrayNode = graph.parseType('Person[]');
    assert(arrayNode.kind === 'array');
    expect(arrayNode.element).toBe(graph.parseType('Person'));
  });

  it('hashes each struct type at most once', () => {
    const graph = new TypeDependencyGraph(mailTypes);

    expect(graph.getTypeHash('Person')).toBe(graph.getTypeHash('Person'));
    expect(graph.getCanonicalTypeString('Mail')).toBe(
      graph.getCanonicalTypeString('Mail'),
    );
  });

  it('orders dependencies canonically: primary type first, then sorted', () => {
    const types = {
      Zebra: [{ name: 'stripes', type: 'uint8' }],
      Apple: [{ name: 'z', type: 'Zebra' }],
      Mail: [
        { name: 'a', type: 'Apple' },
        { name: 'z', type: 'Zebra' },
      ],
    };
    const graph = new TypeDependencyGraph(types);

    expect(graph.getCanonicalTypeString('Mail')).toBe(
      'Mail(Apple a,Zebra z)Apple(Zebra z)Zebra(uint8 stripes)',
    );
  });
});

describe('parseTypeNode', () => {
  const isStruct = (name: string) => name === 'Person';

  it('produces a struct node for defined types', () => {
    expect(parseTypeNode('Person', isStruct)).toStrictEqual({
      kind: 'struct',
      name: 'Person',
      source: 'Person',
    });
  });

  it('produces primitive nodes with parsed widths', () => {
    expect(parseTypeNode('uint256', isStruct)).toStrictEqual({
      kind: 'primitive',
      family: 'uint',
      width: 256,
      source: 'uint256',
    });
    expect(parseTypeNode('int8', isStruct)).toStrictEqual({
      kind: 'primitive',
      family: 'int',
      width: 8,
      source: 'int8',
    });
    expect(parseTypeNode('bytes4', isStruct)).toStrictEqual({
      kind: 'primitive',
      family: 'fixedBytes',
      width: 4,
      source: 'bytes4',
    });
    expect(parseTypeNode('address', isStruct)).toStrictEqual({
      kind: 'primitive',
      family: 'address',
      width: null,
      source: 'address',
    });
    expect(parseTypeNode('string', isStruct)).toStrictEqual({
      kind: 'primitive',
      family: 'string',
      width: null,
      source: 'string',
    });
  });

  it('produces nested array nodes with declared lengths', () => {
    expect(parseTypeNode('Person[3][]', isStruct)).toStrictEqual({
      kind: 'array',
      element: {
        kind: 'array',
        element: { kind: 'struct', name: 'Person', source: 'Person' },
        length: 3,
        source: 'Person[3]',
      },
      length: null,
      source: 'Person[3][]',
    });
  });

  it('produces an unsupported node for the function type', () => {
    expect(parseTypeNode('function', isStruct)).toStrictEqual({
      kind: 'unsupported',
      source: 'function',
    });
  });

  it('produces an unknown primitive node for unrecognized types', () => {
    expect(parseTypeNode('foo', isStruct)).toStrictEqual({
      kind: 'primitive',
      family: 'unknown',
      width: null,
      source: 'foo',
    });
  });
});

describe('value walker event recorder contract', () => {
  it('emits a balanced event stream with value paths', () => {
    const graph = new TypeDependencyGraph(mailTypes);
    const recorder = createEventRecorder();

    walkTypedValue({
      graph,
      primaryType: 'Mail',
      value: mailMessage,
      policy: V4_ENCODING_POLICY,
      sink: recorder.sink,
    });

    const kindAndPath = recorder.events.map((event) => [
      event.kind,
      event.path,
    ]);
    expect(kindAndPath).toStrictEqual([
      ['structStart', 'Mail'],
      ['structStart', 'Mail.from'],
      ['leaf', 'Mail.from.name'],
      ['leaf', 'Mail.from.wallet'],
      ['structEnd', 'Mail.from'],
      ['arrayStart', 'Mail.to'],
      ['structStart', 'Mail.to[0]'],
      ['leaf', 'Mail.to[0].name'],
      ['leaf', 'Mail.to[0].wallet'],
      ['structEnd', 'Mail.to[0]'],
      ['arrayEnd', 'Mail.to'],
      ['leaf', 'Mail.contents'],
      ['structEnd', 'Mail'],
    ]);

    // Struct events carry the same type hash as the public API.
    const [mailStart, personStart] = recorder.events;
    expect(mailStart).toMatchObject({ typeName: 'Mail' });
    expect(personStart).toMatchObject({ typeName: 'Person' });
    expect(
      Buffer.from((mailStart as { typeHash: Uint8Array }).typeHash).toString(
        'hex',
      ),
    ).toBe(TypedDataUtils.hashType('Mail', mailTypes).toString('hex'));
    expect(
      Buffer.from((personStart as { typeHash: Uint8Array }).typeHash).toString(
        'hex',
      ),
    ).toBe(TypedDataUtils.hashType('Person', mailTypes).toString('hex'));

    // Leaf events carry normalized ABI type/value pairs.
    expect(recorder.events[2]).toMatchObject({ abiType: 'bytes32' });
    expect(recorder.events[3]).toMatchObject({
      abiType: 'address',
      value: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
    });
  });

  it('drives the byte encoder to the same result as the public API', () => {
    const graph = new TypeDependencyGraph(mailTypes);
    const recorder = createEventRecorder();

    walkTypedValue({
      graph,
      primaryType: 'Mail',
      value: mailMessage,
      policy: V4_ENCODING_POLICY,
      sink: recorder.sink,
    });

    // Replay the recorded events into a fresh encoder.
    const encoder = new ByteEncoder();
    for (const event of recorder.events) {
      encoder.emit(event);
    }

    expect(Buffer.from(encoder.getResult()).toString('hex')).toBe(
      TypedDataUtils.encodeData(
        'Mail',
        mailMessage,
        mailTypes,
        SignTypedDataVersion.V4,
      ).toString('hex'),
    );
  });

  it('only visits declared fields, ignoring extra message properties', () => {
    const graph = new TypeDependencyGraph({
      Message: [{ name: 'data', type: 'string' }],
    });
    const recorder = createEventRecorder();

    walkTypedValue({
      graph,
      primaryType: 'Message',
      value: { data: 'hello', extra: 'ignored', another: 42 },
      policy: V4_ENCODING_POLICY,
      sink: recorder.sink,
    });

    expect(recorder.events.map((event) => event.kind)).toStrictEqual([
      'structStart',
      'leaf',
      'structEnd',
    ]);
  });

  it('skips undefined fields under the V3 policy', () => {
    const graph = new TypeDependencyGraph({
      Message: [
        { name: 'data', type: 'string' },
        { name: 'missing', type: 'string' },
      ],
    });
    const recorder = createEventRecorder();

    walkTypedValue({
      graph,
      primaryType: 'Message',
      value: { data: 'hello', missing: undefined },
      policy: V3_ENCODING_POLICY,
      sink: recorder.sink,
    });

    expect(recorder.events.map((event) => event.kind)).toStrictEqual([
      'structStart',
      'leaf',
      'structEnd',
    ]);
  });
});

describe('error paths', () => {
  it('includes the path of a missing nested field', () => {
    const message = {
      from: {
        name: 'Cow',
        wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
      },
      to: [{ wallet: ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'] }],
      contents: 'Hello, Bob!',
    };

    let error: unknown;
    try {
      TypedDataUtils.encodeData(
        'Mail',
        message,
        mailTypes,
        SignTypedDataVersion.V4,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TypedDataEncodingError);
    expect((error as TypedDataEncodingError).path).toBe('Mail.to[0].name');
    expect((error as Error).message).toBe(
      'missing value for field name of type string (at path: Mail.to[0].name)',
    );
  });

  it('includes the path of a failing array element', () => {
    const types = {
      Message: [{ name: 'values', type: 'bool[]' }],
    };

    expect(() =>
      TypedDataUtils.encodeData(
        'Message',
        { values: [true, false, 1] },
        types,
        SignTypedDataVersion.V4,
      ),
    ).toThrow(
      'Unable to encode value: Invalid bool. Expected a boolean or the string "true" or "false", but received "1". (at path: Message.values[2])',
    );
  });

  it('includes the path of an unsupported function field', () => {
    const types = {
      Message: [{ name: 'callback', type: 'function' }],
    };

    expect(() =>
      TypedDataUtils.encodeData(
        'Message',
        { callback: 1 },
        types,
        SignTypedDataVersion.V4,
      ),
    ).toThrow(
      'Unsupported or invalid type: "function" (at path: Message.callback)',
    );
  });

  it('includes the path of an array field in V3', () => {
    const types = {
      Message: [{ name: 'values', type: 'uint8[]' }],
    };

    expect(() =>
      TypedDataUtils.encodeData(
        'Message',
        { values: [1, 2, 3] },
        types,
        SignTypedDataVersion.V3,
      ),
    ).toThrow(
      'Arrays are unimplemented in encodeData; use V4 extension (at path: Message.values)',
    );
  });

  it('includes the struct path when the ABI encoder rejects a value', () => {
    const types = {
      Message: [{ name: 'data', type: 'foo' }],
    };

    expect(() =>
      TypedDataUtils.encodeData(
        'Message',
        { data: 1 },
        types,
        SignTypedDataVersion.V4,
      ),
    ).toThrow(
      'Unable to encode value: The type "foo" is not supported. (at path: Message)',
    );
  });

  it('does not echo secret values from other fields in errors', () => {
    const secret = `0x${'secret'.repeat(100)}`;
    const types = {
      Message: [
        { name: 'payload', type: 'string' },
        { name: 'length', type: 'int32' },
      ],
    };

    let error: unknown;
    try {
      TypedDataUtils.encodeData(
        'Message',
        { payload: secret },
        types,
        SignTypedDataVersion.V4,
      );
    } catch (caught) {
      error = caught;
    }

    expect((error as Error).message).toContain(
      'missing value for field length of type int32',
    );
    expect((error as Error).message).toContain('(at path: Message.length)');
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).not.toContain('secret');
  });
});

describe('large-array allocation benchmark', () => {
  const types = {
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'scores', type: 'uint256[]' },
      { name: 'people', type: 'Person[]' },
    ],
  };

  const SCORE_COUNT = 10_000;
  const PERSON_COUNT = 2_000;

  const buildMessage = () => ({
    scores: Array.from({ length: SCORE_COUNT }, (_, index) => index),
    people: Array.from({ length: PERSON_COUNT }, (_, index) => ({
      name: `Person ${index}`,
      wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
    })),
  });

  it('encodes large arrays byte-identically to the baseline implementation', () => {
    const message = buildMessage();

    // Frozen from the baseline implementation (commit 996ac29).
    expect(
      TypedDataUtils.encodeData(
        'Mail',
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex'),
    ).toBe(
      '53844a281cbb010b720110de35ced0b92a15e37e128d6d9217b3f103c11437b4a841eb16f95d58c72961914ddedb47e281051b487ec7ab0092a188d1c2a144d784953e65d9ad9e4c4f67d59a0ca26468b718e789597bb53d7619fa48ecbdd0e7',
    );
    expect(
      TypedDataUtils.hashStruct(
        'Mail',
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex'),
    ).toBe('af40a9b5ecf3f6c73109f867521b6cda39a7a8bbdecf5e3dc6ffcbadc24a5472');
  }, 20_000);

  it('does not construct duplicate intermediate objects per array element', () => {
    const graph = new TypeDependencyGraph(types);
    const canonicalTypeSpy = jest.spyOn(graph, 'getCanonicalTypeString');
    const recorder = createEventRecorder();

    walkTypedValue({
      graph,
      primaryType: 'Mail',
      value: buildMessage(),
      policy: V4_ENCODING_POLICY,
      sink: recorder.sink,
    });

    // Exactly one event per value: 2 events per struct (start/end), 2 per
    // array (start/end), and 1 per leaf. No per-element re-walking.
    expect(recorder.events).toHaveLength(
      2 + // Mail struct
        2 + // scores array
        SCORE_COUNT + // score leaves
        2 + // people array
        PERSON_COUNT * (2 + 2) + // Person structs with 2 leaves each
        0,
    );

    // The canonical type string of each struct type is built exactly once,
    // no matter how many struct instances appear in the message. The
    // legacy implementation rebuilt it for every instance.
    expect(canonicalTypeSpy.mock.calls).toHaveLength(2);

    // Type nodes and type hashes are shared instances, not per-element
    // copies.
    expect(graph.parseType('Person')).toBe(graph.parseType('Person'));
    expect(graph.getTypeHash('Person')).toBe(graph.getTypeHash('Person'));
  }, 20_000);
});
