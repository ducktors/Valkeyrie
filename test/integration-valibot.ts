import assert from 'node:assert'
import { describe, test } from 'node:test'
import * as v from 'valibot'
import { ValidationError } from '../src/validation-error.js'
import { type EntryMaybe, Valkeyrie } from '../src/valkeyrie.js'

describe('Integration with Valibot', () => {
  describe('Basic Schema Validation', () => {
    test('validates valid data with Valibot schema', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const result = await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      assert.strictEqual(result.ok, true)

      const entry = await db.get(['users', 'alice'])
      assert.strictEqual(entry.value?.name, 'Alice')
      assert.strictEqual(entry.value?.email, 'alice@example.com')
      assert.strictEqual(entry.value?.age, 30)

      await db.close()
    })

    test('throws ValidationError for invalid data', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
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
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.number(),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await assert.rejects(
        async () => {
          // @ts-expect-error - age is missing
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
      const userSchema = v.object({
        name: v.pipe(
          v.string(),
          v.transform((name) => name.toUpperCase()),
        ),
        age: v.number(),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'dave'], {
        name: 'dave',
        age: 35,
      })

      const entry = await db.get(['users', 'dave'])
      assert.strictEqual(entry.value?.name, 'DAVE')
      assert.strictEqual(entry.value?.age, 35)

      await db.close()
    })
  })

  describe('Type Inference and Type Safety', () => {
    test('infers correct type for matching schema pattern', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const user = await db.get(['users', 'alice'])

      const _typeCheck: EntryMaybe<{
        name: string
        email: string
        age: number
      }> = user

      assert.ok(true, 'Type inference successful')
      await db.close()
    })

    test('infers different types for different schema patterns', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const postSchema = v.object({
        title: v.string(),
        content: v.string(),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema)
        .withSchema(['posts', '*'], postSchema)
        .open()

      const user = await db.get(['users', 'alice'])
      const post = await db.get(['posts', '123'])

      const _userCheck: EntryMaybe<{
        name: string
        email: string
        age: number
      }> = user
      const _postCheck: EntryMaybe<{ title: string; content: string }> = post

      assert.ok(true, 'Different types inferred correctly')
      await db.close()
    })

    test('returns unknown for non-matching keys', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const unknown = await db.get(['comments', '456'])

      const _typeCheck: EntryMaybe<unknown> = unknown

      assert.ok(true, 'Unknown type for non-matching pattern')
      await db.close()
    })

    test('wildcard matches different key types', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const user1 = await db.get(['users', 'alice'])
      const user2 = await db.get(['users', 123])

      const _check1: EntryMaybe<{
        name: string
        email: string
        age: number
      }> = user1
      const _check2: EntryMaybe<{
        name: string
        email: string
        age: number
      }> = user2

      assert.ok(true, 'Wildcard matches various key types')
      await db.close()
    })
  })

  describe('Wildcard Pattern Matching', () => {
    test('validates with multiple schemas', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
      })

      const postSchema = v.object({
        title: v.string(),
        content: v.string(),
        published: v.boolean(),
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

      const user = await db.get(['users', 'alice'])
      assert.strictEqual(user.value?.name, 'Alice')

      const post = await db.get(['posts', 'p1'])
      assert.strictEqual(post.value?.title, 'Hello World')

      await db.close()
    })

    test('validates nested wildcard patterns', async () => {
      const commentSchema = v.object({
        text: v.string(),
        author: v.string(),
      })

      const db = await Valkeyrie.withSchema(
        ['users', '*', 'posts', '*', 'comments', '*'],
        commentSchema,
      ).open()

      await db.set(['users', 'alice', 'posts', 'p1', 'comments', 'c1'], {
        text: 'Great post!',
        author: 'Bob',
      })

      const comment = await db.get([
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
      const userSchema = v.object({
        name: v.string(),
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
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
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

      const alice = await db.get(['users', 'alice'])
      assert.strictEqual(alice.value?.name, 'Alice')

      const bob = await db.get(['users', 'bob'])
      assert.strictEqual(bob.value?.name, 'Bob')

      await db.close()
    })

    test('fails atomic commit if any validation fails', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
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
      const userSchema = v.object({
        name: v.pipe(
          v.string(),
          v.transform((name) => name.toUpperCase()),
        ),
        age: v.number(),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      const atomic = db.atomic()
      atomic.set(['users', 'alice'], { name: 'alice', age: 30 })
      atomic.set(['users', 'bob'], { name: 'bob', age: 25 })

      await atomic.commit()

      const alice = await db.get(['users', 'alice'])
      assert.strictEqual(alice.value?.name, 'ALICE')

      const bob = await db.get(['users', 'bob'])
      assert.strictEqual(bob.value?.name, 'BOB')

      await db.close()
    })
  })

  describe('Reserved Characters', () => {
    test('throws TypeError when using * as key part', async () => {
      const userSchema = v.object({ name: v.string() })

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
      const userSchema = v.object({ name: v.string() })

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
      const userSchema = v.object({
        id: v.number(),
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
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

      const alice = await db.get(['users', 1])
      assert.strictEqual(alice.value?.name, 'Alice')

      const bob = await db.get(['users', 2])
      assert.strictEqual(bob.value?.name, 'Bob')

      await db.close()
    })

    test('from() rejects if validation fails', async () => {
      const userSchema = v.object({
        id: v.number(),
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
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
      const userSchema = v.object({
        id: v.number(),
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
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

      const alice = await db.get(['users', 1])
      assert.strictEqual(alice.value?.name, 'Alice')

      await db.close()
    })
  })

  describe('getMany() Operations', () => {
    test('with explicit type parameter validates multiple entries', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      await db.set(['users', 'bob'], {
        name: 'Bob',
        email: 'bob@example.com',
        age: 25,
      })

      const typed = await db.getMany<{
        name: string
        email: string
        age: number
      }>([
        ['users', 'alice'],
        ['users', 'bob'],
      ])

      const _typeCheck: EntryMaybe<{
        name: string
        email: string
        age: number
      }>[] = typed

      assert.strictEqual(typed.length, 2)
      if (typed[0]?.value) {
        assert.strictEqual(typed[0].value.name, 'Alice')
        assert.strictEqual(typed[0].value.age, 30)
      }
      if (typed[1]?.value) {
        assert.strictEqual(typed[1].value.name, 'Bob')
        assert.strictEqual(typed[1].value.age, 25)
      }

      await db.close()
    })

    test('without type parameter returns unknown', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      const untyped = await db.getMany([['users', 'alice']])
      const _untypedCheck: EntryMaybe<unknown>[] = untyped

      assert.ok(true, 'getMany without type param returns unknown')
      await db.close()
    })

    test('validates entries with multiple different schemas', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
      })

      const postSchema = v.object({
        title: v.string(),
        content: v.string(),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema)
        .withSchema(['posts', '*'], postSchema)
        .open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
      })

      await db.set(['posts', 'p1'], {
        title: 'Hello World',
        content: 'My first post',
      })

      const results = await db.getMany([
        ['users', 'alice'],
        ['posts', 'p1'],
      ])

      assert.strictEqual(results.length, 2)
      assert.strictEqual(
        (results[0] as EntryMaybe<{ name: string }>)?.value?.name,
        'Alice',
      )
      assert.strictEqual(
        (results[1] as EntryMaybe<{ title: string }>)?.value?.title,
        'Hello World',
      )

      await db.close()
    })
  })

  describe('list() Operations', () => {
    test('with explicit type parameter validates iterated entries', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      await db.set(['users', 'bob'], {
        name: 'Bob',
        email: 'bob@example.com',
        age: 25,
      })

      const list = db.list<{ name: string; email: string; age: number }>({
        prefix: ['users'],
      })

      let found = 0
      for await (const entry of list) {
        const _typeCheck: { name: string; email: string; age: number } =
          entry.value
        if (entry.value.name === 'Alice') {
          assert.strictEqual(entry.value.age, 30)
          found++
        }
        if (entry.value.name === 'Bob') {
          assert.strictEqual(entry.value.age, 25)
          found++
        }
      }

      assert.strictEqual(found, 2, 'Found both users in list')
      await db.close()
    })

    test('validates entries with prefix matching', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
      })

      const postSchema = v.object({
        title: v.string(),
        content: v.string(),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema)
        .withSchema(['posts', '*'], postSchema)
        .open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
      })

      await db.set(['posts', 'p1'], {
        title: 'Hello',
        content: 'World',
      })

      const userList = db.list({ prefix: ['users'] })
      let userCount = 0
      for await (const entry of userList) {
        assert.ok((entry.value as { name: string }).name)
        userCount++
      }

      const postList = db.list({ prefix: ['posts'] })
      let postCount = 0
      for await (const entry of postList) {
        assert.ok((entry.value as { title: string }).title)
        postCount++
      }

      assert.strictEqual(userCount, 1, 'Found one user')
      assert.strictEqual(postCount, 1, 'Found one post')
      await db.close()
    })
  })

  describe('Edge Cases', () => {
    test('backward compatibility - database without schemas', async () => {
      const db = await Valkeyrie.open()

      const value = await db.get(['any', 'key'])
      const _typeCheck: EntryMaybe<unknown> = value

      assert.ok(true, 'Database without schemas returns unknown')
      await db.close()
    })

    test('multiple patterns - first match wins', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const postSchema = v.object({
        title: v.string(),
        content: v.string(),
      })

      const db = await Valkeyrie.withSchema(['data', '*', 'user'], userSchema)
        .withSchema(['data', '*', 'post'], postSchema)
        .open()

      const user = await db.get(['data', '123', 'user'])
      const post = await db.get(['data', '123', 'post'])

      const _userCheck: EntryMaybe<{
        name: string
        email: string
        age: number
      }> = user
      const _postCheck: EntryMaybe<{ title: string; content: string }> = post

      assert.ok(true, 'Multiple patterns work correctly')
      await db.close()
    })

    test('exact type assertions work', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        age: v.pipe(v.number(), v.minValue(0)),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      await db.set(['users', 'alice'], {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      })

      const user = await db.get(['users', 'alice'])

      const typed: EntryMaybe<{
        name: string
        email: string
        age: number
      }> = user

      if (typed.value) {
        const _name: string = typed.value.name
        const _email: string = typed.value.email
        const _age: number = typed.value.age

        assert.strictEqual(typed.value.name, 'Alice')
        assert.strictEqual(typed.value.age, 30)
      }

      await db.close()
    })
  })

  describe('Complex Schemas', () => {
    test('validates nested objects', async () => {
      const userSchema = v.object({
        name: v.string(),
        profile: v.object({
          bio: v.string(),
          avatar: v.pipe(v.string(), v.url()),
        }),
        tags: v.array(v.string()),
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

      const entry = await db.get(['users', 'alice'])
      assert.strictEqual(entry.value?.name, 'Alice')
      assert.strictEqual(entry.value?.profile.bio, 'Software Engineer')
      assert.strictEqual(entry.value?.tags.length, 2)

      await db.close()
    })

    test('validates with optional fields', async () => {
      const userSchema = v.object({
        name: v.string(),
        email: v.pipe(v.string(), v.email()),
        phone: v.optional(v.string()),
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

      const alice = await db.get(['users', 'alice'])
      assert.strictEqual(alice.value?.phone, undefined)

      const bob = await db.get(['users', 'bob'])
      assert.strictEqual(bob.value?.phone, '+1234567890')

      await db.close()
    })

    test('validates with default values', async () => {
      const userSchema = v.object({
        name: v.string(),
        role: v.optional(v.string(), 'user'),
        active: v.optional(v.boolean(), true),
      })

      const db = await Valkeyrie.withSchema(['users', '*'], userSchema).open()

      // @ts-expect-error - role and active are missing
      await db.set(['users', 'alice'], {
        name: 'Alice',
      })

      const entry = await db.get(['users', 'alice'])
      assert.strictEqual(entry.value?.name, 'Alice')
      assert.strictEqual(entry.value?.role, 'user')
      assert.strictEqual(entry.value?.active, true)

      await db.close()
    })
  })
})
