import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Key } from '../valkeyrie.js'

/**
 * Checks if a single key part matches a pattern part
 * - '*' matches anything
 * - Otherwise requires exact match
 */
type MatchesKeyPart<TKeyPart, TPatternPart> = TPatternPart extends '*'
  ? true
  : TKeyPart extends TPatternPart
    ? true
    : false

/**
 * Recursively checks if a key tuple matches a pattern tuple
 */
type MatchesPattern<
  TKey extends Key,
  TPattern extends Key,
> = TKey extends readonly [infer KFirst, ...infer KRest]
  ? TPattern extends readonly [infer PFirst, ...infer PRest]
    ? MatchesKeyPart<KFirst, PFirst> extends true
      ? MatchesPattern<
          KRest extends Key ? KRest : never,
          PRest extends Key ? PRest : never
        >
      : false
    : false
  : TPattern extends readonly []
    ? true
    : false

/**
 * Schema registry entry: [pattern, schema]
 */
export type SchemaRegistryEntry = readonly [
  pattern: Key,
  schema: StandardSchemaV1,
]

/**
 * Schema registry: tuple of entries
 */
export type SchemaRegistry = readonly SchemaRegistryEntry[]

/**
 * Finds the first matching schema for a key in the registry
 * Returns the schema if found, never if not found
 */
type FindMatchingSchema<
  TRegistry extends SchemaRegistry,
  TKey extends Key,
> = TRegistry extends readonly [
  infer First extends SchemaRegistryEntry,
  ...infer Rest extends SchemaRegistry,
]
  ? First extends readonly [infer Pattern extends Key, infer Schema]
    ? MatchesPattern<TKey, Pattern> extends true
      ? Schema
      : FindMatchingSchema<Rest, TKey>
    : never
  : never

/**
 * Extracts the output type from a StandardSchemaV1
 */
type InferSchemaOutput<TSchema> = TSchema extends StandardSchemaV1<
  infer _Input,
  infer Output
>
  ? Output
  : unknown

/**
 * Finds matching schema for a key and infers its output type
 * Returns unknown if no schema matches
 */
export type InferTypeForKey<
  TRegistry extends SchemaRegistry,
  TKey extends Key,
> = FindMatchingSchema<TRegistry, TKey> extends never
  ? unknown
  : InferSchemaOutput<FindMatchingSchema<TRegistry, TKey>>

/**
 * Checks if a pattern starts with a given prefix
 * For example:
 * - Pattern ['users', '*'] starts with prefix ['users']
 * - Pattern ['users', '*', 'posts'] starts with prefix ['users']
 */
type PatternStartsWithPrefix<
  TPattern extends Key,
  TPrefix extends Key,
> = TPrefix extends readonly []
  ? true
  : TPrefix extends readonly [infer PFirst, ...infer PRest]
    ? TPattern extends readonly [infer PatFirst, ...infer PatRest]
      ? PFirst extends PatFirst
        ? PatternStartsWithPrefix<
            PatRest extends Key ? PatRest : never,
            PRest extends Key ? PRest : never
          >
        : false
      : false
    : false

/**
 * Finds the first schema in the registry whose pattern starts with the given prefix
 */
type FindSchemaForPrefix<
  TRegistry extends SchemaRegistry,
  TPrefix extends Key,
> = TRegistry extends readonly [
  infer First extends SchemaRegistryEntry,
  ...infer Rest extends SchemaRegistry,
]
  ? First extends readonly [infer Pattern extends Key, infer Schema]
    ? PatternStartsWithPrefix<Pattern, TPrefix> extends true
      ? Schema
      : FindSchemaForPrefix<Rest, TPrefix>
    : never
  : never

/**
 * Infers the output type for entries returned by list() with a given prefix
 * Returns unknown if no schema pattern matches the prefix
 */
export type InferTypeForPrefix<
  TRegistry extends SchemaRegistry,
  TPrefix extends Key,
> = FindSchemaForPrefix<TRegistry, TPrefix> extends never
  ? unknown
  : InferSchemaOutput<FindSchemaForPrefix<TRegistry, TPrefix>>
