/**
 * The primitive families recognized by the EIP-712 encoder. The families
 * mirror the dispatch order of the legacy `encodeField` implementation, so
 * that classification is byte-for-byte compatible with the previous
 * behaviour.
 */
export type PrimitiveFamily =
  | 'address'
  | 'bool'
  | 'bytes'
  | 'fixedBytes'
  | 'int'
  | 'uint'
  | 'string'
  | 'unknown';

/**
 * A node in the parsed type graph. Type strings are parsed exactly once per
 * {@link TypeDependencyGraph} and the resulting nodes are shared by the value
 * walker, so walking a large array never re-parses the element type.
 */
export type TypeNode =
  | StructTypeNode
  | ArrayTypeNode
  | PrimitiveTypeNode
  | UnsupportedTypeNode;

/**
 * A reference to a struct defined in the `types` record of the message.
 */
export type StructTypeNode = {
  kind: 'struct';
  /** The name of the struct, as defined in the `types` record. */
  name: string;
  /** The original type string this node was parsed from. */
  source: string;
};

/**
 * An array type, e.g. `uint256[]` or `Person[3]`.
 */
export type ArrayTypeNode = {
  kind: 'array';
  /** The parsed element type. */
  element: TypeNode;
  /** The declared fixed length, or `null` for dynamic arrays. */
  length: number | null;
  /** The original type string this node was parsed from. */
  source: string;
};

/**
 * An atomic (non-struct, non-array) type.
 */
export type PrimitiveTypeNode = {
  kind: 'primitive';
  /** The canonical family of the primitive. */
  family: PrimitiveFamily;
  /**
   * The parsed width of the type, in bits for `intN`/`uintN` types and in
   * bytes for `bytesN` types, when the width is well-formed. This is
   * validated lazily by the value walker, at the same point the legacy
   * implementation validated it, so that error behaviour is preserved.
   */
  width: number | null;
  /** The original type string this node was parsed from. */
  source: string;
};

/**
 * A type that is recognized but not supported by EIP-712, i.e. `function`.
 */
export type UnsupportedTypeNode = {
  kind: 'unsupported';
  /** The original type string this node was parsed from. */
  source: string;
};

const FIXED_BYTES_WIDTH_REGEX = /^bytes(\d+)$/u;
const INT_WIDTH_REGEX = /^u?int(\d+)$/u;

/**
 * Parse the width of a primitive type, if it is well-formed. Invalid widths
 * are not rejected here; they are rejected by the value walker or the ABI
 * encoder, exactly where the legacy implementation rejected them.
 *
 * @param family - The primitive family of the type.
 * @param source - The original type string.
 * @returns The parsed width, or `null` if the type has no well-formed width.
 */
function parseWidth(family: PrimitiveFamily, source: string): number | null {
  if (family === 'fixedBytes') {
    const match = source.match(FIXED_BYTES_WIDTH_REGEX);
    return match ? parseInt(match[1], 10) : null;
  }

  if (family === 'int' || family === 'uint') {
    const match = source.match(INT_WIDTH_REGEX);
    return match ? parseInt(match[1], 10) : null;
  }

  return null;
}

/**
 * Classify an atomic type string into a primitive family. This mirrors the
 * dispatch order of the legacy `encodeField` implementation.
 *
 * @param source - The type string to classify.
 * @returns The primitive family of the type.
 */
function getPrimitiveFamily(source: string): PrimitiveFamily {
  if (source === 'address') {
    return 'address';
  }

  if (source === 'bool') {
    return 'bool';
  }

  if (source === 'bytes') {
    return 'bytes';
  }

  if (source.startsWith('bytes') && !source.includes('[')) {
    return 'fixedBytes';
  }

  if (source.startsWith('int') && !source.includes('[')) {
    return 'int';
  }

  if (source === 'string') {
    return 'string';
  }

  if (source.startsWith('uint') && !source.includes('[')) {
    return 'uint';
  }

  return 'unknown';
}

/**
 * Parse a type string into a type node. Struct references are resolved
 * through the given predicate, so the parser itself never needs to know the
 * full type registry.
 *
 * @param source - The type string to parse, e.g. `uint256`, `Person` or
 * `Person[3][]`.
 * @param isStruct - Whether the given type name refers to a struct defined
 * in the message `types` record.
 * @param parseNested - Parser used for nested element types of arrays.
 * Defaults to a recursive call; the type dependency graph passes its own
 * cached parser, so that element nodes are shared between type strings.
 * @returns The parsed type node.
 */
export function parseTypeNode(
  source: string,
  isStruct: (name: string) => boolean,
  parseNested: (source: string) => TypeNode = (nestedSource) =>
    parseTypeNode(nestedSource, isStruct),
): TypeNode {
  if (isStruct(source)) {
    return { kind: 'struct', name: source, source };
  }

  if (source.endsWith(']')) {
    const openBracketIndex = source.lastIndexOf('[');
    const elementSource = source.slice(0, openBracketIndex);
    const lengthSource = source.slice(openBracketIndex + 1, -1);
    const length = lengthSource === '' ? null : parseInt(lengthSource, 10);

    return {
      kind: 'array',
      element: parseNested(elementSource),
      length,
      source,
    };
  }

  if (source === 'function') {
    return { kind: 'unsupported', source };
  }

  const family = getPrimitiveFamily(source);
  return {
    kind: 'primitive',
    family,
    width: parseWidth(family, source),
    source,
  };
}
