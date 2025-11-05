import assert from 'node:assert'
import { describe, test } from 'node:test'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { SchemaRegistry } from '../src/schema-registry.js'

// Mock schema for testing
const createMockSchema = (name: string): StandardSchemaV1 =>
  ({
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value: unknown) => ({
        value,
        issues: undefined,
      }),
    },
    _name: name,
  }) as unknown as StandardSchemaV1

describe('SchemaRegistry', () => {
  describe('Basic Pattern Matching', () => {
    test('registers and finds schema with exact pattern', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('user')

      registry.register(['users', 'alice'], schema)

      const found = registry.getSchema(['users', 'alice'])
      assert.strictEqual(found, schema)
    })

    test('returns null when no schema matches', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('user')

      registry.register(['users', 'alice'], schema)

      const found = registry.getSchema(['posts', '123'])
      assert.strictEqual(found, null)
    })

    test('handles empty pattern array', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('root')

      registry.register([], schema)

      const found1 = registry.getSchema([])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema(['anything'])
      assert.strictEqual(found2, null)
    })
  })

  describe('Wildcard Matching', () => {
    test('matches wildcard pattern with single wildcard', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('user')

      registry.register(['users', '*'], schema)

      const found1 = registry.getSchema(['users', 'alice'])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema(['users', 'bob'])
      assert.strictEqual(found2, schema)

      const found3 = registry.getSchema(['users', 123])
      assert.strictEqual(found3, schema)
    })

    test('matches pattern with multiple wildcards', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('userPost')

      registry.register(['users', '*', 'posts', '*'], schema)

      const found1 = registry.getSchema(['users', 'alice', 'posts', '123'])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema(['users', 'bob', 'posts', '456'])
      assert.strictEqual(found2, schema)
    })

    test('wildcard at different positions', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('test')

      registry.register(['*', 'users', 'profile'], schema)

      const found1 = registry.getSchema(['app', 'users', 'profile'])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema(['admin', 'users', 'profile'])
      assert.strictEqual(found2, schema)

      const found3 = registry.getSchema(['app', 'posts', 'profile'])
      assert.strictEqual(found3, null)
    })

    test('all wildcards pattern', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('all')

      registry.register(['*', '*', '*'], schema)

      const found1 = registry.getSchema(['a', 'b', 'c'])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema([1, 2, 3])
      assert.strictEqual(found2, schema)

      const found3 = registry.getSchema(['x', 'y'])
      assert.strictEqual(found3, null) // Wrong length
    })

    test('wildcard can match any type including Uint8Array', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('any')

      registry.register(['data', '*'], schema)

      const found = registry.getSchema(['data', new Uint8Array([1, 2, 3])])
      assert.strictEqual(found, schema)
    })

    test('wildcards must match exact positions', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('userPost')

      registry.register(['users', '*', 'posts', '*'], schema)

      const found = registry.getSchema(['users', 'alice', 'comments', '123'])
      assert.strictEqual(found, null)
    })

    test('wildcard does not match different length keys', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('user')

      registry.register(['users', '*'], schema)

      const found1 = registry.getSchema(['users'])
      assert.strictEqual(found1, null)

      const found2 = registry.getSchema(['users', 'alice', 'profile'])
      assert.strictEqual(found2, null)
    })
  })

  describe('Key Part Types', () => {
    test('matches different key part types', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('mixed')

      registry.register(['data', '*'], schema)

      const found1 = registry.getSchema(['data', 'string'])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema(['data', 42])
      assert.strictEqual(found2, schema)

      const found3 = registry.getSchema(['data', 42n])
      assert.strictEqual(found3, schema)

      const found4 = registry.getSchema(['data', true])
      assert.strictEqual(found4, schema)

      const found5 = registry.getSchema(['data', new Uint8Array([1, 2, 3])])
      assert.strictEqual(found5, schema)
    })

    test('matches Uint8Array key parts correctly', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('binary')

      const pattern = ['data', new Uint8Array([1, 2, 3])]
      registry.register(pattern, schema)

      const found1 = registry.getSchema(['data', new Uint8Array([1, 2, 3])])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema(['data', new Uint8Array([1, 2, 4])])
      assert.strictEqual(found2, null)
    })

    test('bigint key parts match correctly', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('bigint')

      registry.register(['data', 123n], schema)

      const found1 = registry.getSchema(['data', 123n])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema(['data', 124n])
      assert.strictEqual(found2, null)

      // bigint and number are different types
      const found3 = registry.getSchema(['data', 123])
      assert.strictEqual(found3, null)
    })

    test('boolean key parts match correctly', () => {
      const registry = new SchemaRegistry()
      const schema = createMockSchema('boolean')

      registry.register(['flags', true], schema)

      const found1 = registry.getSchema(['flags', true])
      assert.strictEqual(found1, schema)

      const found2 = registry.getSchema(['flags', false])
      assert.strictEqual(found2, null)
    })
  })

  describe('Multiple Schema Registration', () => {
    test('multiple schemas can be registered', () => {
      const registry = new SchemaRegistry()
      const userSchema = createMockSchema('user')
      const postSchema = createMockSchema('post')
      const commentSchema = createMockSchema('comment')

      registry.register(['users', '*'], userSchema)
      registry.register(['posts', '*'], postSchema)
      registry.register(['comments', '*'], commentSchema)

      const found1 = registry.getSchema(['users', 'alice'])
      assert.strictEqual(found1, userSchema)

      const found2 = registry.getSchema(['posts', '123'])
      assert.strictEqual(found2, postSchema)

      const found3 = registry.getSchema(['comments', '456'])
      assert.strictEqual(found3, commentSchema)
    })

    test('exact match takes precedence with first registered', () => {
      const registry = new SchemaRegistry()
      const wildcardSchema = createMockSchema('wildcard')
      const exactSchema = createMockSchema('exact')

      registry.register(['users', '*'], wildcardSchema)
      registry.register(['users', 'alice'], exactSchema)

      // First registered pattern wins (linear search)
      const found = registry.getSchema(['users', 'alice'])
      assert.strictEqual(found, wildcardSchema)
    })
  })

  describe('Registry Inspection', () => {
    test('listSchemas returns all registered patterns with schemas', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('users')
      const schema2 = createMockSchema('posts')

      registry.register(['users', '*'], schema1)
      registry.register(['posts', '*'], schema2)

      const schemas = registry.listSchemas()
      assert.strictEqual(schemas.length, 2)
      assert.deepStrictEqual(schemas[0], [['users', '*'], schema1])
      assert.deepStrictEqual(schemas[1], [['posts', '*'], schema2])
    })
  })
})
