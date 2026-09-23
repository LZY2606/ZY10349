import { arrToBufArr, ecsign, publicToAddress } from '@ethereumjs/util';
import { encodePacked } from '@metamask/abi-utils';
import {
  getArrayType,
  getByteLength,
  getLength,
  isArrayType,
} from '@metamask/abi-utils/dist/parsers';
import { padStart } from '@metamask/abi-utils/dist/utils';
import {
  bigIntToBytes,
  bytesToHex,
  concatBytes,
  hexToBytes,
  isStrictHexString,
  numberToBytes,
  signedBigIntToBytes,
} from '@metamask/utils';
import { keccak256 } from 'ethereum-cryptography/keccak';

import {
  ByteEncoder,
  TypeDependencyGraph,
  V3_ENCODING_POLICY,
  V4_ENCODING_POLICY,
  normalizeBool,
  parseNumber,
  walkTypedValue,
} from './eip712';
import type { EncodingPolicy } from './eip712';
import {
  concatSig,
  isNullish,
  legacyToBuffer,
  recoverPublicKey,
} from './utils';

/**
 * This is the message format used for `V1` of `signTypedData`.
 */
export type TypedDataV1 = TypedDataV1Field[];

/**
 * This represents a single field in a `V1` `signTypedData` message.
 *
 * @property name - The name of the field.
 * @property type - The type of a field (must be a supported Solidity type).
 * @property value - The value of the field.
 */
export type TypedDataV1Field = {
  name: string;
  type: string;
  value: any;
};

/**
 * Represents the version of `signTypedData` being used.
 *
 * V1 is based upon [an early version of
 * EIP-712](https://github.com/ethereum/EIPs/pull/712/commits/21abe254fe0452d8583d5b132b1d7be87c0439ca)
 * that lacked some later security improvements, and should generally be neglected in favor of
 * later versions.
 *
 * V3 is based on EIP-712, except that arrays and recursive data structures are not supported.
 *
 * V4 is based on EIP-712, and includes full support of arrays and recursive data structures.
 */
export enum SignTypedDataVersion {
  V1 = 'V1',
  V3 = 'V3',
  V4 = 'V4',
}

export type MessageTypeProperty = {
  name: string;
  type: string;
};

export type MessageTypes = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  EIP712Domain: MessageTypeProperty[];
  [additionalProperties: string]: MessageTypeProperty[];
};

/**
 * This is the message format used for `signTypeData`, for all versions
 * except `V1`.
 *
 * @template T - The custom types used by this message.
 * @property types - The custom types used by this message.
 * @property primaryType - The type of the message.
 * @property domain - Signing domain metadata. The signing domain is the intended context for the
 * signature (e.g. the dapp, protocol, etc. that it's intended for). This data is used to
 * construct the domain seperator of the message.
 * @property domain.name - The name of the signing domain.
 * @property domain.version - The current major version of the signing domain.
 * @property domain.chainId - The chain ID of the signing domain.
 * @property domain.verifyingContract - The address of the contract that can verify the signature.
 * @property domain.salt - A disambiguating salt for the protocol.
 * @property message - The message to be signed.
 */
export type TypedMessage<T extends MessageTypes> = {
  types: T;
  primaryType: keyof T;
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
    salt?: ArrayBuffer;
  };
  message: Record<string, unknown>;
};

export const TYPED_MESSAGE_SCHEMA = {
  type: 'object',
  properties: {
    types: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
          },
          required: ['name', 'type'],
        },
      },
    },
    primaryType: { type: 'string' },
    domain: { type: 'object' },
    message: { type: 'object' },
  },
  required: ['types', 'primaryType', 'domain', 'message'],
};

/**
 * Validate that the given value is a valid version string.
 *
 * @param version - The version value to validate.
 * @param allowedVersions - A list of allowed versions. If omitted, all versions are assumed to be
 * allowed.
 */
function validateVersion(
  version: SignTypedDataVersion,
  allowedVersions?: SignTypedDataVersion[],
) {
  if (!Object.keys(SignTypedDataVersion).includes(version)) {
    throw new Error(`Invalid version: '${version}'`);
  } else if (allowedVersions && !allowedVersions.includes(version)) {
    throw new Error(
      `SignTypedDataVersion not allowed: '${version}'. Allowed versions are: ${allowedVersions.join(
        ', ',
      )}`,
    );
  }
}

/**
 * Get the version-specific encoding policy for the typed-data pipeline.
 *
 * @param version - The EIP-712 version to get the policy for.
 * @returns The encoding policy.
 */
function getEncodingPolicy(
  version: SignTypedDataVersion.V3 | SignTypedDataVersion.V4,
): EncodingPolicy {
  return version === SignTypedDataVersion.V3
    ? V3_ENCODING_POLICY
    : V4_ENCODING_POLICY;
}

/**
 * Encodes an object by encoding and concatenating each of its members.
 *
 * This is a thin adapter over the typed-data pipeline: the type dependency
 * graph interprets each type string once, the value walker turns the message
 * into a stream of validated typed value events, and the byte encoder
 * consumes those events to produce the final encoding.
 *
 * @param primaryType - The root type.
 * @param data - The object to encode.
 * @param types - Type definitions for all types included in the message.
 * @param version - The EIP-712 version the encoding should comply with.
 * @returns An encoded representation of an object.
 */
function encodeData(
  primaryType: string,
  data: Record<string, unknown>,
  types: Record<string, MessageTypeProperty[]>,
  version: SignTypedDataVersion.V3 | SignTypedDataVersion.V4,
): Buffer {
  validateVersion(version, [SignTypedDataVersion.V3, SignTypedDataVersion.V4]);

  const graph = new TypeDependencyGraph(types);
  const encoder = new ByteEncoder();
  walkTypedValue({
    graph,
    primaryType,
    value: data,
    policy: getEncodingPolicy(version),
    sink: encoder,
  });
  return arrToBufArr(encoder.getResult());
}

/**
 * Encodes the type of an object by encoding a comma delimited list of its members.
 *
 * @param primaryType - The root type to encode.
 * @param types - Type definitions for all types included in the message.
 * @returns An encoded representation of the primary type.
 */
function encodeType(
  primaryType: string,
  types: Record<string, MessageTypeProperty[]>,
): string {
  return new TypeDependencyGraph(types).getCanonicalTypeString(primaryType);
}

/**
 * Finds all types within a type definition object.
 *
 * @param primaryType - The root type.
 * @param types - Type definitions for all types included in the message.
 * @param results - The current set of accumulated types.
 * @returns The set of all types found in the type definition.
 */
function findTypeDependencies(
  primaryType: string,
  types: Record<string, MessageTypeProperty[]>,
  results: Set<string> = new Set(),
): Set<string> {
  return new TypeDependencyGraph(types).collectDependencies(
    primaryType,
    results,
  );
}

/**
 * Hashes an object.
 *
 * @param primaryType - The root type.
 * @param data - The object to hash.
 * @param types - Type definitions for all types included in the message.
 * @param version - The EIP-712 version the encoding should comply with.
 * @returns The hash of the object.
 */
function hashStruct(
  primaryType: string,
  data: Record<string, unknown>,
  types: Record<string, MessageTypeProperty[]>,
  version: SignTypedDataVersion.V3 | SignTypedDataVersion.V4,
): Buffer {
  validateVersion(version, [SignTypedDataVersion.V3, SignTypedDataVersion.V4]);

  const encoded = encodeData(primaryType, data, types, version);
  const hashed = keccak256(encoded);
  const buf = arrToBufArr(hashed);
  return buf;
}

/**
 * Hashes the type of an object.
 *
 * @param primaryType - The root type to hash.
 * @param types - Type definitions for all types included in the message.
 * @returns The hash of the object type.
 */
function hashType(
  primaryType: string,
  types: Record<string, MessageTypeProperty[]>,
): Buffer {
  return arrToBufArr(new TypeDependencyGraph(types).getTypeHash(primaryType));
}

/**
 * Removes properties from a message object that are not defined per EIP-712.
 *
 * @param data - The typed message object.
 * @returns The typed message object with only allowed fields.
 */
function sanitizeData<T extends MessageTypes>(
  data: TypedMessage<T>,
): TypedMessage<T> {
  const sanitizedData: Partial<TypedMessage<T>> = {};
  for (const key in TYPED_MESSAGE_SCHEMA.properties) {
    if (data[key]) {
      sanitizedData[key] = data[key];
    }
  }

  if ('types' in sanitizedData) {
    // TODO: Fix types
    sanitizedData.types = { EIP712Domain: [], ...sanitizedData.types } as any;
  }
  return sanitizedData as Required<TypedMessage<T>>;
}

/**
 * Create a EIP-712 Domain Hash.
 * This hash is used at the top of the EIP-712 encoding.
 *
 * @param typedData - The typed message to hash.
 * @param version - The EIP-712 version the encoding should comply with.
 * @returns The hash of the domain object.
 */
function eip712DomainHash<T extends MessageTypes>(
  typedData: TypedMessage<T>,
  version: SignTypedDataVersion.V3 | SignTypedDataVersion.V4,
): Buffer {
  validateVersion(version, [SignTypedDataVersion.V3, SignTypedDataVersion.V4]);

  return hashSanitizedDomain(sanitizeData(typedData), version);
}

/**
 * Create a EIP-712 Domain Hash from an already sanitized typed message.
 *
 * @param sanitizedData - The sanitized typed message.
 * @param version - The EIP-712 version the encoding should comply with.
 * @returns The hash of the domain object.
 */
function hashSanitizedDomain<T extends MessageTypes>(
  sanitizedData: TypedMessage<T>,
  version: SignTypedDataVersion.V3 | SignTypedDataVersion.V4,
): Buffer {
  const { domain } = sanitizedData;
  const domainType = { EIP712Domain: sanitizedData.types.EIP712Domain };
  return hashStruct('EIP712Domain', domain, domainType, version);
}

/**
 * Hash a typed message according to EIP-712. The returned message starts with the EIP-712 prefix,
 * which is "1901", followed by the hash of the domain separator, then the data (if any).
 * The result is hashed again and returned.
 *
 * This function does not sign the message. The resulting hash must still be signed to create an
 * EIP-712 signature.
 *
 * @param typedData - The typed message to hash.
 * @param version - The EIP-712 version the encoding should comply with.
 * @returns The hash of the typed message.
 */
function eip712Hash<T extends MessageTypes>(
  typedData: TypedMessage<T>,
  version: SignTypedDataVersion.V3 | SignTypedDataVersion.V4,
): Buffer {
  validateVersion(version, [SignTypedDataVersion.V3, SignTypedDataVersion.V4]);

  const sanitizedData = sanitizeData(typedData);
  const parts = [hexToBytes('1901')];
  parts.push(hashSanitizedDomain(sanitizedData, version));

  if (sanitizedData.primaryType !== 'EIP712Domain') {
    parts.push(
      hashStruct(
        // TODO: Validate that this is a string, so this type cast can be removed.
        sanitizedData.primaryType as string,
        sanitizedData.message,
        sanitizedData.types,
        version,
      ),
    );
  }
  return arrToBufArr(keccak256(concatBytes(parts)));
}

/**
 * A collection of utility functions used for signing typed data.
 */
export const TypedDataUtils = {
  encodeData,
  encodeType,
  findTypeDependencies,
  hashStruct,
  hashType,
  sanitizeData,
  eip712Hash,
  eip712DomainHash,
};

/**
 * Generate the "V1" hash for the provided typed message.
 *
 * The hash will be generated in accordance with an earlier version of the EIP-712
 * specification. This hash is used in `signTypedData_v1`.
 *
 * @param typedData - The typed message.
 * @returns The '0x'-prefixed hex encoded hash representing the type of the provided message.
 */
export function typedSignatureHash(typedData: TypedDataV1Field[]): string {
  const hashBuffer = _typedSignatureHash(typedData);
  return bytesToHex(hashBuffer);
}

/**
 * Normalize a value, so that `@metamask/abi-utils` can handle it. This
 * matches the behaviour of the `ethereumjs-abi` library.
 *
 * @param type - The type of the value to normalize.
 * @param value - The value to normalize.
 * @returns The normalized value.
 */
function normalizeValue(type: string, value: unknown): any {
  if (isArrayType(type) && Array.isArray(value)) {
    const [innerType] = getArrayType(type);
    return value.map((item) => normalizeValue(innerType, item));
  }

  if (type === 'address') {
    if (isStrictHexString(value)) {
      return padStart(hexToBytes(value).subarray(0, 20), 20);
    }

    if (value instanceof Uint8Array) {
      return padStart(value.subarray(0, 20), 20);
    }
  }

  if (type === 'bool') {
    return normalizeBool(value);
  }

  if (type.startsWith('bytes') && type !== 'bytes') {
    const length = getByteLength(type);
    if (typeof value === 'number') {
      if (value < 0) {
        // `solidityPack(['bytesN'], [-1])` returns `0x00..00`.
        return new Uint8Array();
      }

      return numberToBytes(value).subarray(0, length);
    }

    if (isStrictHexString(value)) {
      return hexToBytes(value).subarray(0, length);
    }

    if (value instanceof Uint8Array) {
      return value.subarray(0, length);
    }
  }

  if (type.startsWith('uint')) {
    if (typeof value === 'number') {
      return Math.abs(value);
    }
  }

  if (type.startsWith('int')) {
    if (typeof value === 'number') {
      const length = getLength(type);
      return BigInt.asIntN(length, BigInt(value));
    }
  }

  return value;
}

/**
 * For some reason `ethereumjs-abi` treats `address` and `address[]` differently
 * so we need to normalize `address[]` differently.
 *
 * @param values - The values to normalize.
 * @returns The normalized values.
 */
function normalizeAddresses(values: unknown[]) {
  return values.map((value) => {
    if (typeof value === 'number') {
      return padStart(numberToBytes(value), 32);
    }

    if (isStrictHexString(value)) {
      return padStart(hexToBytes(value).subarray(0, 32), 32);
    }

    if (value instanceof Uint8Array) {
      return padStart(value.subarray(0, 32), 32);
    }

    return value;
  });
}

/**
 * For some reason `ethereumjs-abi` treats `intN` and `intN[]` differently
 * so we need to normalize `intN[]` differently.
 *
 * @param type - The type of the value to normalize.
 * @param values - The values to normalize.
 * @returns The normalized values.
 */
function normalizeIntegers(type: string, values: unknown[]) {
  return values.map((value) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint'
    ) {
      const bigIntValue = parseNumber(type, value);
      if (bigIntValue >= BigInt(0)) {
        return padStart(bigIntToBytes(bigIntValue), 32);
      }

      const length = getLength(type);
      const asIntN = BigInt.asIntN(length, bigIntValue);
      return signedBigIntToBytes(asIntN, 32);
    }

    return value;
  });
}

/**
 * Generate the "V1" hash for the provided typed message.
 *
 * The hash will be generated in accordance with an earlier version of the EIP-712
 * specification. This hash is used in `signTypedData_v1`.
 *
 * @param typedData - The typed message.
 * @returns The hash representing the type of the provided message.
 */
function _typedSignatureHash(typedData: TypedDataV1): Buffer {
  const error = new Error('Expect argument to be non-empty array');
  if (
    typeof typedData !== 'object' ||
    !('length' in typedData) ||
    !typedData.length
  ) {
    throw error;
  }

  const normalizedData = typedData.map(({ name, type, value }) => {
    // Handle an edge case with `address[]` types.
    if (type === 'address[]') {
      return {
        name,
        type: 'bytes32[]',
        value: normalizeAddresses(value),
      };
    }

    // Handle an edge case with `intN[]` types.
    if (type.startsWith('int') && isArrayType(type)) {
      const [innerType, length] = getArrayType(type);
      return {
        name,
        type: `bytes32[${length ?? ''}]`,
        value: normalizeIntegers(innerType, value),
      };
    }

    return {
      name,
      type,
      value: normalizeValue(type, value),
    };
  });

  const data = normalizedData.map((e) => {
    if (e.type !== 'bytes') {
      return e.value;
    }

    return legacyToBuffer(e.value);
  });
  const types = normalizedData.map((e) => {
    if (e.type === 'function') {
      throw new Error('Unsupported or invalid type: "function"');
    }

    return e.type;
  });
  const schema = typedData.map((e) => {
    if (!e.name) {
      throw error;
    }
    return `${e.type} ${e.name}`;
  });

  return arrToBufArr(
    keccak256(
      encodePacked(
        ['bytes32', 'bytes32'],
        [
          keccak256(encodePacked(['string[]'], [schema], true)),
          keccak256(encodePacked(types, data, true)),
        ],
      ),
    ),
  );
}

/**
 * Sign typed data according to EIP-712. The signing differs based upon the `version`.
 *
 * V1 is based upon [an early version of
 * EIP-712](https://github.com/ethereum/EIPs/pull/712/commits/21abe254fe0452d8583d5b132b1d7be87c0439ca)
 * that lacked some later security improvements, and should generally be neglected in favor of
 * later versions.
 *
 * V3 is based on [EIP-712](https://eips.ethereum.org/EIPS/eip-712), except that arrays and
 * recursive data structures are not supported.
 *
 * V4 is based on [EIP-712](https://eips.ethereum.org/EIPS/eip-712), and includes full support of
 * arrays and recursive data structures.
 *
 * @param options - The signing options.
 * @param options.privateKey - The private key to sign with.
 * @param options.data - The typed data to sign.
 * @param options.version - The signing version to use.
 * @returns The '0x'-prefixed hex encoded signature.
 */
export function signTypedData<
  V extends SignTypedDataVersion,
  T extends MessageTypes,
>({
  privateKey,
  data,
  version,
}: {
  privateKey: Buffer;
  data: V extends 'V1' ? TypedDataV1 : TypedMessage<T>;
  version: V;
}): string {
  validateVersion(version);
  if (isNullish(data)) {
    throw new Error('Missing data parameter');
  } else if (isNullish(privateKey)) {
    throw new Error('Missing private key parameter');
  }

  const messageHash =
    version === SignTypedDataVersion.V1
      ? _typedSignatureHash(data as TypedDataV1)
      : TypedDataUtils.eip712Hash(data as TypedMessage<T>, version);
  const sig = ecsign(messageHash, privateKey);
  return concatSig(arrToBufArr(bigIntToBytes(sig.v)), sig.r, sig.s);
}

/**
 * Recover the address of the account that created the given EIP-712
 * signature. The version provided must match the version used to
 * create the signature.
 *
 * @param options - The signature recovery options.
 * @param options.data - The typed data that was signed.
 * @param options.signature - The '0x-prefixed hex encoded message signature.
 * @param options.version - The signing version to use.
 * @returns The '0x'-prefixed hex address of the signer.
 */
export function recoverTypedSignature<
  V extends SignTypedDataVersion,
  T extends MessageTypes,
>({
  data,
  signature,
  version,
}: {
  data: V extends 'V1' ? TypedDataV1 : TypedMessage<T>;
  signature: string;
  version: V;
}): string {
  validateVersion(version);
  if (isNullish(data)) {
    throw new Error('Missing data parameter');
  } else if (isNullish(signature)) {
    throw new Error('Missing signature parameter');
  }

  const messageHash =
    version === SignTypedDataVersion.V1
      ? _typedSignatureHash(data as TypedDataV1)
      : TypedDataUtils.eip712Hash(data as TypedMessage<T>, version);
  const publicKey = recoverPublicKey(messageHash, signature);
  const sender = publicToAddress(publicKey);
  return bytesToHex(sender);
}
