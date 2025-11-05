import assert from 'node:assert'
import { describe, test } from 'node:test'
import { z } from 'zod'
import { ValidationError } from '../src/validation-error.js'
import { Valkeyrie } from '../src/valkeyrie.js'

describe('Integration with Zod', () => {
  describe('Basic Schema Validation', () => {
    test('validates valid data with Zod schema', async () => {
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
        age: z.number().min(0),
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
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
        age: z.number().min(0),
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
          assert.ok(
            error.issues.some((issue) => issue.message.includes('email')),
          )
          return true
        },
      )

      await db.close()
    })

    test('throws ValidationError for missing required field', async () => {
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
        age: z.number(),
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

    test('applies schema transformations', async () => {
      const userSchema = z.object({
        name: z.string().transform((name) => name.toUpperCase()),
        age: z.number(),
      })

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
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
      })

      const postSchema = z.object({
        title: z.string(),
        content: z.string(),
        published: z.boolean(),
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
      const commentSchema = z.object({
        text: z.string(),
        author: z.string(),
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
      const userSchema = z.object({
        name: z.string(),
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
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
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
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
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
      const userSchema = z.object({
        name: z.string().transform((name) => name.toUpperCase()),
        age: z.number(),
      })

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

    test('validates only set mutations in mixed atomic operations', async () => {
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      // Set up initial data
      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
      })
      await db.set(['users', 'bob'], { name: 'Bob', email: 'bob@example.com' })
      await db.set(['settings', 'theme'], 'dark') // Unvalidated key

      const atomic = db.atomic()
      // Mix set, delete, and other mutations
      atomic.set(['users', 'charlie'], {
        name: 'Charlie',
        email: 'charlie@example.com',
      })
      atomic.delete(['users', 'alice'])
      atomic.delete(['settings', 'theme'])
      atomic.set(['users', 'dave'], { name: 'Dave', email: 'dave@example.com' })

      const result = await atomic.commit()
      assert.strictEqual(result.ok, true)

      // Verify set mutations were validated and committed
      const charlie = await db.get<typeof userSchema>(['users', 'charlie'])
      assert.strictEqual(charlie.value?.name, 'Charlie')

      const dave = await db.get<typeof userSchema>(['users', 'dave'])
      assert.strictEqual(dave.value?.name, 'Dave')

      // Verify deletes worked
      const alice = await db.get(['users', 'alice'])
      assert.strictEqual(alice.value, null)

      const settings = await db.get(['settings', 'theme'])
      assert.strictEqual(settings.value, null)

      await db.close()
    })

    test('fails atomic commit with mixed mutations if validation fails', async () => {
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      // Set up initial data
      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
      })

      const atomic = db.atomic()
      atomic.set(['users', 'bob'], { name: 'Bob', email: 'bob@example.com' })
      atomic.delete(['users', 'alice'])
      atomic.set(['users', 'charlie'], {
        name: 'Charlie',
        email: 'invalid-email',
      })

      await assert.rejects(
        async () => {
          await atomic.commit()
        },
        (error: Error) => {
          assert.ok(error instanceof ValidationError)
          assert.deepStrictEqual(error.key, ['users', 'charlie'])
          return true
        },
      )

      // Verify nothing was committed (all-or-nothing atomicity)
      const bob = await db.get<typeof userSchema>(['users', 'bob'])
      assert.strictEqual(bob.value, null)

      const alice = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(alice.value?.name, 'Alice') // Should still exist

      await db.close()
    })
  })

  describe('Reserved Characters', () => {
    test('throws TypeError when using * as key part', async () => {
      const userSchema = z.object({ name: z.string() })

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
      const userSchema = z.object({ name: z.string() })

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
      const userSchema = z.object({
        id: z.number(),
        name: z.string(),
        email: z.string().email(),
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
      const userSchema = z.object({
        id: z.number(),
        name: z.string(),
        email: z.string().email(),
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
      const userSchema = z.object({
        id: z.number(),
        name: z.string(),
        email: z.string().email(),
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
      const userSchema = z.object({
        name: z.string(),
        profile: z.object({
          bio: z.string(),
          avatar: z.string().url(),
        }),
        tags: z.array(z.string()),
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
      const userSchema = z.object({
        name: z.string(),
        email: z.string().email(),
        phone: z.string().optional(),
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

    test('validates with default values', async () => {
      const userSchema = z.object({
        name: z.string(),
        role: z.string().default('user'),
        active: z.boolean().default(true),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
      })

      const entry = await db.get<typeof userSchema>(['users', 'alice'])
      assert.strictEqual(entry.value?.name, 'Alice')
      assert.strictEqual(entry.value?.role, 'user')
      assert.strictEqual(entry.value?.active, true)

      await db.close()
    })
  })

  describe('Error Handling', () => {
    test('wraps non-ValidationError exceptions from schema', async () => {
      // Create a schema that throws a regular Error (not ValidationError)
      // biome-ignore lint/suspicious/noExplicitAny: test code
      const faultySchema: any = {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: () => {
            throw new Error('Something went wrong in validation')
          },
        },
      }

      const db = await Valkeyrie.withSchema(['users', '*'], faultySchema).open()

      await assert.rejects(
        async () => {
          await db.set(['users', 'alice'], { name: 'Alice' })
        },
        (error: Error) => {
          assert.ok(error instanceof ValidationError)
          assert.deepStrictEqual(error.key, ['users', 'alice'])
          assert.strictEqual(error.issues.length, 1)
          assert.ok(error.issues[0])
          assert.strictEqual(
            error.issues[0].message,
            'Something went wrong in validation',
          )
          return true
        },
      )

      await db.close()
    })

    test('handles schema returning undefined issues', async () => {
      // Schema that returns success with undefined issues
      // biome-ignore lint/suspicious/noExplicitAny: test code
      const passingSchema: any = {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value: unknown) => ({
            value,
            issues: undefined,
          }),
        },
      }

      const db = await Valkeyrie.withSchema(
        ['users', '*'],
        passingSchema,
      ).open()

      const result = await db.set(['users', 'alice'], { name: 'Alice' })
      assert.strictEqual(result.ok, true)

      await db.close()
    })

    test('handles schema with empty issues array', async () => {
      // Schema that returns empty issues array (should be treated as success)
      // biome-ignore lint/suspicious/noExplicitAny: test code
      const emptyIssuesSchema: any = {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value: unknown) => ({
            value,
            issues: [],
          }),
        },
      }

      const db = await Valkeyrie.withSchema(
        ['users', '*'],
        emptyIssuesSchema,
      ).open()

      // Empty issues array means validation failed but with no specific issues
      await assert.rejects(
        async () => {
          await db.set(['users', 'alice'], { name: 'Alice' })
        },
        (error: Error) => {
          assert.ok(error instanceof ValidationError)
          assert.strictEqual(error.issues.length, 0)
          return true
        },
      )

      await db.close()
    })
  })
})
