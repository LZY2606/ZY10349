/**
 * The version-specific encoding decisions of the typed-data pipeline.
 *
 * The differences between the EIP-712 versions are deliberately kept here,
 * as data, rather than being spread across loose `version === ...` branches
 * in the walker and encoder. `V1` does not use this pipeline at all: it is a
 * legacy packed encoding (see `_typedSignatureHash` in `sign-typed-data`)
 * with its own normalization rules. `V3` skips `undefined` message fields,
 * does not support arrays, and recurses into `null` struct values (which
 * surfaces a `TypeError`). `V4` rejects `undefined` message fields, supports
 * arrays, and encodes `null` struct values as the zero hash.
 *
 * Fields not declared in the type definitions are ignored by every version:
 * the value walker only ever visits declared fields, so extra message
 * properties never reach the encoder.
 */
export type EncodingPolicy = {
  /**
   * Whether array values may be encoded. Only `V4` supports arrays.
   */
  supportsArrays: boolean;
  /**
   * Whether `undefined` message fields are silently skipped (`V3`) or
   * rejected with a "missing value" error (`V4`).
   */
  skipUndefinedFields: boolean;
  /**
   * How `null` (or `undefined`) struct values are encoded: as the zero hash
   * (`V4`), or by recursing into the value (`V3`, which throws a `TypeError`
   * when reading the fields of `null`).
   */
  nullStructEncoding: 'zeroHash' | 'recurse';
};

/**
 * The encoding policy for `SignTypedDataVersion.V3`.
 */
export const V3_ENCODING_POLICY: EncodingPolicy = {
  supportsArrays: false,
  skipUndefinedFields: true,
  nullStructEncoding: 'recurse',
};

/**
 * The encoding policy for `SignTypedDataVersion.V4`.
 */
export const V4_ENCODING_POLICY: EncodingPolicy = {
  supportsArrays: true,
  skipUndefinedFields: false,
  nullStructEncoding: 'zeroHash',
};
