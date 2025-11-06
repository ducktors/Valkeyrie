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

    test('exact match takes precedence over wildcard regardless of registration order', () => {
      const registry = new SchemaRegistry()
      const wildcardSchema = createMockSchema('wildcard')
      const exactSchema = createMockSchema('exact')

      // Register wildcard first, exact second
      registry.register(['users', '*'], wildcardSchema)
      registry.register(['users', 'alice'], exactSchema)

      // Exact match should win even though wildcard was registered first
      const found = registry.getSchema(['users', 'alice'])
      assert.strictEqual(found, exactSchema)
    })

    test('throws error when registering duplicate wildcard pattern', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      // First registration succeeds
      registry.register(['users', '*'], schema1)

      // Second registration with same pattern should throw
      assert.throws(
        () => {
          registry.register(['users', '*'], schema2)
        },
        (error: Error) => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes('already registered'))
          assert.ok(error.message.includes('[users, *]'))
          return true
        },
      )
    })

    test('throws error when registering duplicate exact pattern', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      // First registration succeeds
      registry.register(['users', 'alice'], schema1)

      // Second registration with same pattern should throw
      assert.throws(
        () => {
          registry.register(['users', 'alice'], schema2)
        },
        (error: Error) => {
          assert.ok(error instanceof Error)
          assert.ok(error.message.includes('already registered'))
          assert.ok(error.message.includes('[users, alice]'))
          return true
        },
      )
    })

    test('allows different patterns to coexist', () => {
      const registry = new SchemaRegistry()
      const exactSchema = createMockSchema('exact')
      const wildcardSchema = createMockSchema('wildcard')

      // These are different patterns, both should succeed
      registry.register(['users', 'alice'], exactSchema)
      registry.register(['users', '*'], wildcardSchema)

      // Exact match for alice
      const foundAlice = registry.getSchema(['users', 'alice'])
      assert.strictEqual(foundAlice, exactSchema)

      // Wildcard match for bob
      const foundBob = registry.getSchema(['users', 'bob'])
      assert.strictEqual(foundBob, wildcardSchema)
    })
  })

  describe('Duplicate Registration Prevention', () => {
    test('detects duplicate patterns with different key types', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      // Register with number key
      registry.register(['items', 123], schema1)

      // Try to register same pattern again
      assert.throws(
        () => {
          registry.register(['items', 123], schema2)
        },
        (error: Error) => {
          assert.ok(error.message.includes('already registered'))
          return true
        },
      )
    })

    test('detects duplicate patterns with bigint', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      registry.register(['data', 123n], schema1)

      assert.throws(() => {
        registry.register(['data', 123n], schema2)
      }, Error)
    })

    test('detects duplicate patterns with boolean', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      registry.register(['flags', true], schema1)

      assert.throws(() => {
        registry.register(['flags', true], schema2)
      }, Error)
    })

    test('detects duplicate patterns with Uint8Array', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      registry.register(['binary', new Uint8Array([1, 2, 3])], schema1)

      assert.throws(() => {
        registry.register(['binary', new Uint8Array([1, 2, 3])], schema2)
      }, Error)
    })

    test('allows similar patterns with different values', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      // These are different patterns
      registry.register(['items', 123], schema1)
      registry.register(['items', 456], schema2) // Different number - should succeed

      const found1 = registry.getSchema(['items', 123])
      assert.strictEqual(found1, schema1)

      const found2 = registry.getSchema(['items', 456])
      assert.strictEqual(found2, schema2)
    })

    test('detects duplicate nested patterns', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      registry.register(['users', '*', 'posts', '*'], schema1)

      assert.throws(
        () => {
          registry.register(['users', '*', 'posts', '*'], schema2)
        },
        (error: Error) => {
          assert.ok(error.message.includes('already registered'))
          return true
        },
      )
    })

    test('detects duplicate empty pattern', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('first')
      const schema2 = createMockSchema('second')

      registry.register([], schema1)

      assert.throws(() => {
        registry.register([], schema2)
      }, Error)
    })
  })

  describe('Exact Match Priority', () => {
    test('exact match wins over wildcard - wildcard registered first', () => {
      const registry = new SchemaRegistry()
      const wildcardSchema = createMockSchema('wildcard')
      const exactSchema = createMockSchema('exact')

      registry.register(['users', '*'], wildcardSchema)
      registry.register(['users', 'alice'], exactSchema)

      const found = registry.getSchema(['users', 'alice'])
      assert.strictEqual(found, exactSchema)
    })

    test('exact match wins over wildcard - exact registered first', () => {
      const registry = new SchemaRegistry()
      const exactSchema = createMockSchema('exact')
      const wildcardSchema = createMockSchema('wildcard')

      registry.register(['users', 'alice'], exactSchema)
      registry.register(['users', '*'], wildcardSchema)

      const found = registry.getSchema(['users', 'alice'])
      assert.strictEqual(found, exactSchema)
    })

    test('exact match wins with multiple wildcards registered', () => {
      const registry = new SchemaRegistry()
      const wildcard1 = createMockSchema('wildcard1')
      const wildcard2 = createMockSchema('wildcard2')
      const exactSchema = createMockSchema('exact')

      registry.register(['users', '*'], wildcard1)
      registry.register(['*', 'alice'], wildcard2)
      registry.register(['users', 'alice'], exactSchema)

      const found = registry.getSchema(['users', 'alice'])
      assert.strictEqual(found, exactSchema)
    })

    test('exact match with nested paths wins over nested wildcards', () => {
      const registry = new SchemaRegistry()
      const wildcardSchema = createMockSchema('wildcard')
      const exactSchema = createMockSchema('exact')

      registry.register(['users', '*', 'posts', '*'], wildcardSchema)
      registry.register(['users', 'alice', 'posts', 'p1'], exactSchema)

      const found = registry.getSchema(['users', 'alice', 'posts', 'p1'])
      assert.strictEqual(found, exactSchema)
    })

    test('wildcard match works when no exact match exists', () => {
      const registry = new SchemaRegistry()
      const wildcardSchema = createMockSchema('wildcard')
      const exactSchema = createMockSchema('exact')

      registry.register(['users', '*'], wildcardSchema)
      registry.register(['users', 'alice'], exactSchema)

      // Query for 'bob' should match wildcard
      const found = registry.getSchema(['users', 'bob'])
      assert.strictEqual(found, wildcardSchema)
    })

    test('partial wildcard is not an exact match', () => {
      const registry = new SchemaRegistry()
      const partialWildcard = createMockSchema('partialWildcard')
      const exactSchema = createMockSchema('exact')

      // Pattern with one wildcard and exact parts
      registry.register(['users', '*', 'profile'], partialWildcard)
      registry.register(['users', 'alice', 'profile'], exactSchema)

      const found = registry.getSchema(['users', 'alice', 'profile'])
      assert.strictEqual(found, exactSchema)
    })

    test('mixed priority with different patterns', () => {
      const registry = new SchemaRegistry()
      const schema1 = createMockSchema('exact1')
      const schema2 = createMockSchema('wildcard1')
      const schema3 = createMockSchema('exact2')

      registry.register(['users', 'alice', 'posts'], schema1)
      registry.register(['users', '*', 'posts'], schema2)
      registry.register(['users', 'alice', 'comments'], schema3)

      // Exact match for 'posts'
      const found1 = registry.getSchema(['users', 'alice', 'posts'])
      assert.strictEqual(found1, schema1)

      // Exact match for 'comments'
      const found2 = registry.getSchema(['users', 'alice', 'comments'])
      assert.strictEqual(found2, schema3)

      // Wildcard match for 'bob'
      const found3 = registry.getSchema(['users', 'bob', 'posts'])
      assert.strictEqual(found3, schema2)
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
