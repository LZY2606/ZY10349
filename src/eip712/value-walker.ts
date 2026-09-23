import { arrToBufArr } from '@ethereumjs/util';
import { getLength } from '@metamask/abi-utils/dist/parsers';
import { padStart } from '@metamask/abi-utils/dist/utils';
import {
  add0x,
  assert,
  bigIntToBytes,
  hexToBytes,
  isStrictHexString,
  numberToBytes,
  stringToBytes,
} from '@metamask/utils';
import { keccak256 } from 'ethereum-cryptography/keccak';

import type { TypeDependencyGraph } from './dependency-graph';
import { TypedDataEncodingError } from './encoding-error';
import type { EncodingPolicy } from './encoding-policy';
import type { PrimitiveTypeNode, TypeNode } from './type-parser';

/**
 * The encoding of a `null` struct value in `V4`: 32 zero bytes, as a
 * '0x'-prefixed hex string. This matches the legacy implementation, which
 * returned this exact string from `encodeField`.
 */
const NULL_STRUCT_ENCODING =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * A leaf event: a single normalized value, ready to be consumed by the byte
 * encoder. The `abiType` and `value` pair is exactly what the legacy
 * `encodeField` implementation returned.
 */
export type LeafEvent = {
  kind: 'leaf';
  /** The path of the value, e.g. `Mail.to[1].wallet`. */
  path: string;
  /** The ABI type to encode the value as. */
  abiType: string;
  /** The normalized value. */
  value: unknown;
};

/**
 * Marks the start of a struct value. Carries the hash of the canonical type
 * string, so the encoder never has to interpret type strings itself.
 */
export type StructStartEvent = {
  kind: 'structStart';
  /** The path of the struct, e.g. `Mail.to[1]`. */
  path: string;
  /** The name of the struct type. */
  typeName: string;
  /** The EIP-712 hash of the canonical type string. */
  typeHash: Uint8Array;
};

/**
 * Marks the end of a struct value.
 */
export type StructEndEvent = {
  kind: 'structEnd';
  /** The path of the struct. */
  path: string;
  /** The name of the struct type. */
  typeName: string;
};

/**
 * Marks the start of an array value.
 */
export type ArrayStartEvent = {
  kind: 'arrayStart';
  /** The path of the array, e.g. `Mail.to`. */
  path: string;
  /** The original type string of the array, e.g. `Person[]`. */
  source: string;
};

/**
 * Marks the end of an array value.
 */
export type ArrayEndEvent = {
  kind: 'arrayEnd';
  /** The path of the array. */
  path: string;
};

/**
 * An event emitted by the value walker. Events form a balanced tree:
 * `structStart`/`structEnd` and `arrayStart`/`arrayEnd` pairs are properly
 * nested, and `leaf` events only occur inside a struct or array.
 */
export type TypedValueEvent =
  | LeafEvent
  | StructStartEvent
  | StructEndEvent
  | ArrayStartEvent
  | ArrayEndEvent;

/**
 * A consumer of typed value events, e.g. the {@link ByteEncoder} or a test
 * recorder.
 */
export type TypedValueEventSink = {
  /**
   * Consume a single typed value event.
   *
   * @param event - The event to consume.
   */
  emit: (event: TypedValueEvent) => void;
};

/**
 * Options for {@link walkTypedValue}.
 */
export type WalkTypedValueOptions = {
  /** The type dependency graph of the message. */
  graph: TypeDependencyGraph;
  /** The primary type of the message. */
  primaryType: string;
  /** The message value to walk. */
  value: unknown;
  /** The version-specific encoding policy. */
  policy: EncodingPolicy;
  /** The event sink to emit events to. */
  sink: TypedValueEventSink;
};

/**
 * The shared context of a single walk.
 */
type WalkContext = {
  graph: TypeDependencyGraph;
  policy: EncodingPolicy;
  sink: TypedValueEventSink;
};

/**
 * Parse a string, number, or bigint value into a `bigint`.
 *
 * @param type - The type of the value.
 * @param value - The value to parse.
 * @param path - The path of the value, included in thrown errors. When
 * omitted, the error messages are identical to the legacy implementation.
 * @returns The parsed value.
 */
export function parseNumber(
  type: string,
  value: string | number | bigint,
  path?: string,
) {
  assert(
    value !== null,
    `Unable to encode value: Invalid number. Expected a valid number value, but received "${value}".${pathSuffix(
      path,
    )}`,
  );

  const bigIntValue = BigInt(value);

  const length = getLength(type);
  const maxValue = BigInt(2) ** BigInt(length) - BigInt(1);

  // Note that this is not accurate, since the actual maximum value for unsigned
  // integers is `2 ^ (length - 1) - 1`, but this is required for backwards
  // compatibility with the old implementation.
  assert(
    bigIntValue >= -maxValue && bigIntValue <= maxValue,
    `Unable to encode value: Number "${value}" is out of range for type "${type}".${pathSuffix(
      path,
    )}`,
  );

  return bigIntValue;
}

/**
 * Normalize a value for the Solidity `bool` type. Only real booleans and the
 * exact strings `'true'` and `'false'` are accepted; anything else is rejected.
 *
 * The previous `Boolean(value)` implementation was a signing footgun: every
 * non-empty string is truthy, so a `bool` field supplied as the string
 * `'false'` was signed as `true` while UIs stringifying the raw value displayed
 * `'false'`. Rejecting ambiguous input keeps the signed value consistent with
 * what was requested.
 *
 * @param value - The value to normalize.
 * @param path - The path of the value, included in thrown errors. When
 * omitted, the error message is identical to the legacy implementation.
 * @returns The normalized boolean.
 * @throws If the value is not a boolean or the string `'true'` or `'false'`.
 */
export function normalizeBool(value: unknown, path?: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(
    `Unable to encode value: Invalid bool. Expected a boolean or the string "true" or "false", but received "${String(
      value,
    )}".${pathSuffix(path)}`,
  );
}

/**
 * Parse an address string to a `Uint8Array`. The behaviour of this is quite
 * strange, in that it does not parse the address as hexadecimal string, nor as
 * UTF-8. It does some weird stuff with the string and char codes, and then
 * returns the result as a `Uint8Array`.
 *
 * This is based on the old `ethereumjs-abi` implementation, which essentially
 * calls `new BN(address, 10)` on the address string, the equivalent of calling
 * `parseInt(address, 10)` in JavaScript. This is not a valid way to parse an
 * address and would result in `NaN` in plain JavaScript, but it is the
 * behaviour of the old implementation, and so we must preserve it for backwards
 * compatibility.
 *
 * @param address - The address to parse.
 * @returns The parsed address.
 */
function reallyStrangeAddressToBytes(address: string): Uint8Array {
  let addressValue = BigInt(0);

  for (let i = 0; i < address.length; i++) {
    const character = BigInt(address.charCodeAt(i) - 48);
    addressValue *= BigInt(10);

    // 'a'
    if (character >= 49) {
      addressValue += character - BigInt(49) + BigInt(0xa);

      // 'A'
    } else if (character >= 17) {
      addressValue += character - BigInt(17) + BigInt(0xa);

      // '0' - '9'
    } else {
      addressValue += character;
    }
  }

  return padStart(bigIntToBytes(addressValue), 20);
}

/**
 * Format the path suffix of an error message.
 *
 * @param path - The path of the value, or `undefined` for no suffix.
 * @returns The path suffix.
 */
function pathSuffix(path: string | undefined): string {
  return path === undefined ? '' : ` (at path: ${path})`;
}

/**
 * Normalize a primitive value into an ABI-encodable `[type, value]` pair.
 * This is exactly the leaf behaviour of the legacy `encodeField`
 * implementation.
 *
 * @param node - The parsed primitive type.
 * @param value - The value to normalize.
 * @param path - The path of the value, used in error messages.
 * @returns The ABI type and normalized value.
 */
function normalizePrimitive(
  node: PrimitiveTypeNode,
  // TODO: constrain type on `value`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  path: string,
): [type: string, value: unknown] {
  switch (node.family) {
    case 'address':
      if (typeof value === 'number') {
        return ['address', padStart(numberToBytes(value), 20)];
      } else if (isStrictHexString(value)) {
        return ['address', add0x(value)];
      } else if (typeof value === 'string') {
        return ['address', reallyStrangeAddressToBytes(value).subarray(0, 20)];
      }
      return [node.source, value];

    case 'bool':
      return ['bool', normalizeBool(value, path)];

    case 'bytes': {
      let bytesValue = value;
      if (typeof bytesValue === 'number') {
        bytesValue = numberToBytes(bytesValue);
      } else if (isStrictHexString(bytesValue) || bytesValue === '0x') {
        bytesValue = hexToBytes(bytesValue);
      } else if (typeof bytesValue === 'string') {
        bytesValue = stringToBytes(bytesValue);
      }
      return ['bytes32', arrToBufArr(keccak256(bytesValue))];
    }

    case 'fixedBytes':
      if (typeof value === 'number') {
        if (value < 0) {
          return ['bytes32', new Uint8Array(32)];
        }

        return ['bytes32', bigIntToBytes(BigInt(value))];
      } else if (isStrictHexString(value)) {
        return ['bytes32', hexToBytes(value)];
      }

      return ['bytes32', value];

    case 'int': {
      const bigIntValue = parseNumber(node.source, value, path);
      if (bigIntValue >= BigInt(0)) {
        return ['uint256', bigIntValue];
      }

      return ['int256', bigIntValue];
    }

    case 'string': {
      const stringValue =
        typeof value === 'number'
          ? numberToBytes(value)
          : stringToBytes(value ?? '');
      return ['bytes32', arrToBufArr(keccak256(stringValue))];
    }

    default:
      // `uintN` and unrecognized types are passed through to the ABI encoder
      // unchanged, so that its validation and error messages are preserved.
      return [node.source, value];
  }
}

/**
 * Walk a struct value, emitting events for the struct and each of its
 * declared fields. Fields that are not declared in the type definitions are
 * never visited, so extra message properties are ignored by construction.
 *
 * @param context - The walk context.
 * @param typeName - The name of the struct type.
 * @param value - The struct value.
 * @param path - The path of the struct.
 */
function walkStruct(
  context: WalkContext,
  typeName: string,
  value: unknown,
  path: string,
): void {
  const { graph, policy, sink } = context;
  sink.emit({
    kind: 'structStart',
    path,
    typeName,
    typeHash: graph.getTypeHash(typeName),
  });

  for (const field of graph.getFields(typeName)) {
    // Reading the field of a `null` value throws a `TypeError`, which
    // matches the behaviour of the legacy implementation.
    const fieldValue = (value as Record<string, unknown>)[field.name];
    if (fieldValue === undefined && policy.skipUndefinedFields) {
      continue;
    }
    walkNode(
      context,
      graph.parseType(field.type),
      fieldValue,
      field.name,
      `${path}.${field.name}`,
    );
  }

  sink.emit({ kind: 'structEnd', path, typeName });
}

/**
 * Walk a single value of the given parsed type, emitting events to the sink.
 *
 * @param context - The walk context.
 * @param node - The parsed type of the value.
 * @param value - The value to walk.
 * @param fieldName - The name of the field the value belongs to, used in
 * "missing value" errors.
 * @param path - The path of the value, e.g. `Mail.to[1].wallet`.
 */
function walkNode(
  context: WalkContext,
  node: TypeNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  fieldName: string,
  path: string,
): void {
  const { policy, sink } = context;

  if (node.kind === 'struct') {
    // eslint-disable-next-line no-eq-null
    if (value == null && policy.nullStructEncoding === 'zeroHash') {
      sink.emit({
        kind: 'leaf',
        path,
        abiType: 'bytes32',
        value: NULL_STRUCT_ENCODING,
      });
      return;
    }

    walkStruct(context, node.name, value, path);
    return;
  }

  if (node.kind === 'unsupported') {
    throw new TypedDataEncodingError(
      'Unsupported or invalid type: "function"',
      path,
    );
  }

  if (value === undefined) {
    throw new TypedDataEncodingError(
      `missing value for field ${fieldName} of type ${node.source}`,
      path,
    );
  }

  if (node.kind === 'array') {
    if (!policy.supportsArrays) {
      throw new TypedDataEncodingError(
        'Arrays are unimplemented in encodeData; use V4 extension',
        path,
      );
    }

    if (!Array.isArray(value)) {
      // The legacy implementation called `Array.prototype.map` on the raw
      // value, so non-array values (e.g. `null`) surface a `TypeError`.
      // Reproduce that behaviour.
      (value as { map: () => void }).map();
      throw new TypedDataEncodingError(
        'Unable to encode value: Expected an array value',
        path,
      );
    }

    sink.emit({ kind: 'arrayStart', path, source: node.source });
    for (let index = 0; index < value.length; index++) {
      walkNode(
        context,
        node.element,
        value[index],
        fieldName,
        `${path}[${index}]`,
      );
    }
    sink.emit({ kind: 'arrayEnd', path });
    return;
  }

  const [abiType, abiValue] = normalizePrimitive(node, value, path);
  sink.emit({ kind: 'leaf', path, abiType, value: abiValue });
}

/**
 * Walk a typed message value, emitting a balanced stream of typed value
 * events. The walker interprets the value against the parsed type graph
 * exactly once; all byte-level encoding is left to the sink.
 *
 * @param options - The walk options.
 * @param options.graph - The type dependency graph of the message.
 * @param options.primaryType - The primary type of the message.
 * @param options.value - The message value to walk.
 * @param options.policy - The version-specific encoding policy.
 * @param options.sink - The event sink to emit events to.
 */
export function walkTypedValue({
  graph,
  primaryType,
  value,
  policy,
  sink,
}: WalkTypedValueOptions): void {
  walkStruct({ graph, policy, sink }, primaryType, value, primaryType);
}
