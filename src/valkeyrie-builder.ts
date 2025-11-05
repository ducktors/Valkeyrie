import type { StandardSchemaV1 } from '@standard-schema/spec'
import { SchemaRegistry } from './schema-registry.js'
import type { Serializer } from './serializers/serializer.js'
import { kFrom, kFromAsync, kOpen } from './symbols.js'
import type { FromOptions, Key } from './valkeyrie.js'
import { Valkeyrie } from './valkeyrie.js'

/**
 * Builder for creating Valkeyrie instances with schema validation.
 * Schemas are registered before opening the database and become immutable after.
 */
export class ValkeyrieBuilder {
  private schemaRegistry: SchemaRegistry

  constructor() {
    this.schemaRegistry = new SchemaRegistry()
  }

  /**
   * Registers a schema pattern for validation.
   * @param pattern Key pattern with optional '*' wildcards
   * @param schema Standard schema for validation
   * @returns this builder for chaining
   */
  withSchema(pattern: Key, schema: StandardSchemaV1): ValkeyrieBuilder {
    this.schemaRegistry.register(pattern, schema)
    return this
  }

  /**
   * Opens a new Valkeyrie database instance with registered schemas.
   * @param path Optional path to the database file (defaults to in-memory)
   * @param options Optional configuration options
   * @returns A new Valkeyrie instance with schema validation
   */
  async open(
    path?: string,
    options: {
      serializer?: () => Serializer
      destroyOnClose?: boolean
    } = {},
  ): Promise<Valkeyrie> {
    return Valkeyrie[kOpen](path, options, this.schemaRegistry)
  }

  /**
   * Creates and populates a Valkeyrie database from a synchronous iterable with schemas.
   * @param iterable The iterable to populate the database from
   * @param options Configuration options including prefix and key extraction
   * @returns A populated Valkeyrie instance with schema validation
   */
  async from<T>(
    iterable: Iterable<T>,
    options: FromOptions<T>,
  ): Promise<Valkeyrie> {
    return Valkeyrie[kFrom](iterable, options, this.schemaRegistry)
  }

  /**
   * Creates and populates a Valkeyrie database from an asynchronous iterable with schemas.
   * @param iterable The async iterable to populate the database from
   * @param options Configuration options including prefix and key extraction
   * @returns A populated Valkeyrie instance with schema validation
   */
  async fromAsync<T>(
    iterable: AsyncIterable<T>,
    options: FromOptions<T>,
  ): Promise<Valkeyrie> {
    return Valkeyrie[kFromAsync](iterable, options, this.schemaRegistry)
  }
}
