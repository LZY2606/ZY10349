/**
 * Frozen behavior vectors.
 *
 * These vectors were captured from the implementation at the refactoring
 * baseline (commit 996ac292fe455429e76eff9576a5bd896cfe0952), before the
 * encoding pipeline was refactored into the parsed type graph, value walker,
 * and byte encoder. They freeze both the successful outputs (byte-for-byte)
 * and the failure categories (error messages) of the public API, so that any
 * behavioral drift introduced by the refactor fails loudly here.
 *
 * Error vectors assert that the frozen message is contained in the thrown
 * error: the refactored pipeline appends `(at path: ...)` context to some
 * errors, which is an intentional addition, not a behavior change.
 */
import {
  SignTypedDataVersion,
  TypedDataUtils,
  recoverTypedSignature,
  signTypedData,
  typedSignatureHash,
} from '../sign-typed-data';

const PRIVATE_KEY = Buffer.from(
  '4af1bceebf7f3634ec3cff8a2c38e51178d5d4ce585c52d6043e5e2cc3418bb0',
  'hex',
);

const mailTypes = {
  Person: [
    { name: 'name', type: 'string' },
    { name: 'wallet', type: 'address' },
  ],
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person' },
    { name: 'contents', type: 'string' },
  ],
};

const mailMessage = {
  from: {
    name: 'Cow',
    wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
  },
  to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
  contents: 'Hello, Bob!',
};

const mailTypedData = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    ...mailTypes,
  },
  primaryType: 'Mail' as const,
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: mailMessage,
};

const arrayTypes = {
  Person: [
    { name: 'name', type: 'string' },
    { name: 'wallet', type: 'address[]' },
  ],
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person[]' },
    { name: 'contents', type: 'string' },
    { name: 'scores', type: 'uint8[3]' },
    { name: 'matrix', type: 'int16[][]' },
  ],
};

const arrayMessage = {
  from: {
    name: 'Cow',
    wallet: [
      '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
      '0xDD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
    ],
  },
  to: [{ name: 'Bob', wallet: ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'] }],
  contents: 'Hello, Bob!',
  scores: [1, 2, 3],
  matrix: [[1, -2], [], [300]],
};

const arrayTypedData = {
  ...mailTypedData,
  types: { ...mailTypedData.types, ...arrayTypes },
  message: arrayMessage,
};

const recursiveTypes = {
  Person: [
    { name: 'name', type: 'string' },
    { name: 'mother', type: 'Person' },
    { name: 'father', type: 'Person' },
  ],
};

const recursiveMessage = {
  name: 'Child',
  mother: { name: 'Mom', mother: null, father: null },
  father: { name: 'Dad', mother: null, father: null },
};

const primitiveTypes = {
  Message: [
    { name: 'addr', type: 'address' },
    { name: 'flag', type: 'bool' },
    { name: 'data', type: 'bytes' },
    { name: 'hash', type: 'bytes32' },
    { name: 'small', type: 'bytes4' },
    { name: 'count', type: 'uint256' },
    { name: 'delta', type: 'int8' },
    { name: 'plainInt', type: 'int' },
    { name: 'plainUint', type: 'uint' },
    { name: 'text', type: 'string' },
  ],
};

const primitiveMessage = {
  addr: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
  flag: true,
  data: '0xdeadbeef',
  hash: `0x${'ab'.repeat(32)}`,
  small: '0x01020304',
  count: 12345,
  delta: -5,
  plainInt: -12345,
  plainUint: 6789,
  text: 'hello world',
};

const v1Data = [
  {
    name: 'from',
    type: 'address',
    value: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
  },
  { name: 'count', type: 'uint256', value: 100 },
  { name: 'delta', type: 'int32', value: -3 },
  { name: 'tags', type: 'string[]', value: ['a', 'b'] },
  {
    name: 'wallets',
    type: 'address[]',
    value: ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'],
  },
  { name: 'nums', type: 'int8[]', value: [1, -1] },
  { name: 'flag', type: 'bool', value: false },
  { name: 'blob', type: 'bytes', value: '0x1234' },
];

type FrozenVector = { ok: true; value: string } | { ok: false; error: string };

const FROZEN_VECTORS = new Map<string, FrozenVector>([
  [
    'encodeData mail V3',
    {
      ok: true,
      value:
        'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8cd54f074a4af31b4411ff6a60c9719dbd559c221c8ac3492d9d872b041d703d1b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8',
    },
  ],
  [
    'hashStruct mail V3',
    {
      ok: true,
      value: 'c52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e',
    },
  ],
  [
    'eip712Hash mail V3',
    {
      ok: true,
      value: 'be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
    },
  ],
  [
    'eip712DomainHash mail V3',
    {
      ok: true,
      value: 'f2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f',
    },
  ],
  [
    'encodeData primitives V3',
    {
      ok: true,
      value:
        '5a41e81bada32a8843fa4dfb993a798f12f8acfe7011368555658b27a0bc8dbd000000000000000000000000cd2a3d9f938e13cd947ec05abc7fe734df8dd8260000000000000000000000000000000000000000000000000000000000000001d4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1abababababababababababababababababababababababababababababababab01020304000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003039fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfc70000000000000000000000000000000000000000000000000000000000001a8547173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad',
    },
  ],
  [
    'hashStruct primitives V3',
    {
      ok: true,
      value: '3b1887211367cd76fcf3dc3da991eadd54eb56a4fe13194b8e1316607a63df82',
    },
  ],
  [
    'encodeData recursive V3',
    { ok: false, error: "Cannot read properties of null (reading 'name')" },
  ],
  [
    'hashStruct recursive V3',
    { ok: false, error: "Cannot read properties of null (reading 'name')" },
  ],
  [
    'encodeData arrays V3',
    {
      ok: false,
      error: 'Arrays are unimplemented in encodeData; use V4 extension',
    },
  ],
  [
    'hashStruct arrays V3',
    {
      ok: false,
      error: 'Arrays are unimplemented in encodeData; use V4 extension',
    },
  ],
  [
    'eip712Hash arrays V3',
    {
      ok: false,
      error: 'Arrays are unimplemented in encodeData; use V4 extension',
    },
  ],
  [
    'encodeData null struct V3',
    { ok: false, error: "Cannot read properties of null (reading 'name')" },
  ],
  [
    'encodeData undefined struct V3',
    {
      ok: true,
      value:
        'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8',
    },
  ],
  [
    'encodeData null atomic V3',
    {
      ok: false,
      error:
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null".',
    },
  ],
  [
    'encodeData undefined atomic V3',
    {
      ok: true,
      value:
        '5a41e81bada32a8843fa4dfb993a798f12f8acfe7011368555658b27a0bc8dbd000000000000000000000000cd2a3d9f938e13cd947ec05abc7fe734df8dd8260000000000000000000000000000000000000000000000000000000000000001d4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1abababababababababababababababababababababababababababababababab0102030400000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfc70000000000000000000000000000000000000000000000000000000000001a8547173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad',
    },
  ],
  ['encodeData null dynamic V3', { ok: false, error: 'Expected Uint8Array' }],
  [
    'encodeData undefined dynamic V3',
    {
      ok: true,
      value:
        '5a41e81bada32a8843fa4dfb993a798f12f8acfe7011368555658b27a0bc8dbd000000000000000000000000cd2a3d9f938e13cd947ec05abc7fe734df8dd8260000000000000000000000000000000000000000000000000000000000000001abababababababababababababababababababababababababababababababab01020304000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003039fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfc70000000000000000000000000000000000000000000000000000000000001a8547173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad',
    },
  ],
  [
    'encodeData null array V3',
    {
      ok: false,
      error: 'Arrays are unimplemented in encodeData; use V4 extension',
    },
  ],
  [
    'encodeData undefined array V3',
    {
      ok: false,
      error: 'Arrays are unimplemented in encodeData; use V4 extension',
    },
  ],
  [
    'encodeData extra fields V3',
    {
      ok: true,
      value:
        'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8cd54f074a4af31b4411ff6a60c9719dbd559c221c8ac3492d9d872b041d703d1b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8',
    },
  ],
  [
    'error function V3',
    { ok: false, error: 'Unsupported or invalid type: "function"' },
  ],
  [
    'error unknown type V3',
    {
      ok: false,
      error: 'Unable to encode value: The type "foo" is not supported.',
    },
  ],
  [
    'error missing primary V3',
    { ok: false, error: 'No type definition specified: Message' },
  ],
  [
    'error missing value V3',
    {
      ok: true,
      value: '677d925febebf13d532e3271c281b8eb2b67a0a88f2a6bf07123125c5c0b6b3e',
    },
  ],
  [
    'error bad bool V3',
    {
      ok: false,
      error:
        'Unable to encode value: Invalid bool. Expected a boolean or the string "true" or "false", but received "1".',
    },
  ],
  [
    'error int range V3',
    {
      ok: false,
      error:
        'Unable to encode value: Number "256" is out of range for type "int8".',
    },
  ],
  [
    'error uint negative V3',
    {
      ok: false,
      error:
        'An unexpected error occurred: Value must be a non-negative bigint.',
    },
  ],
  [
    'error bad bytes V3',
    {
      ok: false,
      error:
        'An unexpected error occurred: Expected a bytes-like value, got "test".',
    },
  ],
  [
    'error bad address V3',
    {
      ok: false,
      error:
        'Unable to encode value: Invalid address value. Expected address to be 20 bytes long, but received 21 bytes.',
    },
  ],
  [
    'error nested path V3',
    {
      ok: true,
      value:
        'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c84176af049bbb7b586058a09bfbea75fe4fb67014fd2c4f675546ac5d2b46ea58c3fea6c221b02b78eb2022dda7219a2f77c4b59cd7768ba47fd888f32dfd4dbf',
    },
  ],
  [
    'error array item path V3',
    {
      ok: false,
      error: 'Arrays are unimplemented in encodeData; use V4 extension',
    },
  ],
  [
    'sign mail V3',
    {
      ok: true,
      value:
        '0x6788ed43187435f321349f4a8736c989062431c45e460e04b5e10f46d66efeac0cd8c164c436e40f4a37ea18a196dc0ed67deece2e0a212fc8c70f0cfc086c821c',
    },
  ],
  [
    'recover mail V3',
    { ok: true, value: '0x29c76e6ad8f28bb1004902578fb108c507be341b' },
  ],
  [
    'encodeData mail V4',
    {
      ok: true,
      value:
        'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8cd54f074a4af31b4411ff6a60c9719dbd559c221c8ac3492d9d872b041d703d1b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8',
    },
  ],
  [
    'hashStruct mail V4',
    {
      ok: true,
      value: 'c52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e',
    },
  ],
  [
    'eip712Hash mail V4',
    {
      ok: true,
      value: 'be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
    },
  ],
  [
    'eip712DomainHash mail V4',
    {
      ok: true,
      value: 'f2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f',
    },
  ],
  [
    'encodeData primitives V4',
    {
      ok: true,
      value:
        '5a41e81bada32a8843fa4dfb993a798f12f8acfe7011368555658b27a0bc8dbd000000000000000000000000cd2a3d9f938e13cd947ec05abc7fe734df8dd8260000000000000000000000000000000000000000000000000000000000000001d4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1abababababababababababababababababababababababababababababababab01020304000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003039fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfc70000000000000000000000000000000000000000000000000000000000001a8547173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad',
    },
  ],
  [
    'hashStruct primitives V4',
    {
      ok: true,
      value: '3b1887211367cd76fcf3dc3da991eadd54eb56a4fe13194b8e1316607a63df82',
    },
  ],
  [
    'encodeData recursive V4',
    {
      ok: true,
      value:
        '7c5c8e90cb92c8da53b893b24962513be98afcf1b57b00327ae4cc14e3a641161627c55b822ab07f561918fe456c74b6174e87dd494f39b9fa7b3eab328bce93e3f4996db2ccbff4d74f563c0f84eac92cbff7c44e0cd12c7ba38f15010c180c7d95784ea86f47312ee11eb440e15acf486408713a1472018cc90f8ec627a696',
    },
  ],
  [
    'hashStruct recursive V4',
    {
      ok: true,
      value: '83371a4d34f43e0ac7ac0ed5564d09bf3f4e5637ad64a0f89e312a0493840081',
    },
  ],
  [
    'encodeData arrays V4',
    {
      ok: true,
      value:
        '405be17467233afd3a1dba5c6b4412505f3ae4c1d919f4a5538625d3de22342956cacfdc07c6f697bc1bc978cf38559d5c729ed1cd1177e047df929e19dc2a2e8548546251a0cc6d0005e1a792e00f85feed5056e580102ed1afa615f87bb130b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc86e0c627900b24bd432fe7b1f713f1b0744091a646a9fe4a65a18dfed21f2949c57bdc9c880fec35b15fb1afb8d968b152846dd8ca623b6e6f973b31f9c33b93a',
    },
  ],
  [
    'hashStruct arrays V4',
    {
      ok: true,
      value: 'cfebde3f32c69a862ab38e2677decf0b29aaf4aab2a9c75f9f408dfc99bb8c7d',
    },
  ],
  [
    'eip712Hash arrays V4',
    {
      ok: true,
      value: '99ae1b000fde1f7c221bc5086fb9e1ee9362ca55cfff55d4747c6247908f2fd1',
    },
  ],
  [
    'encodeData null struct V4',
    {
      ok: true,
      value:
        'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c80000000000000000000000000000000000000000000000000000000000000000b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8',
    },
  ],
  [
    'encodeData undefined struct V4',
    {
      ok: true,
      value:
        'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c80000000000000000000000000000000000000000000000000000000000000000b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8',
    },
  ],
  [
    'encodeData null atomic V4',
    {
      ok: false,
      error:
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null".',
    },
  ],
  [
    'encodeData undefined atomic V4',
    { ok: false, error: 'missing value for field count of type uint256' },
  ],
  ['encodeData null dynamic V4', { ok: false, error: 'Expected Uint8Array' }],
  [
    'encodeData undefined dynamic V4',
    { ok: false, error: 'missing value for field data of type bytes' },
  ],
  [
    'encodeData null array V4',
    { ok: false, error: "Cannot read properties of null (reading 'map')" },
  ],
  [
    'encodeData undefined array V4',
    { ok: false, error: 'missing value for field scores of type uint8[3]' },
  ],
  [
    'encodeData extra fields V4',
    {
      ok: true,
      value:
        'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8cd54f074a4af31b4411ff6a60c9719dbd559c221c8ac3492d9d872b041d703d1b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8',
    },
  ],
  [
    'error function V4',
    { ok: false, error: 'Unsupported or invalid type: "function"' },
  ],
  [
    'error unknown type V4',
    {
      ok: false,
      error: 'Unable to encode value: The type "foo" is not supported.',
    },
  ],
  [
    'error missing primary V4',
    { ok: false, error: 'No type definition specified: Message' },
  ],
  [
    'error missing value V4',
    { ok: false, error: 'missing value for field length of type int32' },
  ],
  [
    'error bad bool V4',
    {
      ok: false,
      error:
        'Unable to encode value: Invalid bool. Expected a boolean or the string "true" or "false", but received "1".',
    },
  ],
  [
    'error int range V4',
    {
      ok: false,
      error:
        'Unable to encode value: Number "256" is out of range for type "int8".',
    },
  ],
  [
    'error uint negative V4',
    {
      ok: false,
      error:
        'An unexpected error occurred: Value must be a non-negative bigint.',
    },
  ],
  [
    'error bad bytes V4',
    {
      ok: false,
      error:
        'An unexpected error occurred: Expected a bytes-like value, got "test".',
    },
  ],
  [
    'error bad address V4',
    {
      ok: false,
      error:
        'Unable to encode value: Invalid address value. Expected address to be 20 bytes long, but received 21 bytes.',
    },
  ],
  [
    'error nested path V4',
    { ok: false, error: 'missing value for field wallet of type address' },
  ],
  [
    'error array item path V4',
    { ok: false, error: 'missing value for field name of type string' },
  ],
  [
    'sign mail V4',
    {
      ok: true,
      value:
        '0x6788ed43187435f321349f4a8736c989062431c45e460e04b5e10f46d66efeac0cd8c164c436e40f4a37ea18a196dc0ed67deece2e0a212fc8c70f0cfc086c821c',
    },
  ],
  [
    'recover mail V4',
    { ok: true, value: '0x29c76e6ad8f28bb1004902578fb108c507be341b' },
  ],
  [
    'encodeType mail',
    {
      ok: true,
      value:
        'Mail(Person from,Person to,string contents)Person(string name,address wallet)',
    },
  ],
  [
    'encodeType recursive',
    { ok: true, value: 'Person(string name,Person mother,Person father)' },
  ],
  [
    'hashType mail',
    {
      ok: true,
      value: 'a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2',
    },
  ],
  [
    'hashType recursive',
    {
      ok: true,
      value: '7c5c8e90cb92c8da53b893b24962513be98afcf1b57b00327ae4cc14e3a64116',
    },
  ],
  ['findTypeDependencies mail', { ok: true, value: '["Mail","Person"]' }],
  ['findTypeDependencies recursive', { ok: true, value: '["Person"]' }],
  ['findTypeDependencies array', { ok: true, value: '["Person"]' }],
  ['findTypeDependencies missing', { ok: true, value: '[]' }],
  [
    'error findTypeDependencies null',
    { ok: false, error: 'Invalid findTypeDependencies input null' },
  ],
  [
    'error findTypeDependencies undefined',
    { ok: false, error: 'Invalid findTypeDependencies input undefined' },
  ],
  [
    'sanitizeData basic',
    {
      ok: true,
      value:
        '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Person":[{"name":"name","type":"string"},{"name":"wallet","type":"address"}],"Mail":[{"name":"from","type":"Person"},{"name":"to","type":"Person"},{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Ether Mail","version":"1","chainId":1,"verifyingContract":"0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"},"message":{"from":{"name":"Cow","wallet":"0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"},"to":{"name":"Bob","wallet":"0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"},"contents":"Hello, Bob!"}}',
    },
  ],
  [
    'sanitizeData extra',
    {
      ok: true,
      value:
        '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Person":[{"name":"name","type":"string"},{"name":"wallet","type":"address"}],"Mail":[{"name":"from","type":"Person"},{"name":"to","type":"Person"},{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Ether Mail","version":"1","chainId":1,"verifyingContract":"0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"},"message":{"from":{"name":"Cow","wallet":"0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"},"to":{"name":"Bob","wallet":"0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"},"contents":"Hello, Bob!"}}',
    },
  ],
  [
    'error encodeType missing primary',
    { ok: false, error: 'No type definition specified: Message' },
  ],
  [
    'typedSignatureHash v1',
    {
      ok: true,
      value:
        '0xe2bb0d6d4fd5bed552044205d73ec2fb04f6f6527eace370a0858d7a9de9b58f',
    },
  ],
  [
    'sign v1',
    {
      ok: true,
      value:
        '0x5b4fde214c70343686ecd135a9803b34a7ceed52cd28af7687f474030d1702b20cc0c6cfeabbfa1f06012f15d9241f45713e396c09eaf5b905c360630432a93a1b',
    },
  ],
  [
    'recover v1',
    { ok: true, value: '0x29c76e6ad8f28bb1004902578fb108c507be341b' },
  ],
]);

// All behavior vectors, in the same order they were frozen in.
const vectors: [label: string, run: () => unknown][] = [
  ...([SignTypedDataVersion.V3, SignTypedDataVersion.V4] as const).flatMap(
    (version): [string, () => unknown][] => [
      [
        `encodeData mail ${version}`,
        () =>
          TypedDataUtils.encodeData('Mail', mailMessage, mailTypes, version),
      ],
      [
        `hashStruct mail ${version}`,
        () =>
          TypedDataUtils.hashStruct('Mail', mailMessage, mailTypes, version),
      ],
      [
        `eip712Hash mail ${version}`,
        () => TypedDataUtils.eip712Hash(mailTypedData, version),
      ],
      [
        `eip712DomainHash mail ${version}`,
        () => TypedDataUtils.eip712DomainHash(mailTypedData, version),
      ],
      [
        `encodeData primitives ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            primitiveMessage,
            primitiveTypes,
            version,
          ),
      ],
      [
        `hashStruct primitives ${version}`,
        () =>
          TypedDataUtils.hashStruct(
            'Message',
            primitiveMessage,
            primitiveTypes,
            version,
          ),
      ],
      [
        `encodeData recursive ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Person',
            recursiveMessage,
            recursiveTypes,
            version,
          ),
      ],
      [
        `hashStruct recursive ${version}`,
        () =>
          TypedDataUtils.hashStruct(
            'Person',
            recursiveMessage,
            recursiveTypes,
            version,
          ),
      ],
      [
        `encodeData arrays ${version}`,
        () =>
          TypedDataUtils.encodeData('Mail', arrayMessage, arrayTypes, version),
      ],
      [
        `hashStruct arrays ${version}`,
        () =>
          TypedDataUtils.hashStruct('Mail', arrayMessage, arrayTypes, version),
      ],
      [
        `eip712Hash arrays ${version}`,
        () => TypedDataUtils.eip712Hash(arrayTypedData, version),
      ],
      [
        `encodeData null struct ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Mail',
            { ...mailMessage, to: null },
            mailTypes,
            version,
          ),
      ],
      [
        `encodeData undefined struct ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Mail',
            { ...mailMessage, to: undefined },
            mailTypes,
            version,
          ),
      ],
      [
        `encodeData null atomic ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { ...primitiveMessage, count: null },
            primitiveTypes,
            version,
          ),
      ],
      [
        `encodeData undefined atomic ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { ...primitiveMessage, count: undefined },
            primitiveTypes,
            version,
          ),
      ],
      [
        `encodeData null dynamic ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { ...primitiveMessage, data: null },
            primitiveTypes,
            version,
          ),
      ],
      [
        `encodeData undefined dynamic ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { ...primitiveMessage, data: undefined },
            primitiveTypes,
            version,
          ),
      ],
      [
        `encodeData null array ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Mail',
            { ...arrayMessage, scores: null },
            arrayTypes,
            version,
          ),
      ],
      [
        `encodeData undefined array ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Mail',
            { ...arrayMessage, scores: undefined },
            arrayTypes,
            version,
          ),
      ],
      [
        `encodeData extra fields ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Mail',
            { ...mailMessage, extra: 'ignored' },
            mailTypes,
            version,
          ),
      ],
      [
        `error function ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { f: 1 },
            { Message: [{ name: 'f', type: 'function' }] },
            version,
          ),
      ],
      [
        `error unknown type ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { data: 1 },
            { Message: [{ name: 'data', type: 'foo' }] },
            version,
          ),
      ],
      [
        `error missing primary ${version}`,
        () => TypedDataUtils.encodeData('Message', {}, {}, version),
      ],
      [
        `error missing value ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            {},
            { Message: [{ name: 'length', type: 'int32' }] },
            version,
          ),
      ],
      [
        `error bad bool ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { flag: 1 },
            { Message: [{ name: 'flag', type: 'bool' }] },
            version,
          ),
      ],
      [
        `error int range ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { n: '256' },
            { Message: [{ name: 'n', type: 'int8' }] },
            version,
          ),
      ],
      [
        `error uint negative ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { n: -1 },
            { Message: [{ name: 'n', type: 'uint8' }] },
            version,
          ),
      ],
      [
        `error bad bytes ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { b: 'test' },
            { Message: [{ name: 'b', type: 'bytes1' }] },
            version,
          ),
      ],
      [
        `error bad address ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Message',
            { a: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB0' },
            { Message: [{ name: 'a', type: 'address' }] },
            version,
          ),
      ],
      [
        `error nested path ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Mail',
            {
              from: {
                name: 'Cow',
                wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
              },
              to: { name: 'Bob' },
              contents: 'Hi',
            },
            mailTypes,
            version,
          ),
      ],
      [
        `error array item path ${version}`,
        () =>
          TypedDataUtils.encodeData(
            'Mail',
            {
              ...arrayMessage,
              to: [
                {
                  name: 'Bob',
                  wallet: ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'],
                },
                { wallet: [] },
              ],
            },
            arrayTypes,
            version,
          ),
      ],
      [
        `sign mail ${version}`,
        () =>
          signTypedData({
            privateKey: PRIVATE_KEY,
            data: mailTypedData,
            version,
          }),
      ],
      [
        `recover mail ${version}`,
        () =>
          recoverTypedSignature({
            data: mailTypedData,
            signature: signTypedData({
              privateKey: PRIVATE_KEY,
              data: mailTypedData,
              version,
            }),
            version,
          }),
      ],
    ],
  ),
  ['encodeType mail', () => TypedDataUtils.encodeType('Mail', mailTypes)],
  [
    'encodeType recursive',
    () => TypedDataUtils.encodeType('Person', recursiveTypes),
  ],
  ['hashType mail', () => TypedDataUtils.hashType('Mail', mailTypes)],
  [
    'hashType recursive',
    () => TypedDataUtils.hashType('Person', recursiveTypes),
  ],
  [
    'findTypeDependencies mail',
    () =>
      JSON.stringify([
        ...TypedDataUtils.findTypeDependencies('Mail', mailTypes),
      ]),
  ],
  [
    'findTypeDependencies recursive',
    () =>
      JSON.stringify([
        ...TypedDataUtils.findTypeDependencies('Person', recursiveTypes),
      ]),
  ],
  [
    'findTypeDependencies array',
    () =>
      JSON.stringify([
        ...TypedDataUtils.findTypeDependencies('Person[]', mailTypes),
      ]),
  ],
  [
    'findTypeDependencies missing',
    () =>
      JSON.stringify([
        ...TypedDataUtils.findTypeDependencies('Missing', mailTypes),
      ]),
  ],
  [
    'error findTypeDependencies null',
    () =>
      TypedDataUtils.findTypeDependencies(null as unknown as string, mailTypes),
  ],
  [
    'error findTypeDependencies undefined',
    () =>
      TypedDataUtils.findTypeDependencies(
        undefined as unknown as string,
        mailTypes,
      ),
  ],
  [
    'sanitizeData basic',
    () => JSON.stringify(TypedDataUtils.sanitizeData(mailTypedData)),
  ],
  [
    'sanitizeData extra',
    () =>
      JSON.stringify(
        TypedDataUtils.sanitizeData({
          ...mailTypedData,
          extra: 'drop me',
        } as typeof mailTypedData),
      ),
  ],
  [
    'error encodeType missing primary',
    () => TypedDataUtils.encodeType('Message', {}),
  ],
  ['typedSignatureHash v1', () => typedSignatureHash(v1Data)],
  [
    'sign v1',
    () =>
      signTypedData({
        privateKey: PRIVATE_KEY,
        data: v1Data,
        version: SignTypedDataVersion.V1,
      }),
  ],
  [
    'recover v1',
    () =>
      recoverTypedSignature({
        data: v1Data,
        signature: signTypedData({
          privateKey: PRIVATE_KEY,
          data: v1Data,
          version: SignTypedDataVersion.V1,
        }),
        version: SignTypedDataVersion.V1,
      }),
  ],
];

const successVectors = vectors.filter(
  (vector): vector is [string, () => string | Buffer] => {
    const expectation = FROZEN_VECTORS.get(vector[0]);
    return expectation?.ok === true;
  },
);

const errorVectors = vectors.filter(([label]) => {
  const expectation = FROZEN_VECTORS.get(label);
  return expectation?.ok === false;
});

describe('frozen behavior vectors', () => {
  it('has a frozen expectation for every vector', () => {
    for (const [label] of vectors) {
      expect(FROZEN_VECTORS.has(label)).toBe(true);
    }
    expect(FROZEN_VECTORS.size).toBe(vectors.length);
    expect(successVectors.length + errorVectors.length).toBe(vectors.length);
  });

  describe('successful vectors', () => {
    for (const [label, run] of successVectors) {
      it(`produces the frozen output for "${label}"`, () => {
        const expected = FROZEN_VECTORS.get(label) as FrozenVector & {
          ok: true;
        };

        const result = run();
        const actual =
          typeof result === 'string' ? result : result.toString('hex');
        expect(actual).toBe(expected.value);
      });
    }
  });

  describe('failure categories', () => {
    for (const [label, run] of errorVectors) {
      it(`throws the frozen error for "${label}"`, () => {
        const expected = FROZEN_VECTORS.get(label) as FrozenVector & {
          ok: false;
        };

        // The refactored pipeline may append `(at path: ...)` context to
        // error messages, so the frozen message is asserted as a substring.
        expect(run).toThrow(expected.error);
      });
    }
  });
});
