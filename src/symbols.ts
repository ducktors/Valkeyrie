/**
 * Internal symbols for Valkeyrie.
 * These symbols are not exported in package.json and provide true runtime privacy.
 */

/**
 * Symbol used to protect the Valkeyrie constructor.
 * Ensures instances can only be created through static factory methods.
 */
export const kValkeyrie = Symbol('Valkeyrie')

/**
 * Symbol returned by commitVersionstamp() method.
 * Used to indicate where the versionstamp should be injected in atomic operations.
 */
export const kCommitVersionstamp = Symbol('CommitVersionstamp')

/**
 * Internal symbol for opening a Valkeyrie instance with schemas.
 * Only accessible to ValkeyrieBuilder.
 */
export const kOpen = Symbol('open')

/**
 * Internal symbol for creating a Valkeyrie instance from an iterable with schemas.
 * Only accessible to ValkeyrieBuilder.
 */
export const kFrom = Symbol('from')

/**
 * Internal symbol for creating a Valkeyrie instance from an async iterable with schemas.
 * Only accessible to ValkeyrieBuilder.
 */
export const kFromAsync = Symbol('fromAsync')

/**
 * Internal symbol for accessing the schema registry.
 * Only accessible to AtomicOperation for validation.
 */
export const kSchemaRegistry = Symbol('schemaRegistry')
