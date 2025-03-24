import assert, { AssertionError } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { inspect } from 'node:util'
import { KvU64 } from '../src/kv-u64.js'
import { type Key, type Mutation, Valkeyrie } from '../src/valkeyrie.js'

describe('test valkeyrie', async () => {
  async function dbTest(
    name: string,
    fn: (db: Valkeyrie) => Promise<void> | void,
  ) {
    await test(name, async () => {
      const db: Valkeyrie = await Valkeyrie.open()
      try {
        await fn(db)
      } finally {
        await db.close()
      }
    })
  }

  const ZERO_VERSIONSTAMP = '00000000000000000000'

  await dbTest('basic read-write-delete and versionstamps', async (db) => {
    const result1 = await db.get(['a'])
    assert.deepEqual(result1.key, ['a'])
    assert.deepEqual(result1.value, null)
    assert.deepEqual(result1.versionstamp, null)

    const setRes = await db.set(['a'], 'b')
    assert.ok(setRes.ok)
    assert.ok(setRes.versionstamp > ZERO_VERSIONSTAMP)
    const result2 = await db.get(['a'])
    assert.deepEqual(result2.key, ['a'])
    assert.deepEqual(result2.value, 'b')
    assert.deepEqual(result2.versionstamp, setRes.versionstamp)

    const setRes2 = await db.set(['a'], 'c')
    assert.ok(setRes2.ok)
    assert.ok(setRes2.versionstamp > setRes.versionstamp)
    const result3 = await db.get(['a'])
    assert.deepEqual(result3.key, ['a'])
    assert.deepEqual(result3.value, 'c')
    assert.deepEqual(result3.versionstamp, setRes2.versionstamp)

    await db.delete(['a'])
    const result4 = await db.get(['a'])
    assert.deepEqual(result4.key, ['a'])
    assert.deepEqual(result4.value, null)
    assert.deepEqual(result4.versionstamp, null)
  })

  const VALUE_CASES: { name: string; value: unknown }[] = [
    { name: 'string', value: 'hello' },
    { name: 'number', value: 42 },
    { name: 'bigint', value: 42n },
    { name: 'boolean', value: true },
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'Date', value: new Date(0) },
    { name: 'Uint8Array', value: new Uint8Array([1, 2, 3]) },
    { name: 'ArrayBuffer', value: new ArrayBuffer(3) },
    { name: 'array', value: [1, 2, 3] },
    { name: 'object', value: { a: 1, b: 2 } },
    {
      name: 'Map',
      value: new Map([
        ['a', 1],
        ['b', 2],
      ]),
    },
    { name: 'Set', value: new Set([1, 2, 3]) },
    {
      name: 'nested array',
      value: [
        [1, 2],
        [3, 4],
      ],
    },
  ]

  for (const { name, value } of VALUE_CASES.concat({
    name: 'nested object',
    value: VALUE_CASES.reduce<Record<string, unknown>>((acc, curr) => {
      acc[curr.name] = curr.value
      return acc
    }, {}),
  })) {
    await dbTest(`set and get ${name} value`, async (db) => {
      await db.set(['a'], value)
      const result = await db.get(['a'])
      assert.deepEqual(result.key, ['a'])
      assert.deepEqual(result.value, value)
    })
  }

  await dbTest('set and get recursive object', async (db) => {
    // biome-ignore lint/suspicious/noExplicitAny: testing
    const value: any = { a: undefined }
    value.a = value
    await db.set(['a'], value)
    const result = await db.get(['a'])
    assert.deepEqual(result.key, ['a'])

    // biome-ignore lint/suspicious/noExplicitAny: testing
    const resultValue: any = result.value
    assert(resultValue.a === resultValue)
  })

  // invalid values (as per structured clone algorithm with _for storage_, NOT JSON)
  const INVALID_VALUE_CASES = [
    { name: 'function', value: () => {} },
    { name: 'symbol', value: Symbol() },
    { name: 'WeakMap', value: new WeakMap() },
    { name: 'WeakSet', value: new WeakSet() },
    {
      name: 'SharedArrayBuffer',
      value: new SharedArrayBuffer(3),
    },
  ]

  for (const { name, value } of INVALID_VALUE_CASES) {
    await dbTest(`set and get ${name} value (invalid)`, async (db) => {
      // @ts-ignore - we are testing invalid values
      await assert.rejects(async () => await db.set(['a'], value), Error)
      const res = await db.get(['a'])
      assert.deepEqual(res.key, ['a'])
      assert.deepEqual(res.value, null)
    })
  }

  const keys = [
    ['a'],
    ['a', 'b'],
    ['a', 'b', 'c'],
    [1],
    ['a', 1],
    ['a', 1, 'b'],
    [1n],
    ['a', 1n],
    ['a', 1n, 'b'],
    [true],
    ['a', true],
    ['a', true, 'b'],
    [new Uint8Array([1, 2, 3])],
    ['a', new Uint8Array([1, 2, 3])],
    ['a', new Uint8Array([1, 2, 3]), 'b'],
    [1, 1n, true, new Uint8Array([1, 2, 3]), 'a'],
  ]

  for (const key of keys) {
    await dbTest(`set and get ${inspect(key)} key`, async (db) => {
      await db.set(key, 'b')
      const result = await db.get(key)
      assert.deepEqual(result.key, key)
      assert.deepEqual(result.value, 'b')
    })
  }

  const INVALID_KEYS = [
    [null],
    [undefined],
    [],
    [{}],
    [new Date()],
    [new ArrayBuffer(3)],
    [new Uint8Array([1, 2, 3]).buffer],
    [['a', 'b']],
  ]

  for (const key of INVALID_KEYS) {
    await dbTest(`set and get invalid key ${inspect(key)}`, async (db) => {
      await assert.rejects(async () => {
        // @ts-ignore - we are testing invalid keys
        await db.set(key, 'b')
      }, Error)
    })
  }

  await dbTest('compare and mutate', async (db) => {
    await db.set(['t'], '1')

    const currentValue = await db.get(['t'])
    assert(currentValue.versionstamp)
    assert(currentValue.versionstamp > ZERO_VERSIONSTAMP)

    let res = await db
      .atomic()
      .check({ key: ['t'], versionstamp: currentValue.versionstamp })
      .set(currentValue.key, '2')
      .commit()
    assert(res.ok)
    assert(res.versionstamp > currentValue.versionstamp)

    const newValue = await db.get(['t'])
    assert(newValue.versionstamp)
    assert(newValue.versionstamp > currentValue.versionstamp)
    assert.deepEqual(newValue.value, '2')

    res = await db
      .atomic()
      .check({ key: ['t'], versionstamp: currentValue.versionstamp })
      .set(currentValue.key, '3')
      .commit()
    assert(!res.ok)

    const newValue2 = await db.get(['t'])
    assert.deepEqual(newValue2.versionstamp, newValue.versionstamp)
    assert.deepEqual(newValue2.value, '2')
  })

  await dbTest('compare and mutate not exists', async (db) => {
    let res = await db
      .atomic()
      .check({ key: ['t'], versionstamp: null })
      .set(['t'], '1')
      .commit()
    assert(res.ok)
    assert(res.versionstamp > ZERO_VERSIONSTAMP)

    const newValue = await db.get(['t'])
    assert.deepEqual(newValue.versionstamp, res.versionstamp)
    assert.deepEqual(newValue.value, '1')

    res = await db
      .atomic()
      .check({ key: ['t'], versionstamp: null })
      .set(['t'], '2')
      .commit()
    assert(!res.ok)
  })

  await dbTest('atomic mutation helper (sum)', async (db) => {
    await db.set(['t'], new KvU64(42n))
    assert.deepEqual((await db.get(['t'])).value, new KvU64(42n))

    await db.atomic().sum(['t'], new KvU64(1n)).commit()
    assert.deepEqual((await db.get(['t'])).value, new KvU64(43n))
  })

  await dbTest('atomic mutation helper (min)', async (db) => {
    await db.set(['t'], new KvU64(42n))
    assert.deepEqual((await db.get(['t'])).value, new KvU64(42n))

    await db.atomic().min(['t'], new KvU64(1n)).commit()
    assert.deepEqual((await db.get(['t'])).value, new KvU64(1n))

    await db.atomic().min(['t'], new KvU64(2n)).commit()
    assert.deepEqual((await db.get(['t'])).value, new KvU64(1n))
  })

  await dbTest('atomic mutation helper (max)', async (db) => {
    await db.set(['t'], new KvU64(42n))
    assert.deepEqual((await db.get(['t'])).value, new KvU64(42n))

    await db.atomic().max(['t'], new KvU64(41n)).commit()
    assert.deepEqual((await db.get(['t'])).value, new KvU64(42n))

    await db.atomic().max(['t'], new KvU64(43n)).commit()
    assert.deepEqual((await db.get(['t'])).value, new KvU64(43n))
  })

  await dbTest('compare multiple and mutate', async (db) => {
    const setRes1 = await db.set(['t1'], '1')
    const setRes2 = await db.set(['t2'], '2')
    assert(setRes1.ok)
    assert(setRes1.versionstamp > ZERO_VERSIONSTAMP)
    assert(setRes2.ok)
    assert(setRes2.versionstamp > ZERO_VERSIONSTAMP)

    const currentValue1 = await db.get(['t1'])
    assert(currentValue1.versionstamp)
    assert(currentValue1.versionstamp === setRes1.versionstamp)
    const currentValue2 = await db.get(['t2'])
    assert(currentValue2.versionstamp)
    assert(currentValue2.versionstamp === setRes2.versionstamp)

    const res = await db
      .atomic()
      .check({ key: ['t1'], versionstamp: currentValue1.versionstamp })
      .check({ key: ['t2'], versionstamp: currentValue2.versionstamp })
      .set(currentValue1.key, '3')
      .set(currentValue2.key, '4')
      .commit()
    assert(res.ok)
    assert(res.versionstamp > setRes2.versionstamp)

    const newValue1 = await db.get(['t1'])
    assert(newValue1.versionstamp)
    assert(newValue1.versionstamp > setRes1.versionstamp)
    assert.deepEqual(newValue1.value, '3')
    const newValue2 = await db.get(['t2'])
    assert(newValue2.versionstamp)
    assert(newValue2.versionstamp > setRes2.versionstamp)
    assert.deepEqual(newValue2.value, '4')

    // just one of the two checks failed
    const res2 = await db
      .atomic()
      .check({ key: ['t1'], versionstamp: newValue1.versionstamp })
      .check({ key: ['t2'], versionstamp: null })
      .set(newValue1.key, '5')
      .set(newValue2.key, '6')
      .commit()
    assert(!res2.ok)

    const newValue3 = await db.get(['t1'])
    assert.deepEqual(newValue3.versionstamp, res.versionstamp)
    assert.deepEqual(newValue3.value, '3')
    const newValue4 = await db.get(['t2'])
    assert.deepEqual(newValue4.versionstamp, res.versionstamp)
    assert.deepEqual(newValue4.value, '4')
  })

  await dbTest('atomic mutation ordering (set before delete)', async (db) => {
    await db.set(['a'], '1')
    const res = await db.atomic().set(['a'], '2').delete(['a']).commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, null)
  })

  await dbTest('atomic mutation ordering (delete before set)', async (db) => {
    await db.set(['a'], '1')
    const res = await db.atomic().delete(['a']).set(['a'], '2').commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, '2')
  })

  await dbTest('atomic mutation type=set', async (db) => {
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: '1', type: 'set' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, '1')
  })

  await dbTest('atomic mutation type=set overwrite', async (db) => {
    await db.set(['a'], '1')
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: '2', type: 'set' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, '2')
  })

  await dbTest('atomic mutation type=delete', async (db) => {
    await db.set(['a'], '1')
    const res = await db
      .atomic()
      .mutate({ key: ['a'], type: 'delete' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, null)
  })

  await dbTest('atomic mutation type=delete no exists', async (db) => {
    const res = await db
      .atomic()
      .mutate({ key: ['a'], type: 'delete' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, null)
  })

  await dbTest('atomic mutation type=sum', async (db) => {
    await db.set(['a'], new KvU64(10n))
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(1n), type: 'sum' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, new KvU64(11n))
  })

  await dbTest('atomic mutation type=sum no exists', async (db) => {
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(1n), type: 'sum' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert(result.value)
    assert.deepEqual(result.value, new KvU64(1n))
  })

  await dbTest('atomic mutation type=sum wrap around', async (db) => {
    await db.set(['a'], new KvU64(0xffffffffffffffffn))
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(10n), type: 'sum' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, new KvU64(9n))

    const res2 = await db
      .atomic()
      .mutate({
        key: ['a'],
        value: new KvU64(0xffffffffffffffffn),
        type: 'sum',
      })
      .commit()
    assert(res2)
    const result2 = await db.get(['a'])
    assert.deepEqual(result2.value, new KvU64(8n))
  })

  await dbTest('atomic mutation type=sum wrong type in db', async (db) => {
    await db.set(['a'], 1)
    await assert.rejects(
      async () => {
        await db
          .atomic()
          .mutate({ key: ['a'], value: new KvU64(1n), type: 'sum' })
          .commit()
      },
      {
        name: 'TypeError',
        message:
          "Failed to perform 'sum' mutation on a non-U64 value in the database",
      },
    )
  })

  await dbTest(
    'atomic mutation type=sum wrong type in mutation',
    async (db) => {
      await db.set(['a'], new KvU64(1n))
      await assert.rejects(
        async () => {
          await db
            .atomic()
            // @ts-expect-error wrong type is intentional
            .mutate({ key: ['a'], value: 1, type: 'sum' })
            .commit()
        },
        {
          name: 'TypeError',
          message: 'Cannot sum KvU64 with Number',
        },
      )
    },
  )

  await dbTest('atomic mutation type=min', async (db) => {
    await db.set(['a'], new KvU64(10n))
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(5n), type: 'min' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, new KvU64(5n))

    const res2 = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(15n), type: 'min' })
      .commit()
    assert(res2)
    const result2 = await db.get(['a'])
    assert.deepEqual(result2.value, new KvU64(5n))
  })

  await dbTest('atomic mutation type=min no exists', async (db) => {
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(1n), type: 'min' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert(result.value)
    assert.deepEqual(result.value, new KvU64(1n))
  })

  await dbTest('atomic mutation type=min wrong type in db', async (db) => {
    await db.set(['a'], 1)
    await assert.rejects(
      async () => {
        await db
          .atomic()
          .mutate({ key: ['a'], value: new KvU64(1n), type: 'min' })
          .commit()
      },
      {
        name: 'TypeError',
        message:
          "Failed to perform 'min' mutation on a non-U64 value in the database",
      },
    )
  })

  await dbTest(
    'atomic mutation type=min wrong type in mutation',
    async (db) => {
      await db.set(['a'], new KvU64(1n))
      await assert.rejects(
        async () => {
          await db
            .atomic()
            // @ts-expect-error wrong type is intentional
            .mutate({ key: ['a'], value: 1, type: 'min' })
            .commit()
        },
        {
          name: 'TypeError',
          message: "Failed to perform 'min' mutation on a non-U64 operand",
        },
      )
    },
  )

  await dbTest('atomic mutation type=max', async (db) => {
    await db.set(['a'], new KvU64(10n))
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(5n), type: 'max' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert.deepEqual(result.value, new KvU64(10n))

    const res2 = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(15n), type: 'max' })
      .commit()
    assert(res2)
    const result2 = await db.get(['a'])
    assert.deepEqual(result2.value, new KvU64(15n))
  })

  await dbTest('atomic mutation type=max no exists', async (db) => {
    const res = await db
      .atomic()
      .mutate({ key: ['a'], value: new KvU64(1n), type: 'max' })
      .commit()
    assert(res.ok)
    const result = await db.get(['a'])
    assert(result.value)
    assert.deepEqual(result.value, new KvU64(1n))
  })

  await dbTest('atomic mutation type=max wrong type in db', async (db) => {
    await db.set(['a'], 1)
    await assert.rejects(
      async () => {
        await db
          .atomic()
          .mutate({ key: ['a'], value: new KvU64(1n), type: 'max' })
          .commit()
      },
      {
        name: 'TypeError',
        message:
          "Failed to perform 'max' mutation on a non-U64 value in the database",
      },
    )
  })

  await dbTest(
    'atomic mutation type=max wrong type in mutation',
    async (db) => {
      await db.set(['a'], new KvU64(1n))
      await assert.rejects(
        async () => {
          await db
            .atomic()
            // @ts-expect-error wrong type is intentional
            .mutate({ key: ['a'], value: 1, type: 'max' })
            .commit()
        },
        {
          name: 'TypeError',
          message: "Failed to perform 'max' mutation on a non-U64 operand",
        },
      )
    },
  )

  test('KvU64 comparison', () => {
    const a = new KvU64(1n)
    const b = new KvU64(1n)
    assert.deepEqual(a, b)
    assert.throws(() => {
      assert.deepEqual(a, new KvU64(2n))
    }, AssertionError)
  })

  test('KvU64 overflow', () => {
    assert.throws(() => {
      new KvU64(2n ** 64n)
    }, RangeError)
  })

  test('KvU64 underflow', () => {
    assert.throws(() => {
      new KvU64(-1n)
    }, RangeError)
  })

  test('KvU64 unbox', () => {
    const a = new KvU64(1n)
    assert.strictEqual(a.value, 1n)
  })

  test('KvU64 unbox with valueOf', () => {
    const a = new KvU64(1n)
    assert.strictEqual(a.valueOf(), 1n)
  })

  test('KvU64 auto-unbox', () => {
    const a = new KvU64(1n)
    assert.strictEqual((a as unknown as bigint) + 1n, 2n)
  })

  test('KvU64 toString', () => {
    const a = new KvU64(1n)
    assert.strictEqual(a.toString(), '1')
  })

  test('KvU64 inspect', () => {
    const a = new KvU64(1n)
    assert.strictEqual(inspect(a), '[KvU64: 1n]')
  })

  async function setupData(db: Valkeyrie): Promise<string> {
    const res = await db
      .atomic()
      .set(['a'], -1)
      .set(['a', 'a'], 0)
      .set(['a', 'b'], 1)
      .set(['a', 'c'], 2)
      .set(['a', 'd'], 3)
      .set(['a', 'e'], 4)
      .set(['b'], 99)
      .set(['b', 'a'], 100)
      .commit()
    assert(res.ok)
    return res.versionstamp
  }

  await dbTest('get many', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await db.getMany([['b', 'a'], ['a'], ['c']])
    assert.deepEqual(entries, [
      { key: ['b', 'a'], value: 100, versionstamp },
      { key: ['a'], value: -1, versionstamp },
      { key: ['c'], value: null, versionstamp: null },
    ])
  })

  await dbTest('list prefix', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(db.list({ prefix: ['a'] }))
    assert.deepEqual(entries, [
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'e'], value: 4, versionstamp },
    ])
  })

  await dbTest('list prefix empty', async (db) => {
    await setupData(db)
    const entries = await Array.fromAsync(db.list({ prefix: ['c'] }))
    assert.deepEqual(entries.length, 0)

    const entries2 = await Array.fromAsync(db.list({ prefix: ['a', 'f'] }))
    assert.deepEqual(entries2.length, 0)
  })

  await dbTest('list prefix with start', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'], start: ['a', 'c'] }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'e'], value: 4, versionstamp },
    ])
  })

  await dbTest('list prefix with start empty', async (db) => {
    await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'], start: ['a', 'f'] }),
    )
    assert.deepEqual(entries.length, 0)
  })

  await dbTest('list prefix with start equal to prefix', async (db) => {
    await setupData(db)
    await assert.rejects(
      async () =>
        await Array.fromAsync(db.list({ prefix: ['a'], start: ['a'] })),
      {
        name: 'TypeError',
        message: 'Start key is not in the keyspace defined by prefix',
      },
    )
  })

  await dbTest('list prefix with start out of bounds', async (db) => {
    await setupData(db)
    await assert.rejects(
      async () =>
        await Array.fromAsync(db.list({ prefix: ['b'], start: ['a'] })),
      {
        name: 'TypeError',
        message: 'Start key is not in the keyspace defined by prefix',
      },
    )
  })

  await dbTest('list prefix with end', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'], end: ['a', 'c'] }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
    ])
  })

  await dbTest('list prefix with end empty', async (db) => {
    await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'], end: ['a', 'a'] }),
    )
    assert.deepEqual(entries.length, 0)
  })

  await dbTest('list prefix with end equal to prefix', async (db) => {
    await setupData(db)
    await assert.rejects(
      async () => await Array.fromAsync(db.list({ prefix: ['a'], end: ['a'] })),
      {
        name: 'TypeError',
        message: 'End key is not in the keyspace defined by prefix',
      },
    )
  })

  await dbTest('list prefix with end out of bounds', async (db) => {
    await setupData(db)
    await assert.rejects(
      async () => await Array.fromAsync(db.list({ prefix: ['a'], end: ['b'] })),
      {
        name: 'TypeError',
        message: 'End key is not in the keyspace defined by prefix',
      },
    )
  })

  await dbTest('list prefix with empty prefix', async (db) => {
    const res = await db.set(['a'], 1)
    const entries = await Array.fromAsync(db.list({ prefix: [] }))
    assert.deepEqual(entries, [
      { key: ['a'], value: 1, versionstamp: res.versionstamp },
    ])
  })

  await dbTest('list prefix reverse', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'] }, { reverse: true }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'e'], value: 4, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'a'], value: 0, versionstamp },
    ])
  })

  await dbTest('list prefix reverse with start', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'], start: ['a', 'c'] }, { reverse: true }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'e'], value: 4, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
    ])
  })

  await dbTest('list prefix reverse with start empty', async (db) => {
    await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'], start: ['a', 'f'] }, { reverse: true }),
    )
    assert.deepEqual(entries.length, 0)
  })

  await dbTest('list prefix reverse with end', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'], end: ['a', 'c'] }, { reverse: true }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'a'], value: 0, versionstamp },
    ])
  })

  await dbTest('list prefix reverse with end empty', async (db) => {
    await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'], end: ['a', 'a'] }, { reverse: true }),
    )
    assert.deepEqual(entries.length, 0)
  })

  await dbTest('list prefix limit', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'] }, { limit: 2 }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
    ])
  })

  await dbTest('list prefix limit reverse', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'] }, { limit: 2, reverse: true }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'e'], value: 4, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
    ])
  })

  await dbTest('list prefix with small batch size', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'] }, { batchSize: 2 }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'e'], value: 4, versionstamp },
    ])
  })

  await dbTest('list prefix with small batch size reverse', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'] }, { batchSize: 2, reverse: true }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'e'], value: 4, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'a'], value: 0, versionstamp },
    ])
  })

  await dbTest('list prefix with small batch size and limit', async (db) => {
    const versionstamp = await setupData(db)
    const entries = await Array.fromAsync(
      db.list({ prefix: ['a'] }, { batchSize: 2, limit: 3 }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
    ])
  })

  await dbTest(
    'list prefix with small batch size and limit reverse',
    async (db) => {
      const versionstamp = await setupData(db)
      const entries = await Array.fromAsync(
        db.list({ prefix: ['a'] }, { batchSize: 2, limit: 3, reverse: true }),
      )
      assert.deepEqual(entries, [
        { key: ['a', 'e'], value: 4, versionstamp },
        { key: ['a', 'd'], value: 3, versionstamp },
        { key: ['a', 'c'], value: 2, versionstamp },
      ])
    },
  )

  await dbTest('list prefix with manual cursor', async (db) => {
    const versionstamp = await setupData(db)
    const iterator = db.list({ prefix: ['a'] }, { limit: 2 })
    const values = await Array.fromAsync(iterator)
    assert.deepEqual(values, [
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
    ])

    const cursor = iterator.cursor
    assert.strictEqual(cursor, 'AmIA')

    const iterator2 = db.list({ prefix: ['a'] }, { cursor })
    const values2 = await Array.fromAsync(iterator2)
    assert.deepEqual(values2, [
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'e'], value: 4, versionstamp },
    ])
  })

  await dbTest('list prefix with manual cursor reverse', async (db) => {
    const versionstamp = await setupData(db)

    const iterator = db.list({ prefix: ['a'] }, { limit: 2, reverse: true })
    const values = await Array.fromAsync(iterator)
    assert.deepEqual(values, [
      { key: ['a', 'e'], value: 4, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
    ])

    const cursor = iterator.cursor
    assert.strictEqual(cursor, 'AmQA')

    const iterator2 = db.list({ prefix: ['a'] }, { cursor, reverse: true })
    const values2 = await Array.fromAsync(iterator2)
    assert.deepEqual(values2, [
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'a'], value: 0, versionstamp },
    ])
  })

  await dbTest('list range', async (db) => {
    const versionstamp = await setupData(db)

    const entries = await Array.fromAsync(
      db.list({ start: ['a', 'a'], end: ['a', 'z'] }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'e'], value: 4, versionstamp },
    ])
  })

  await dbTest('list range reverse', async (db) => {
    const versionstamp = await setupData(db)

    const entries = await Array.fromAsync(
      db.list({ start: ['a', 'a'], end: ['a', 'z'] }, { reverse: true }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'e'], value: 4, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'a'], value: 0, versionstamp },
    ])
  })

  await dbTest('list range with limit', async (db) => {
    const versionstamp = await setupData(db)

    const entries = await Array.fromAsync(
      db.list({ start: ['a', 'a'], end: ['a', 'z'] }, { limit: 3 }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
    ])
  })

  await dbTest('list range with limit reverse', async (db) => {
    const versionstamp = await setupData(db)

    const entries = await Array.fromAsync(
      db.list(
        { start: ['a', 'a'], end: ['a', 'z'] },
        {
          limit: 3,
          reverse: true,
        },
      ),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'e'], value: 4, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
    ])
  })

  await dbTest('list range nesting', async (db) => {
    const versionstamp = await setupData(db)

    const entries = await Array.fromAsync(
      db.list({ start: ['a'], end: ['a', 'd'] }),
    )
    assert.deepEqual(entries, [
      { key: ['a'], value: -1, versionstamp },
      { key: ['a', 'a'], value: 0, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
    ])
  })

  await dbTest('list range short', async (db) => {
    const versionstamp = await setupData(db)

    const entries = await Array.fromAsync(
      db.list({ start: ['a', 'b'], end: ['a', 'd'] }),
    )
    assert.deepEqual(entries, [
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
    ])
  })

  await dbTest('list range with manual cursor', async (db) => {
    const versionstamp = await setupData(db)

    const iterator = db.list(
      { start: ['a', 'b'], end: ['a', 'z'] },
      {
        limit: 2,
      },
    )
    const entries = await Array.fromAsync(iterator)
    assert.deepEqual(entries, [
      { key: ['a', 'b'], value: 1, versionstamp },
      { key: ['a', 'c'], value: 2, versionstamp },
    ])

    const cursor = iterator.cursor
    const iterator2 = db.list(
      { start: ['a', 'b'], end: ['a', 'z'] },
      {
        cursor,
      },
    )
    const entries2 = await Array.fromAsync(iterator2)
    assert.deepEqual(entries2, [
      { key: ['a', 'd'], value: 3, versionstamp },
      { key: ['a', 'e'], value: 4, versionstamp },
    ])
  })

  await dbTest('list range with manual cursor reverse', async (db) => {
    const versionstamp = await setupData(db)

    const iterator = db.list(
      { start: ['a', 'b'], end: ['a', 'z'] },
      {
        limit: 2,
        reverse: true,
      },
    )
    const entries = await Array.fromAsync(iterator)
    assert.deepEqual(entries, [
      { key: ['a', 'e'], value: 4, versionstamp },
      { key: ['a', 'd'], value: 3, versionstamp },
    ])

    const cursor = iterator.cursor
    const iterator2 = db.list(
      { start: ['a', 'b'], end: ['a', 'z'] },
      {
        cursor,
        reverse: true,
      },
    )
    const entries2 = await Array.fromAsync(iterator2)
    assert.deepEqual(entries2, [
      { key: ['a', 'c'], value: 2, versionstamp },
      { key: ['a', 'b'], value: 1, versionstamp },
    ])
  })

  await dbTest('list range with start greater than end', async (db) => {
    await setupData(db)
    await assert.rejects(
      async () => await Array.fromAsync(db.list({ start: ['b'], end: ['a'] })),
      {
        name: 'TypeError',
        message: 'Start key is greater than end key',
      },
    )
  })

  await dbTest('list range with start equal to end', async (db) => {
    await setupData(db)
    const entries = await Array.fromAsync(db.list({ start: ['a'], end: ['a'] }))
    assert.deepEqual(entries.length, 0)
  })

  await dbTest('list invalid selector', async (db) => {
    await setupData(db)

    await assert.rejects(
      async () =>
        await Array.fromAsync(
          db.list({ prefix: ['a'], start: ['a', 'b'], end: ['a', 'c'] }),
        ),
      TypeError,
    )

    await assert.rejects(
      // @ts-expect-error invalid type
      async () => await Array.fromAsync(db.list({ start: ['a', 'b'] })),
      TypeError,
    )

    await assert.rejects(
      // @ts-expect-error invalid type
      async () => await Array.fromAsync(db.list({ end: ['a', 'b'] })),
      TypeError,
    )
  })

  await dbTest('invalid versionstamp in atomic check rejects', async (db) => {
    await assert.rejects(
      async () =>
        await db
          .atomic()
          .check({ key: ['a'], versionstamp: '' })
          .commit(),
      TypeError,
    )

    await assert.rejects(
      async () =>
        await db
          .atomic()
          .check({ key: ['a'], versionstamp: 'xx'.repeat(10) })
          .commit(),
      TypeError,
    )

    await assert.rejects(
      async () =>
        await db
          .atomic()
          .check({ key: ['a'], versionstamp: 'aa'.repeat(11) })
          .commit(),
      TypeError,
    )
  })

  await dbTest('invalid mutation type rejects', async (db) => {
    await assert.rejects(async () => {
      await db
        .atomic()
        // @ts-expect-error invalid type + value combo
        .mutate({ key: ['a'], type: 'set' })
        .commit()
    }, TypeError)

    await assert.rejects(async () => {
      await db
        .atomic()
        // @ts-expect-error invalid type + value combo
        .mutate({ key: ['a'], type: 'delete', value: '123' })
        .commit()
    }, TypeError)

    await assert.rejects(async () => {
      await db
        .atomic()
        // @ts-expect-error invalid type
        .mutate({ key: ['a'], type: 'foobar' })
        .commit()
    }, TypeError)

    await assert.rejects(async () => {
      await db
        .atomic()
        // @ts-expect-error invalid type
        .mutate({ key: ['a'], type: 'foobar', value: '123' })
        .commit()
    }, TypeError)
  })

  await dbTest('key ordering', async (db) => {
    await db
      .atomic()
      .set([new Uint8Array(0x1)], 0)
      .set(['a'], 0)
      .set([1n], 0)
      .set([3.14], 0)
      .set([false], 0)
      .set([true], 0)
      .commit()

    assert.deepEqual(
      (await Array.fromAsync(db.list({ prefix: [] }))).map((x) => x.key),
      [[new Uint8Array(0x1)], ['a'], [1n], [3.14], [false], [true]],
    )
  })

  await dbTest('key size limit', async (db) => {
    // 1 byte prefix + 1 byte suffix + 2045 bytes key
    const lastValidKey = new Uint8Array(2046).fill(1)
    const firstInvalidKey = new Uint8Array(2047).fill(1)

    const res = await db.set([lastValidKey], 1)

    assert.deepEqual(await db.get([lastValidKey]), {
      key: [lastValidKey],
      value: 1,
      versionstamp: res.versionstamp,
    })

    await assert.rejects(async () => await db.set([firstInvalidKey], 1), {
      name: 'TypeError',
      message: 'Key too large for write (max 2048 bytes)',
    })

    await assert.rejects(async () => await db.get([firstInvalidKey]), {
      name: 'TypeError',
      message: 'Key too large for read (max 2049 bytes)',
    })
  })

  await dbTest('value size limit', async (db) => {
    const lastValidValue = new Uint8Array(65536)
    const firstInvalidValue = new Uint8Array(65537)

    const res = await db.set(['a'], lastValidValue)
    assert.deepEqual(await db.get(['a']), {
      key: ['a'],
      value: lastValidValue,
      versionstamp: res.versionstamp,
    })

    await assert.rejects(async () => await db.set(['b'], firstInvalidValue), {
      name: 'TypeError',
      message: 'Value too large (max 65536 bytes)',
    })
  })

  await dbTest('operation size limit', async (db) => {
    const lastValidKeys: Key[] = new Array(10).fill(0).map((_, i) => ['a', i])
    const firstInvalidKeys: Key[] = new Array(11)
      .fill(0)
      .map((_, i) => ['a', i])
    const invalidCheckKeys: Key[] = new Array(101)
      .fill(0)
      .map((_, i) => ['a', i])

    const res = await db.getMany(lastValidKeys)
    assert.deepEqual(res.length, 10)

    await assert.rejects(async () => await db.getMany(firstInvalidKeys), {
      name: 'TypeError',
      message: 'Too many ranges (max 10)',
    })

    const res2 = await Array.fromAsync(
      db.list({ prefix: ['a'] }, { batchSize: 1000 }),
    )
    assert.deepEqual(res2.length, 0)

    await assert.rejects(
      async () =>
        await Array.fromAsync(db.list({ prefix: ['a'] }, { batchSize: 1001 })),
      {
        name: 'TypeError',
        message: 'Too many entries (max 1000)',
      },
    )

    // when batchSize is not specified, limit is used but is clamped to 500
    assert.deepEqual(
      (await Array.fromAsync(db.list({ prefix: ['a'] }, { limit: 1001 })))
        .length,
      0,
    )

    const res3 = await db
      .atomic()
      .check(
        ...lastValidKeys.map((key) => ({
          key,
          versionstamp: null,
        })),
      )
      .mutate(
        ...lastValidKeys.map(
          (key) =>
            ({
              key,
              type: 'set',
              value: 1,
            }) satisfies Mutation,
        ),
      )
      .commit()
    assert(res3)

    await assert.rejects(
      async () => {
        await db
          .atomic()
          .check(
            ...invalidCheckKeys.map((key) => ({
              key,
              versionstamp: null,
            })),
          )
          .mutate(
            ...lastValidKeys.map(
              (key) =>
                ({
                  key,
                  type: 'set',
                  value: 1,
                }) satisfies Mutation,
            ),
          )
          .commit()
      },
      {
        name: 'TypeError',
        message: 'Too many checks (max 100)',
      },
    )

    const validMutateKeys: Key[] = new Array(1000)
      .fill(0)
      .map((_, i) => ['a', i])
    const invalidMutateKeys: Key[] = new Array(1001)
      .fill(0)
      .map((_, i) => ['a', i])

    const res4 = await db
      .atomic()
      .check(
        ...lastValidKeys.map((key) => ({
          key,
          versionstamp: null,
        })),
      )
      .mutate(
        ...validMutateKeys.map(
          (key) =>
            ({
              key,
              type: 'set',
              value: 1,
            }) satisfies Mutation,
        ),
      )
      .commit()
    assert(res4)

    await assert.rejects(
      async () => {
        await db
          .atomic()
          .check(
            ...lastValidKeys.map((key) => ({
              key,
              versionstamp: null,
            })),
          )
          .mutate(
            ...invalidMutateKeys.map(
              (key) =>
                ({
                  key,
                  type: 'set',
                  value: 1,
                }) satisfies Mutation,
            ),
          )
          .commit()
      },
      {
        name: 'TypeError',
        message: 'Too many mutations (max 1000)',
      },
    )
  })

  await dbTest('total mutation size limit', async (db) => {
    const keys: Key[] = new Array(1000).fill(0).map((_, i) => ['a', i])

    const atomic = db.atomic()
    for (const key of keys) {
      atomic.set(key, 'foo')
    }
    const res = await atomic.commit()
    assert(res)

    // Use bigger values to trigger "total mutation size too large" error
    await assert.rejects(
      async () => {
        const value = new Array(3000).fill('a').join('')
        const atomic = db.atomic()
        for (const key of keys) {
          atomic.set(key, value)
        }
        await atomic.commit()
      },
      {
        name: 'TypeError',
        message: 'Total mutation size too large (max 819200 bytes)',
      },
    )
  })

  await dbTest('total key size limit', async (db) => {
    const longString = new Array(1100).fill('a').join('')
    const keys: Key[] = new Array(80).fill(0).map(() => [longString])

    const atomic = db.atomic()
    for (const key of keys) {
      atomic.set(key, 'foo')
    }
    await assert.rejects(() => atomic.commit(), {
      name: 'TypeError',
      message: 'Total key size too large (max 81920 bytes)',
    })
  })

  await dbTest('keys must be arrays', async (db) => {
    await assert.rejects(
      // @ts-expect-error invalid type
      async () => await db.get('a'),
      TypeError,
    )

    await assert.rejects(
      // @ts-expect-error invalid type
      async () => await db.getMany(['a']),
      TypeError,
    )

    await assert.rejects(
      // @ts-expect-error invalid type
      async () => await db.set('a', 1),
      TypeError,
    )

    await assert.rejects(
      // @ts-expect-error invalid type
      async () => await db.delete('a'),
      TypeError,
    )

    await assert.rejects(
      async () =>
        await db
          .atomic()
          // @ts-expect-error invalid type
          .mutate({ key: 'a', type: 'set', value: 1 } satisfies Mutation)
          .commit(),
      TypeError,
    )

    await assert.rejects(
      async () =>
        await db
          .atomic()
          // @ts-expect-error invalid type
          .check({ key: 'a', versionstamp: null })
          .set(['a'], 1)
          .commit(),
      TypeError,
    )
  })

  await test('Valkeyrie constructor throws', async () => {
    assert.throws(
      () => {
        // @ts-expect-error invalid type
        new Valkeyrie()
      },
      TypeError,
      'Valkeyrie constructor throws',
    )
  })

  // This function is never called, it is just used to check that all the types
  // are behaving as expected.
  // async function _typeCheckingTests() {
  //   const kv = new Deno.Kv()

  //   const a = await kv.get(['a'])
  //   assertType<IsExact<typeof a, Deno.KvEntryMaybe<unknown>>>(true)

  //   const b = await kv.get<string>(['b'])
  //   assertType<IsExact<typeof b, Deno.KvEntryMaybe<string>>>(true)

  //   const c = await kv.getMany([['a'], ['b']])
  //   assertType<
  //     IsExact<
  //       typeof c,
  //       [Deno.KvEntryMaybe<unknown>, Deno.KvEntryMaybe<unknown>]
  //     >
  //   >(true)

  //   const d = await kv.getMany([['a'], ['b']] as const)
  //   assertType<
  //     IsExact<
  //       typeof d,
  //       [Deno.KvEntryMaybe<unknown>, Deno.KvEntryMaybe<unknown>]
  //     >
  //   >(true)

  //   const e = await kv.getMany<[string, number]>([['a'], ['b']])
  //   assertType<
  //     IsExact<typeof e, [Deno.KvEntryMaybe<string>, Deno.KvEntryMaybe<number>]>
  //   >(true)

  //   const keys: Deno.KvKey[] = [['a'], ['b']]
  //   const f = await kv.getMany(keys)
  //   assertType<IsExact<typeof f, Deno.KvEntryMaybe<unknown>[]>>(true)

  //   const g = kv.list({ prefix: ['a'] })
  //   assertType<IsExact<typeof g, Deno.KvListIterator<unknown>>>(true)
  //   const h = await g.next()
  //   assert(!h.done)
  //   assertType<IsExact<typeof h.value, Deno.KvEntry<unknown>>>(true)

  //   const i = kv.list<string>({ prefix: ['a'] })
  //   assertType<IsExact<typeof i, Deno.KvListIterator<string>>>(true)
  //   const j = await i.next()
  //   assert(!j.done)
  //   assertType<IsExact<typeof j.value, Deno.KvEntry<string>>>(true)
  // }

  // queueTest('basic listenQueue and enqueue', async (db) => {
  //   const { promise, resolve } = Promise.withResolvers<void>()
  //   let dequeuedMessage: unknown = null
  //   const listener = db.listenQueue((msg) => {
  //     dequeuedMessage = msg
  //     resolve()
  //   })
  //   try {
  //     const res = await db.enqueue('test')
  //     assert(res.ok)
  //     assertNotEquals(res.versionstamp, null)
  //     await promise
  //     assertEquals(dequeuedMessage, 'test')
  //   } finally {
  //     db.close()
  //     await listener
  //   }
  // })

  // for (const { name, value } of VALUE_CASES) {
  //   queueTest(`listenQueue and enqueue ${name}`, async (db) => {
  //     const numEnqueues = 10
  //     let count = 0
  //     const deferreds: ReturnType<typeof Promise.withResolvers<unknown>>[] = []
  //     const listeners: Promise<void>[] = []
  //     listeners.push(
  //       db.listenQueue((msg: unknown) => {
  //         deferreds[count++].resolve(msg)
  //       }),
  //     )
  //     try {
  //       for (let i = 0; i < numEnqueues; i++) {
  //         deferreds.push(Promise.withResolvers<unknown>())
  //         await db.enqueue(value)
  //       }
  //       const dequeuedMessages = await Promise.all(
  //         deferreds.map(({ promise }) => promise),
  //       )
  //       for (let i = 0; i < numEnqueues; i++) {
  //         assertEquals(dequeuedMessages[i], value)
  //       }
  //     } finally {
  //       db.close()
  //       for (const listener of listeners) {
  //         await listener
  //       }
  //     }
  //   })
  // }

  // queueTest('queue mixed types', async (db) => {
  //   let deferred: ReturnType<typeof Promise.withResolvers<void>>
  //   let dequeuedMessage: unknown = null
  //   const listener = db.listenQueue((msg: unknown) => {
  //     dequeuedMessage = msg
  //     deferred.resolve()
  //   })
  //   try {
  //     for (const item of VALUE_CASES) {
  //       deferred = Promise.withResolvers<void>()
  //       await db.enqueue(item.value)
  //       await deferred.promise
  //       assertEquals(dequeuedMessage, item.value)
  //     }
  //   } finally {
  //     db.close()
  //     await listener
  //   }
  // })

  // queueTest('queue delay', async (db) => {
  //   let dequeueTime: number | undefined
  //   const { promise, resolve } = Promise.withResolvers<void>()
  //   let dequeuedMessage: unknown = null
  //   const listener = db.listenQueue((msg) => {
  //     dequeueTime = Date.now()
  //     dequeuedMessage = msg
  //     resolve()
  //   })
  //   try {
  //     const enqueueTime = Date.now()
  //     await db.enqueue('test', { delay: 1000 })
  //     await promise
  //     assertEquals(dequeuedMessage, 'test')
  //     assert(dequeueTime !== undefined)
  //     assert(dequeueTime - enqueueTime >= 1000)
  //   } finally {
  //     db.close()
  //     await listener
  //   }
  // })

  // queueTest('queue delay with atomic', async (db) => {
  //   let dequeueTime: number | undefined
  //   const { promise, resolve } = Promise.withResolvers<void>()
  //   let dequeuedMessage: unknown = null
  //   const listener = db.listenQueue((msg) => {
  //     dequeueTime = Date.now()
  //     dequeuedMessage = msg
  //     resolve()
  //   })
  //   try {
  //     const enqueueTime = Date.now()
  //     const res = await db.atomic().enqueue('test', { delay: 1000 }).commit()
  //     assert(res.ok)

  //     await promise
  //     assertEquals(dequeuedMessage, 'test')
  //     assert(dequeueTime !== undefined)
  //     assert(dequeueTime - enqueueTime >= 1000)
  //   } finally {
  //     db.close()
  //     await listener
  //   }
  // })

  // queueTest('queue delay and now', async (db) => {
  //   let count = 0
  //   let dequeueTime: number | undefined
  //   const { promise, resolve } = Promise.withResolvers<void>()
  //   let dequeuedMessage: unknown = null
  //   const listener = db.listenQueue((msg) => {
  //     count += 1
  //     if (count == 2) {
  //       dequeueTime = Date.now()
  //       dequeuedMessage = msg
  //       resolve()
  //     }
  //   })
  //   try {
  //     const enqueueTime = Date.now()
  //     await db.enqueue('test-1000', { delay: 1000 })
  //     await db.enqueue('test')
  //     await promise
  //     assertEquals(dequeuedMessage, 'test-1000')
  //     assert(dequeueTime !== undefined)
  //     assert(dequeueTime - enqueueTime >= 1000)
  //   } finally {
  //     db.close()
  //     await listener
  //   }
  // })

  // dbTest('queue negative delay', async (db) => {
  //   await assertRejects(async () => {
  //     await db.enqueue('test', { delay: -100 })
  //   }, TypeError)
  // })

  // dbTest('queue nan delay', async (db) => {
  //   await assertRejects(async () => {
  //     await db.enqueue('test', { delay: Number.NaN })
  //   }, TypeError)
  // })

  // dbTest('queue large delay', async (db) => {
  //   await db.enqueue('test', { delay: 30 * 24 * 60 * 60 * 1000 })
  //   await assertRejects(async () => {
  //     await db.enqueue('test', { delay: 30 * 24 * 60 * 60 * 1000 + 1 })
  //   }, TypeError)
  // })

  // queueTest('listenQueue with async callback', async (db) => {
  //   const { promise, resolve } = Promise.withResolvers<void>()
  //   let dequeuedMessage: unknown = null
  //   const listener = db.listenQueue(async (msg) => {
  //     dequeuedMessage = msg
  //     await sleep(100)
  //     resolve()
  //   })
  //   try {
  //     await db.enqueue('test')
  //     await promise
  //     assertEquals(dequeuedMessage, 'test')
  //   } finally {
  //     db.close()
  //     await listener
  //   }
  // })

  // queueTest('queue retries', async (db) => {
  //   let count = 0
  //   const listener = db.listenQueue(async (_msg) => {
  //     count += 1
  //     await sleep(10)
  //     throw new TypeError('dequeue error')
  //   })
  //   try {
  //     await db.enqueue('test')
  //     await sleep(10000)
  //   } finally {
  //     db.close()
  //     await listener
  //   }

  //   // There should have been 1 attempt + 3 retries in the 10 seconds
  //   assertEquals(4, count)
  // })

  // queueTest('queue retries with backoffSchedule', async (db) => {
  //   let count = 0
  //   const listener = db.listenQueue((_msg) => {
  //     count += 1
  //     throw new TypeError('Dequeue error')
  //   })
  //   try {
  //     await db.enqueue('test', { backoffSchedule: [1] })
  //     await sleep(2000)
  //   } finally {
  //     db.close()
  //     await listener
  //   }

  //   // There should have been 1 attempt + 1 retry
  //   assertEquals(2, count)
  // })

  // queueTest('multiple listenQueues', async (db) => {
  //   const numListens = 10
  //   let count = 0
  //   const deferreds: ReturnType<typeof Promise.withResolvers<void>>[] = []
  //   const dequeuedMessages: unknown[] = []
  //   const listeners: Promise<void>[] = []
  //   for (let i = 0; i < numListens; i++) {
  //     listeners.push(
  //       db.listenQueue((msg) => {
  //         dequeuedMessages.push(msg)
  //         deferreds[count++].resolve()
  //       }),
  //     )
  //   }
  //   try {
  //     for (let i = 0; i < numListens; i++) {
  //       deferreds.push(Promise.withResolvers<void>())
  //       await db.enqueue('msg_' + i)
  //       await deferreds[i].promise
  //       const msg = dequeuedMessages[i]
  //       assertEquals('msg_' + i, msg)
  //     }
  //   } finally {
  //     db.close()
  //     for (let i = 0; i < numListens; i++) {
  //       await listeners[i]
  //     }
  //   }
  // })

  // queueTest('enqueue with atomic', async (db) => {
  //   const { promise, resolve } = Promise.withResolvers<void>()
  //   let dequeuedMessage: unknown = null
  //   const listener = db.listenQueue((msg) => {
  //     dequeuedMessage = msg
  //     resolve()
  //   })

  //   try {
  //     await db.set(['t'], '1')

  //     let currentValue = await db.get(['t'])
  //     assertEquals('1', currentValue.value)

  //     const res = await db
  //       .atomic()
  //       .check(currentValue)
  //       .set(currentValue.key, '2')
  //       .enqueue('test')
  //       .commit()
  //     assert(res.ok)

  //     await promise
  //     assertEquals('test', dequeuedMessage)

  //     currentValue = await db.get(['t'])
  //     assertEquals('2', currentValue.value)
  //   } finally {
  //     db.close()
  //     await listener
  //   }
  // })

  // queueTest('enqueue with atomic nonce', async (db) => {
  //   const { promise, resolve } = Promise.withResolvers<void>()
  //   let dequeuedMessage: unknown = null

  //   const nonce = crypto.randomUUID()

  //   const listener = db.listenQueue(async (val) => {
  //     const message = val as { msg: string; nonce: string }
  //     const nonce = message.nonce
  //     const nonceValue = await db.get(['nonces', nonce])
  //     if (nonceValue.versionstamp === null) {
  //       dequeuedMessage = message.msg
  //       resolve()
  //       return
  //     }

  //     assertNotEquals(nonceValue.versionstamp, null)
  //     const res = await db
  //       .atomic()
  //       .check(nonceValue)
  //       .delete(['nonces', nonce])
  //       .set(['a', 'b'], message.msg)
  //       .commit()
  //     if (res.ok) {
  //       // Simulate an error so that the message has to be redelivered
  //       throw new Error('injected error')
  //     }
  //   })

  //   try {
  //     const res = await db
  //       .atomic()
  //       .check({ key: ['nonces', nonce], versionstamp: null })
  //       .set(['nonces', nonce], true)
  //       .enqueue({ msg: 'test', nonce })
  //       .commit()
  //     assert(res.ok)

  //     await promise
  //     assertEquals('test', dequeuedMessage)

  //     const currentValue = await db.get(['a', 'b'])
  //     assertEquals('test', currentValue.value)

  //     const nonceValue = await db.get(['nonces', nonce])
  //     assertEquals(nonceValue.versionstamp, null)
  //   } finally {
  //     db.close()
  //     await listener
  //   }
  // })

  // Deno.test({
  //   name: 'queue persistence with inflight messages',
  //   sanitizeOps: false,
  //   sanitizeResources: false,
  //   async fn() {
  //     const filename = await Deno.makeTempFile({ prefix: 'queue_db' })
  //     try {
  //       let db: Deno.Kv = await Deno.openKv(filename)

  //       let count = 0
  //       let deferred = Promise.withResolvers<void>()

  //       // Register long-running handler.
  //       let listener = db.listenQueue(async (_msg) => {
  //         count += 1
  //         if (count == 3) {
  //           deferred.resolve()
  //         }
  //         await new Promise(() => {})
  //       })

  //       // Enqueue 3 messages.
  //       await db.enqueue('msg0')
  //       await db.enqueue('msg1')
  //       await db.enqueue('msg2')
  //       await deferred.promise

  //       // Close the database and wait for the listener to finish.
  //       db.close()
  //       await listener

  //       // Wait at least MESSAGE_DEADLINE_TIMEOUT before reopening the database.
  //       // This ensures that inflight messages are requeued immediately after
  //       // the database is reopened.
  //       // https://github.com/denoland/denokv/blob/efb98a1357d37291a225ed5cf1fc4ecc7c737fab/sqlite/backend.rs#L120
  //       await sleep(6000)

  //       // Now reopen the database.
  //       db = await Deno.openKv(filename)

  //       count = 0
  //       deferred = Promise.withResolvers<void>()

  //       // Register a handler that will complete quickly.
  //       listener = db.listenQueue((_msg) => {
  //         count += 1
  //         if (count == 3) {
  //           deferred.resolve()
  //         }
  //       })

  //       // Wait for the handlers to finish.
  //       await deferred.promise
  //       assertEquals(3, count)
  //       db.close()
  //       await listener
  //     } finally {
  //       try {
  //         await Deno.remove(filename)
  //       } catch {
  //         // pass
  //       }
  //     }
  //   },
  // })

  // Deno.test({
  //   name: 'queue persistence with delay messages',
  //   async fn() {
  //     const filename = await Deno.makeTempFile({ prefix: 'queue_db' })
  //     try {
  //       await Deno.remove(filename)
  //     } catch {
  //       // pass
  //     }
  //     try {
  //       let db: Deno.Kv = await Deno.openKv(filename)

  //       let count = 0
  //       let deferred = Promise.withResolvers<void>()

  //       // Register long-running handler.
  //       let listener = db.listenQueue((_msg) => {})

  //       // Enqueue 3 messages into the future.
  //       await db.enqueue('msg0', { delay: 10000 })
  //       await db.enqueue('msg1', { delay: 10000 })
  //       await db.enqueue('msg2', { delay: 10000 })

  //       // Close the database and wait for the listener to finish.
  //       db.close()
  //       await listener

  //       // Now reopen the database.
  //       db = await Deno.openKv(filename)

  //       count = 0
  //       deferred = Promise.withResolvers<void>()

  //       // Register a handler that will complete quickly.
  //       listener = db.listenQueue((_msg) => {
  //         count += 1
  //         if (count == 3) {
  //           deferred.resolve()
  //         }
  //       })

  //       // Wait for the handlers to finish.
  //       await deferred.promise
  //       assertEquals(3, count)
  //       db.close()
  //       await listener
  //     } finally {
  //       try {
  //         await Deno.remove(filename)
  //       } catch {
  //         // pass
  //       }
  //     }
  //   },
  // })

  // Deno.test({
  //   name: 'different kv instances for enqueue and queueListen',
  //   async fn() {
  //     const filename = await Deno.makeTempFile({ prefix: 'queue_db' })
  //     try {
  //       const db0 = await Deno.openKv(filename)
  //       const db1 = await Deno.openKv(filename)
  //       const { promise, resolve } = Promise.withResolvers<void>()
  //       let dequeuedMessage: unknown = null
  //       const listener = db0.listenQueue((msg) => {
  //         dequeuedMessage = msg
  //         resolve()
  //       })
  //       try {
  //         const res = await db1.enqueue('test')
  //         assert(res.ok)
  //         assertNotEquals(res.versionstamp, null)
  //         await promise
  //         assertEquals(dequeuedMessage, 'test')
  //       } finally {
  //         db0.close()
  //         await listener
  //         db1.close()
  //       }
  //     } finally {
  //       try {
  //         await Deno.remove(filename)
  //       } catch {
  //         // pass
  //       }
  //     }
  //   },
  // })

  // Deno.test({
  //   name: 'queue graceful close',
  //   async fn() {
  //     const db: Deno.Kv = await Deno.openKv(':memory:')
  //     const listener = db.listenQueue((_msg) => {})
  //     db.close()
  //     await listener
  //   },
  // })

  // dbTest('Invalid backoffSchedule', async (db) => {
  //   await assertRejects(
  //     async () => {
  //       await db.enqueue('foo', { backoffSchedule: [1, 1, 1, 1, 1, 1] })
  //     },
  //     TypeError,
  //     'Invalid backoffSchedule, max 5 intervals allowed',
  //   )
  //   await assertRejects(
  //     async () => {
  //       await db.enqueue('foo', { backoffSchedule: [3600001] })
  //     },
  //     TypeError,
  //     'Invalid backoffSchedule, interval at index 0 is invalid',
  //   )
  // })

  // dbTest('atomic operation is exposed', (db) => {
  //   assert(Deno.AtomicOperation)
  //   const ao = db.atomic()
  //   assert(ao instanceof Deno.AtomicOperation)
  // })

  // Deno.test({
  //   name: 'racy open',
  //   async fn() {
  //     for (let i = 0; i < 100; i++) {
  //       const filename = await Deno.makeTempFile({ prefix: 'racy_open_db' })
  //       try {
  //         const [db1, db2, db3] = await Promise.all([
  //           Deno.openKv(filename),
  //           Deno.openKv(filename),
  //           Deno.openKv(filename),
  //         ])
  //         db1.close()
  //         db2.close()
  //         db3.close()
  //       } finally {
  //         await Deno.remove(filename)
  //       }
  //     }
  //   },
  // })

  // Deno.test({
  //   name: 'racy write',
  //   async fn() {
  //     const filename = await Deno.makeTempFile({ prefix: 'racy_write_db' })
  //     const concurrency = 20
  //     const iterations = 5
  //     try {
  //       const dbs = await Promise.all(
  //         Array(concurrency)
  //           .fill(0)
  //           .map(() => Deno.openKv(filename)),
  //       )
  //       try {
  //         for (let i = 0; i < iterations; i++) {
  //           await Promise.all(
  //             dbs.map((db) => db.atomic().sum(['counter'], 1n).commit()),
  //           )
  //         }
  //         assertEquals(
  //           ((await dbs[0].get(['counter'])).value as Deno.KvU64).value,
  //           BigInt(concurrency * iterations),
  //         )
  //       } finally {
  //         dbs.forEach((db) => db.close())
  //       }
  //     } finally {
  //       await Deno.remove(filename)
  //     }
  //   },
  // })

  await test('kv expiration', async () => {
    const filename = join(tmpdir(), randomUUID())
    let db: Valkeyrie | null = null

    try {
      db = await Valkeyrie.open(filename)

      await db.set(['a'], 1, { expireIn: 1000 })
      await db.set(['b'], 2, { expireIn: 1000 })
      assert.deepEqual((await db.get(['a'])).value, 1)
      assert.deepEqual((await db.get(['b'])).value, 2)

      // Value overwrite should also reset expiration
      await db.set(['b'], 2, { expireIn: 3600 * 1000 })

      // Wait for expiration
      await setTimeout(1000)

      // Re-open to trigger immediate cleanup
      db.close()
      db = null
      db = await Valkeyrie.open(filename)

      let ok = false
      for (let i = 0; i < 50; i++) {
        await setTimeout(100)
        if (
          JSON.stringify(
            (await db.getMany([['a'], ['b']])).map((x) => x.value),
          ) === '[null,2]'
        ) {
          ok = true
          break
        }
      }

      if (!ok) {
        throw new Error('Values did not expire')
      }
    } finally {
      if (db) {
        try {
          db.close()
        } catch {
          // pass
        }
      }
      try {
        await unlink(filename)
      } catch {
        // pass
      }
    }
  })

  await test('kv expiration with atomic', async () => {
    const filename = join(tmpdir(), randomUUID())
    let db: Valkeyrie | null = null

    try {
      db = await Valkeyrie.open(filename)

      await db
        .atomic()
        .set(['a'], 1, { expireIn: 1000 })
        .set(['b'], 2, {
          expireIn: 1000,
        })
        .commit()
      assert.deepEqual(
        (await db.getMany([['a'], ['b']])).map((x) => x.value),
        [1, 2],
      )
      // Wait for expiration
      await setTimeout(1000)

      // Re-open to trigger immediate cleanup
      db.close()
      db = null
      db = await Valkeyrie.open(filename)

      let ok = false
      for (let i = 0; i < 50; i++) {
        await setTimeout(100)
        if (
          JSON.stringify(
            (await db.getMany([['a'], ['b']])).map((x) => x.value),
          ) === '[null,null]'
        ) {
          ok = true
          break
        }
      }

      if (!ok) {
        throw new Error('Values did not expire')
      }
    } finally {
      if (db) {
        try {
          db.close()
        } catch {
          // pass
        }
      }
      try {
        await unlink(filename)
      } catch {
        // pass
      }
    }
  })

  // Deno.test({
  //   name: 'remote backend',
  //   async fn() {
  //     const db = await Deno.openKv('http://localhost:4545/kv_remote_authorize')
  //     try {
  //       await db.set(['some-key'], 1)
  //       const entry = await db.get(['some-key'])
  //       assertEquals(entry.value, null)
  //       assertEquals(entry.versionstamp, null)
  //     } finally {
  //       db.close()
  //     }
  //   },
  // })

  // Deno.test({
  //   name: 'remote backend invalid format',
  //   async fn() {
  //     const db = await Deno.openKv(
  //       'http://localhost:4545/kv_remote_authorize_invalid_format',
  //     )

  //     await assertRejects(
  //       async () => {
  //         await db.set(['some-key'], 1)
  //       },
  //       Error,
  //       'Failed to parse metadata: ',
  //     )

  //     db.close()
  //   },
  // })

  // Deno.test({
  //   name: 'remote backend invalid version',
  //   async fn() {
  //     const db = await Deno.openKv(
  //       'http://localhost:4545/kv_remote_authorize_invalid_version',
  //     )

  //     await assertRejects(
  //       async () => {
  //         await db.set(['some-key'], 1)
  //       },
  //       Error,
  //       'Failed to parse metadata: unsupported metadata version: 1000',
  //     )

  //     db.close()
  //   },
  // })

  await test('Valkeyrie explicit resource management', async () => {
    let db2: Valkeyrie

    {
      await using db = await Valkeyrie.open()
      db2 = db

      const res = await db.get(['a'])
      assert.strictEqual(res.versionstamp, null)
    }

    await assert.rejects(() => db2.get(['a']), {
      name: 'Error',
      message: 'Database is closed',
    })
  })

  await test('Valkeyrie explicit resource management manual close', async () => {
    using db = await Valkeyrie.open()
    await db.close()

    await assert.rejects(() => db.get(['a']), {
      name: 'Error',
      message: 'Database is closed',
    })
    // calling [Symbol.dispose] after manual close is a no-op
  })

  // dbTest('key watch', async (db) => {
  //   const changeHistory: Deno.KvEntryMaybe<number>[] = []
  //   const watcher: ReadableStream<Deno.KvEntryMaybe<number>[]> = db.watch<
  //     number[]
  //   >([['key']])

  //   const reader = watcher.getReader()
  //   const expectedChanges = 2

  //   const work = (async () => {
  //     for (let i = 0; i < expectedChanges; i++) {
  //       const message = await reader.read()
  //       if (message.done) {
  //         throw new Error('Unexpected end of stream')
  //       }
  //       changeHistory.push(message.value[0])
  //     }

  //     await reader.cancel()
  //   })()

  //   while (changeHistory.length !== 1) {
  //     await sleep(100)
  //   }
  //   assertEquals(changeHistory[0], {
  //     key: ['key'],
  //     value: null,
  //     versionstamp: null,
  //   })

  //   const { versionstamp } = await db.set(['key'], 1)
  //   while ((changeHistory.length as number) !== 2) {
  //     await sleep(100)
  //   }
  //   assertEquals(changeHistory[1], {
  //     key: ['key'],
  //     value: 1,
  //     versionstamp,
  //   })

  //   await work
  //   await reader.cancel()
  // })

  // dbTest('set with key versionstamp suffix', async (db) => {
  //   const result1 = await Array.fromAsync(db.list({ prefix: ['a'] }))
  //   assertEquals(result1, [])

  //   const setRes1 = await db.set(['a', db.commitVersionstamp()], 'b')
  //   assert(setRes1.ok)
  //   assert(setRes1.versionstamp > ZERO_VERSIONSTAMP)

  //   const result2 = await Array.fromAsync(db.list({ prefix: ['a'] }))
  //   assertEquals(result2.length, 1)
  //   assertEquals(result2[0].key[1], setRes1.versionstamp)
  //   assertEquals(result2[0].value, 'b')
  //   assertEquals(result2[0].versionstamp, setRes1.versionstamp)

  //   const setRes2 = await db
  //     .atomic()
  //     .set(['a', db.commitVersionstamp()], 'c')
  //     .commit()
  //   assert(setRes2.ok)
  //   assert(setRes2.versionstamp > setRes1.versionstamp)

  //   const result3 = await Array.fromAsync(db.list({ prefix: ['a'] }))
  //   assertEquals(result3.length, 2)
  //   assertEquals(result3[1].key[1], setRes2.versionstamp)
  //   assertEquals(result3[1].value, 'c')
  //   assertEquals(result3[1].versionstamp, setRes2.versionstamp)

  //   await assertRejects(
  //     async () => await db.set(['a', db.commitVersionstamp(), 'a'], 'x'),
  //     TypeError,
  //     'expected string, number, bigint, ArrayBufferView, boolean',
  //   )
  // })

  // Deno.test({
  //   name: 'watch should stop when db closed',
  //   async fn() {
  //     const db = await Deno.openKv(':memory:')

  //     const watch = db.watch([['a']])
  //     const completion = (async () => {
  //       for await (const _item of watch) {
  //         // pass
  //       }
  //     })()

  //     setTimeout(() => {
  //       db.close()
  //     }, 100)

  //     await completion
  //   },
  // })

  await dbTest('list with more than 1000 elements', async (db) => {
    // Create 1200 elements with prefix ['large'] in smaller batches
    // First batch of 600
    let atomic = db.atomic()
    for (let i = 0; i < 600; i++) {
      atomic.set(['large', i.toString().padStart(4, '0')], i)
    }
    let res = await atomic.commit()
    assert(res.ok)

    // Second batch of 600
    atomic = db.atomic()
    for (let i = 600; i < 1200; i++) {
      atomic.set(['large', i.toString().padStart(4, '0')], i)
    }
    res = await atomic.commit()
    assert(res.ok)

    // List all elements without a limit (should return all 1200)
    const allEntries = await Array.fromAsync(db.list({ prefix: ['large'] }))
    assert.strictEqual(
      allEntries.length,
      1200,
      'Should return all 1200 elements',
    )

    // Verify the first and last elements
    assert.strictEqual(allEntries[0]?.value, 0)
    assert.strictEqual(allEntries[1199]?.value, 1199)

    // Test with a specific limit
    const limitedEntries = await Array.fromAsync(
      db.list({ prefix: ['large'] }, { limit: 500 }),
    )
    assert.strictEqual(
      limitedEntries.length,
      500,
      'Should respect the specified limit',
    )
  })

  await test(`works with 'await using' on db instance`, async () => {
    let _db: Valkeyrie

    {
      await using db = await Valkeyrie.open()
      _db = db
      await db.set(['a'], 1)
      assert.strictEqual((await db.get(['a'])).value, 1)
    }

    await assert.rejects(
      async () => await _db.close(),
      Error,
      'database is not open',
    )
  })

  await test(`works with 'await using' on list method`, async () => {
    let _db: Valkeyrie

    {
      const db = await Valkeyrie.open()
      _db = db

      await db.set(['a', '1'], 1)
      await db.set(['a', '2'], 2)
      await db.set(['a', '3'], 3)

      await using entries = db.list({ prefix: ['a'] })

      let count = 0
      for await (const entry of entries) {
        count++
        assert.strictEqual(entry.value, count)
      }

      assert.strictEqual(count, 3)
    }

    await assert.rejects(
      async () => await _db.close(),
      Error,
      'database is not open',
    )
  })
})
