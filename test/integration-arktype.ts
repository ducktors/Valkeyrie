import assert from 'node:assert'
import { describe, test } from 'node:test'
import { type } from 'arktype'
import { ValidationError } from '../src/validation-error.js'
import { Valkeyrie } from '../src/valkeyrie.js'

describe('Integration with ArkType', () => {
  describe('Basic Schema Validation', () => {
    test('validates valid data with ArkType schema', async () => {
      const userSchema = type({
        name: 'string',
        email: 'string.email',
        'age?': 'number>=0',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const result = await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      assert.strictEqual(result.ok, true)

      const entry = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(entry.value?.name, 'Alice')
      assert.strictEqual(entry.value?.email, 'alice@example.com')
      assert.strictEqual(entry.value?.age, 30)

      await db.close()
    })

    test('throws ValidationError for invalid data', async () => {
      const userSchema = type({
        name: 'string',
        email: 'string.email',
        age: 'number>=0',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await assert.rejects(
        async () => {
          await db.set(['users', 'bob'], {
            name: 'Bob',
            email: 'invalid-email',
            age: 25,
          })
        },
        (error: Error) => {
          assert.ok(error instanceof ValidationError)
          assert.deepStrictEqual(error.key, ['users', 'bob'])
          assert.ok(error.issues.length > 0)
          return true
        },
      )

      await db.close()
    })

    test('throws ValidationError for missing required field', async () => {
      const userSchema = type({
        name: 'string',
        email: 'string.email',
        age: 'number',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await assert.rejects(
        async () => {
          await db.set(['users', 'charlie'], {
            name: 'Charlie',
            email: 'charlie@example.com',
            // age is missing
          })
        },
        (error: Error) => {
          assert.ok(error instanceof ValidationError)
          return true
        },
      )

      await db.close()
    })

    test('applies schema transformations with morphs', async () => {
      const userSchema = type({
        name: 'string',
        age: 'number',
      }).pipe((data) => ({
        ...data,
        name: data.name.toUpperCase(),
      }))

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'dave'], {
        name: 'dave',
        age: 35,
      })

      const entry = await db.get<typeof userSchema>(['users', 'dave'])
      assert.strictEqual(entry.value?.name, 'DAVE')
      assert.strictEqual(entry.value?.age, 35)

      await db.close()
    })
  })

  describe('Wildcard Pattern Matching', () => {
    test('validates with multiple schemas', async () => {
      const userSchema = type({
        name: 'string',
        email: 'string.email',
      })

      const postSchema = type({
        title: 'string',
        content: 'string',
        published: 'boolean',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema)
        .withSchema(['posts', '*'], postSchema)
        .open()

      // Valid user
      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
      })

      // Valid post
      await db.set(['posts', 'p1'], {
        title: 'Hello World',
        content: 'This is my first post',
        published: true,
      })

      const user = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(user.value?.name, 'Alice')

      const post = await db.get<typeof postSchema>(['posts', 'p1'])
      assert.strictEqual(post.value?.title, 'Hello World')

      await db.close()
    })

    test('validates nested wildcard patterns', async () => {
      const commentSchema = type({
        text: 'string',
        author: 'string',
      })

      const db = await Valkeyrie.withSchema(
        ['users', '*', 'posts', '*', 'comments', '*'],
        commentSchema,
      ).open()

      await db.set(['users', 'alice', 'posts', 'p1', 'comments', 'c1'], {
        text: 'Great post!',
        author: 'Bob',
      })

      const comment = await db.get<typeof commentSchema>([
        'users',
        'alice',
        'posts',
        'p1',
        'comments',
        'c1',
      ])
      assert.strictEqual(comment.value?.text, 'Great post!')

      await db.close()
    })

    test('allows keys without matching schema (permissive mode)', async () => {
      const userSchema = type({
        name: 'string',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      // This key doesn't match any schema, so no validation
      await db.set(['settings', 'theme'], { color: 'dark' })

      const entry = await db.get(['settings', 'theme'])
      assert.deepStrictEqual(entry.value, { color: 'dark' })

      await db.close()
    })
  })

  describe('Atomic Operations', () => {
    test('validates all mutations at commit time', async () => {
      const userSchema = type({
        name: 'string',
        email: 'string.email',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const atomic = db.atomic()
      atomic.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
      })
      atomic.set(['users', 'bob'], { name: 'Bob', email: 'bob@example.com' })

      const result = await atomic.commit()
      assert.strictEqual(result.ok, true)

      const alice = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(alice.value?.name, 'Alice')

      const bob = await db.get<typeof userSchema>(['users', 'bob'])
      assert.strictEqual(bob.value?.name, 'Bob')

      await db.close()
    })

    test('fails atomic commit if any validation fails', async () => {
      const userSchema = type({
        name: 'string',
        email: 'string.email',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const atomic = db.atomic()
      atomic.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
      })
      atomic.set(['users', 'bob'], { name: 'Bob', email: 'invalid-email' })

      await assert.rejects(
        async () => {
          await atomic.commit()
        },
        (error: Error) => {
          assert.ok(error instanceof ValidationError)
          assert.deepStrictEqual(error.key, ['users', 'bob'])
          return true
        },
      )

      // Verify nothing was committed
      const alice = await db.get(['users', 'alice'])
      assert.strictEqual(alice.value, null)

      await db.close()
    })

    test('validates with transformations in atomic operations', async () => {
      const userSchema = type({
        name: 'string',
        age: 'number',
      }).pipe((data) => ({
        ...data,
        name: data.name.toUpperCase(),
      }))

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const atomic = db.atomic()
      atomic.set(['users', 'alice'], { name: 'alice', age: 30 })
      atomic.set(['users', 'bob'], { name: 'bob', age: 25 })

      await atomic.commit()

      const alice = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(alice.value?.name, 'ALICE')

      const bob = await db.get<typeof userSchema>(['users', 'bob'])
      assert.strictEqual(bob.value?.name, 'BOB')

      await db.close()
    })
  })

  describe('Reserved Characters', () => {
    test('throws TypeError when using * as key part', async () => {
      const userSchema = type({ name: 'string' })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await assert.rejects(
        async () => {
          await db.set(['users', '*'], { name: 'Alice' })
        },
        (error: Error) => {
          assert.ok(error instanceof TypeError)
          assert.ok(error.message.includes('reserved'))
          return true
        },
      )

      await db.close()
    })

    test('throws TypeError when using * in atomic operations', async () => {
      const userSchema = type({ name: 'string' })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      assert.throws(() => {
        const atomic = db.atomic()
        atomic.set(['users', '*'], { name: 'Alice' })
      }, TypeError)

      await db.close()
    })
  })

  describe('Factory Methods', () => {
    test('from() validates data from iterable', async () => {
      const userSchema = type({
        id: 'number',
        name: 'string',
        email: 'string.email',
      })

      const users = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).from(
        users,
        {
          prefix: ['users'],
          keyProperty: 'id',
          destroyOnClose: true,
        },
      )

      const alice = await db.get<typeof userSchema>(['users', 1])
      assert.strictEqual(alice.value?.name, 'Alice')

      const bob = await db.get<typeof userSchema>(['users', 2])
      assert.strictEqual(bob.value?.name, 'Bob')

      await db.close()
    })

    test('from() rejects if validation fails', async () => {
      const userSchema = type({
        id: 'number',
        name: 'string',
        email: 'string.email',
      })

      const users = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'invalid-email' },
      ]

      await assert.rejects(
        async () => {
          await Valkeyrie.withSchema(['users', '*'], userSchema).from(users, {
            prefix: ['users'],
            keyProperty: 'id',
            destroyOnClose: true,
          })
        },
        (error: Error) => {
          assert.ok(error instanceof ValidationError)
          return true
        },
      )
    })

    test('fromAsync() validates data from async iterable', async () => {
      const userSchema = type({
        id: 'number',
        name: 'string',
        email: 'string.email',
      })

      async function* generateUsers() {
        yield { id: 1, name: 'Alice', email: 'alice@example.com' }
        yield { id: 2, name: 'Bob', email: 'bob@example.com' }
      }

      const db = await Valkeyrie.withSchema(
        ['users', '*'],
        userSchema,
      ).fromAsync(generateUsers(), {
        prefix: ['users'],
        keyProperty: 'id',
        destroyOnClose: true,
      })

      const alice = await db.get<typeof userSchema>(['users', 1])
      assert.strictEqual(alice.value?.name, 'Alice')

      await db.close()
    })
  })

  describe('Complex Schemas', () => {
    test('validates nested objects', async () => {
      const userSchema = type({
        name: 'string',
        profile: {
          bio: 'string',
          avatar: 'string.url',
        },
        tags: 'string[]',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        profile: {
          bio: 'Software Engineer',
          avatar: 'https://example.com/avatar.jpg',
        },
        tags: ['developer', 'typescript'],
      })

      const entry = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(entry.value?.name, 'Alice')
      assert.strictEqual(entry.value?.profile.bio, 'Software Engineer')
      assert.strictEqual(entry.value?.tags.length, 2)

      await db.close()
    })

    test('validates with optional fields', async () => {
      const userSchema = type({
        name: 'string',
        email: 'string.email',
        'phone?': 'string',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
      })

      await db.set(['users', 'bob'], {
        name: 'Bob',
        email: 'bob@example.com',
        phone: '+1234567890',
      })

      const alice = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(alice.value?.phone, undefined)

      const bob = await db.get<typeof userSchema>(['users', 'bob'])
      assert.strictEqual(bob.value?.phone, '+1234567890')

      await db.close()
    })

    test('validates with numeric constraints', async () => {
      const userSchema = type({
        name: 'string',
        age: 'number>=0',
        score: 'number',
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        age: 30,
        score: 95,
      })

      const entry = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(entry.value?.name, 'Alice')
      assert.strictEqual(entry.value?.age, 30)
      assert.strictEqual(entry.value?.score, 95)

      // Invalid age
      await assert.rejects(async () => {
        await db.set(['users', 'bob'], {
          name: 'Bob',
          age: -5,
          score: 80,
        })
      }, ValidationError)

      await db.close()
    })
  })
})
