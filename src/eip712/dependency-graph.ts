import { stringToBytes } from '@metamask/utils';
import { keccak256 } from 'ethereum-cryptography/keccak';

import { parseTypeNode } from './type-parser';
import type { TypeNode } from './type-parser';

/**
 * A single field of a struct type definition. Structurally identical to
 * `MessageTypeProperty` from `sign-typed-data`, redeclared here to keep this
 * module free of import cycles.
 */
export type TypeDefinitionField = {
  name: string;
  type: string;
};

/**
 * The `types` record of a typed message, mapping struct names to their field
 * definitions.
 */
export type TypeDefinitions = Record<string, TypeDefinitionField[]>;

/**
 * A parsed, cached view of the `types` record of a typed message.
 *
 * The graph is responsible for everything that depends only on the type
 * definitions (and not on the values being signed): parsing type strings into
 * {@link TypeNode}s, exactly once per distinct type string; collecting type
 * dependencies and canonicalizing their order, as required by EIP-712
 * (`encodeType`); and hashing canonical type strings (`hashType`), exactly
 * once per struct.
 *
 * The legacy implementation recomputed all of the above for every struct
 * instance it encountered, so encoding an array of 10,000 structs parsed and
 * hashed the same type strings 10,000 times. With the graph, each type
 * string is interpreted once per message.
 */
export class TypeDependencyGraph {
  readonly #types: TypeDefinitions;

  readonly #nodeCache = new Map<string, TypeNode>();

  readonly #canonicalTypeCache = new Map<string, string>();

  readonly #typeHashCache = new Map<string, Uint8Array>();

  /**
   * Create a new type dependency graph.
   *
   * @param types - The `types` record of a typed message.
   */
  constructor(types: TypeDefinitions) {
    this.#types = types;
  }

  /**
   * Check whether a struct with the given name is defined.
   *
   * @param name - The type name to check.
   * @returns Whether the type is defined.
   */
  hasType(name: string): boolean {
    return this.#types[name] !== undefined;
  }

  /**
   * Get the field definitions of a struct type.
   *
   * @param name - The name of the struct type.
   * @returns The field definitions of the struct.
   */
  getFields(name: string): TypeDefinitionField[] {
    return this.#types[name];
  }

  /**
   * Parse a type string into a type node. The result is cached, so each
   * distinct type string is parsed at most once per graph.
   *
   * @param source - The type string to parse.
   * @returns The parsed type node.
   */
  parseType(source: string): TypeNode {
    let node = this.#nodeCache.get(source);
    if (node === undefined) {
      node = parseTypeNode(
        source,
        (name) => this.hasType(name),
        (elementSource) => this.parseType(elementSource),
      );
      this.#nodeCache.set(source, node);
    }
    return node;
  }

  /**
   * Find all types within the type definitions, relative to the given
   * primary type. This preserves the exact semantics of the legacy
   * `findTypeDependencies` implementation, including mutation of the
   * optional accumulator set.
   *
   * @param primaryType - The root type.
   * @param results - The current set of accumulated types.
   * @returns The set of all types found in the type definitions.
   */
  collectDependencies(
    primaryType: string,
    results: Set<string> = new Set(),
  ): Set<string> {
    if (typeof primaryType !== 'string') {
      throw new Error(
        `Invalid findTypeDependencies input ${JSON.stringify(primaryType)}`,
      );
    }
    const match = primaryType.match(/^\w*/u) as RegExpMatchArray;
    const [baseType] = match;
    if (results.has(baseType) || this.#types[baseType] === undefined) {
      return results;
    }

    results.add(baseType);

    for (const field of this.#types[baseType]) {
      this.collectDependencies(field.type, results);
    }
    return results;
  }

  /**
   * Get the canonical EIP-712 encoding of a struct type: the primary type
   * first, followed by its dependencies in alphabetical order. The result is
   * cached, so each type is canonicalized at most once per graph.
   *
   * @param primaryType - The root type to encode.
   * @returns The canonical encoding of the type.
   */
  getCanonicalTypeString(primaryType: string): string {
    const cached = this.#canonicalTypeCache.get(primaryType);
    if (cached !== undefined) {
      return cached;
    }

    let result = '';
    const unsortedDeps = this.collectDependencies(primaryType);
    unsortedDeps.delete(primaryType);

    const deps = [primaryType, ...Array.from(unsortedDeps).sort()];
    for (const type of deps) {
      const children = this.#types[type];
      if (!children) {
        throw new Error(`No type definition specified: ${type}`);
      }

      result += `${type}(${children
        .map(({ name, type: fieldType }) => `${fieldType} ${name}`)
        .join(',')})`;
    }

    this.#canonicalTypeCache.set(primaryType, result);
    return result;
  }

  /**
   * Get the EIP-712 hash of a struct type. The result is cached, so each
   * type is hashed at most once per graph, no matter how many instances of
   * the struct appear in the message.
   *
   * @param primaryType - The root type to hash.
   * @returns The hash of the type.
   */
  getTypeHash(primaryType: string): Uint8Array {
    let hash = this.#typeHashCache.get(primaryType);
    if (hash === undefined) {
      hash = keccak256(stringToBytes(this.getCanonicalTypeString(primaryType)));
      this.#typeHashCache.set(primaryType, hash);
    }
    return hash;
  }
}
