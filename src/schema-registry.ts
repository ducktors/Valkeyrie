import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Key } from './valkeyrie.ts'

interface SchemaEntry {
  pattern: Key
  schema: StandardSchemaV1
}

/**
 * Registry for schema patterns and their associated validation schemas.
 * Supports wildcard matching where '*' matches exactly one key part.
 */
export class SchemaRegistry {
  private schemas: SchemaEntry[] = []

  /**
   * Registers a schema pattern.
   * @param pattern Key pattern with optional '*' wildcards
   * @param schema Standard schema for validation
   * @throws {Error} If a schema is already registered for this pattern
   */
  register(pattern: Key, schema: StandardSchemaV1): void {
    // Check if this pattern is already registered
    for (const entry of this.schemas) {
      if (this.patternsEqual(entry.pattern, pattern)) {
        throw new Error(
          `Schema already registered for pattern [${pattern.join(', ')}]`,
        )
      }
    }

    this.schemas.push({ pattern, schema })
  }

  /**
   * Checks if two patterns are equal.
   * @param pattern1 First pattern
   * @param pattern2 Second pattern
   * @returns true if patterns are equal
   */
  private patternsEqual(pattern1: Key, pattern2: Key): boolean {
    if (pattern1.length !== pattern2.length) {
      return false
    }

    for (let i = 0; i < pattern1.length; i++) {
      if (!this.partsEqual(pattern1[i], pattern2[i])) {
        return false
      }
    }

    return true
  }

  /**
   * Gets a matching schema for the given key.
   * Exact matches (patterns without wildcards) take priority over wildcard patterns.
   * @param key Key to match against registered patterns
   * @returns The matching schema or null if no match found
   */
  getSchema(key: Key): StandardSchemaV1 | null {
    // First pass: look for exact matches (no wildcards)
    for (const { pattern, schema } of this.schemas) {
      if (this.isExactPattern(pattern) && this.matchPattern(pattern, key)) {
        return schema
      }
    }

    // Second pass: look for wildcard matches
    for (const { pattern, schema } of this.schemas) {
      if (!this.isExactPattern(pattern) && this.matchPattern(pattern, key)) {
        return schema
      }
    }

    return null
  }

  /**
   * Checks if a pattern is an exact pattern (contains no wildcards).
   * @param pattern Pattern to check
   * @returns true if the pattern contains no wildcards
   */
  private isExactPattern(pattern: Key): boolean {
    for (const part of pattern) {
      if (part === '*') {
        return false
      }
    }
    return true
  }

  /**
   * Checks if a key matches a pattern with wildcards.
   * @param pattern Pattern with optional '*' wildcards
   * @param key Key to match
   * @returns true if the key matches the pattern
   */
  private matchPattern(pattern: Key, key: Key): boolean {
    // Pattern and key must have the same length
    if (pattern.length !== key.length) {
      return false
    }

    // Check each part
    for (let i = 0; i < pattern.length; i++) {
      const patternPart = pattern[i]
      const keyPart = key[i]

      // '*' matches any single key part
      if (patternPart === '*') {
        continue
      }

      // Non-wildcard parts must match exactly
      if (!this.partsEqual(patternPart, keyPart)) {
        return false
      }
    }

    return true
  }

  /**
   * Checks if two key parts are equal.
   * Handles different types (string, number, bigint, boolean, Uint8Array, symbol)
   */
  private partsEqual(a: unknown, b: unknown): boolean {
    // Handle Uint8Array comparison
    if (a instanceof Uint8Array && b instanceof Uint8Array) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false
      }
      return true
    }

    // For primitives (string, number, bigint, boolean, symbol)
    return a === b
  }

  /**
   * Returns all registered schema patterns with their schemas
   */
  listSchemas(): Array<[Key, StandardSchemaV1]> {
    return this.schemas.map(({ pattern, schema }) => [pattern, schema])
  }
}
