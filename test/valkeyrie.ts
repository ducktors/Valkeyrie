import assert, { AssertionError } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { access, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { inspect } from 'node:util'
import { KvU64 } from '../src/kv-u64.js'
import {
  AtomicOperation,
  type EntryMaybe,
  type Key,
  type Mutation,
  Valkeyrie,
} from '../src/valkeyrie.js'

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

  await dbTest('atomic operation is exposed', (db) => {
    assert(AtomicOperation)
    const ao = db.atomic()
    assert(ao instanceof AtomicOperation)
  })

  await test('racy open', async () => {
    for (let i = 0; i < 100; i++) {
      const filename = join(tmpdir(), randomUUID())

      try {
        const [db1, db2, db3] = await Promise.all([
          Valkeyrie.open(filename),
          Valkeyrie.open(filename),
          Valkeyrie.open(filename),
        ])
        await Promise.all([db1.close(), db2.close(), db3.close()])
      } finally {
        await unlink(filename)
      }
    }
  })

  await test('racy write', async () => {
    const filename = join(tmpdir(), randomUUID())
    const concurrency = 20
    const iterations = 5

    try {
      const dbs = await Promise.all(
        Array(concurrency)
          .fill(0)
          .map(() => Valkeyrie.open(filename)),
      )

      try {
        for (let i = 0; i < iterations; i++) {
          await Promise.all(
            dbs.map((db) => db.atomic().sum(['counter'], 1n).commit()),
          )
        }

        assert.deepEqual(
          // biome-ignore lint/style/noNonNullAssertion: testing
          ((await dbs[0]!.get(['counter'])).value as KvU64).value,
          concurrency * iterations,
        )
      } finally {
        if (dbs) {
          for (const db of dbs) {
            await db.close()
          }
        }
      }
    } finally {
      await unlink(filename)
    }
  })

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

  dbTest('key watch', async (db) => {
    const changeHistory: EntryMaybe<number>[] = []
    const watcher: ReadableStream<EntryMaybe<number>[]> = db.watch<number[]>([
      ['key'],
    ])

    const reader = watcher.getReader()
    const expectedChanges = 2

    const work = (async () => {
      for (let i = 0; i < expectedChanges; i++) {
        const message = await reader.read()
        if (message.done) {
          throw new Error('Unexpected end of stream')
        }
        // biome-ignore lint/style/noNonNullAssertion: <explanation>
        changeHistory.push(message.value[0]!)
      }

      await reader.cancel()
    })()

    while (changeHistory.length !== 1) {
      await setTimeout(100)
    }
    assert.deepStrictEqual(changeHistory[0], {
      key: ['key'],
      value: null,
      versionstamp: null,
    })

    const { versionstamp } = await db.set(['key'], 1)
    while ((changeHistory.length as number) !== 2) {
      await setTimeout(100)
    }
    assert.deepStrictEqual(changeHistory[1], {
      key: ['key'],
      value: 1,
      versionstamp,
    })

    await work
    await reader.cancel()
  })

  await test('watch should stop when db closed', async () => {
    const db = await Valkeyrie.open(':memory:')

    const watch = db.watch([['a']])
    const completion = (async () => {
      for await (const _item of watch) {
        // pass
      }
    })()

    await setTimeout(100)
    await db.close()

    await completion
  })

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

  await test('destroy clears the db for in-memory db', async () => {
    const db = await Valkeyrie.open(':memory:')
    await db.destroy()
    assert.strictEqual((await db.get(['a'])).value, null)
  })

  await test('destroy deletes the file for persistent db', async () => {
    const filename = join(tmpdir(), randomUUID())
    const db = await Valkeyrie.open(filename)
    assert.strictEqual(await access(filename), undefined)
    await db.destroy()
    await assert.rejects(() => access(filename), {
      name: 'Error',
      message: `ENOENT: no such file or directory, access '${filename}'`,
    })
  })

  await test('clear removes all data', async () => {
    const db = await Valkeyrie.open(':memory:')
    await db.set(['a'], 1)
    assert.strictEqual((await db.get(['a'])).value, 1)
    await db.clear()
    assert.strictEqual((await db.get(['a'])).value, null)
  })

  await test('clear removes all data and keeps the file for persistent db', async () => {
    const filename = join(tmpdir(), randomUUID())
    const db = await Valkeyrie.open(filename)
    await db.set(['a'], 1)
    assert.strictEqual((await db.get(['a'])).value, 1)
    await db.clear()
    assert.strictEqual((await db.get(['a'])).value, null)
    assert.strictEqual(await access(filename), undefined)
  })

  await test('destroyOnClose option with persistent db', async () => {
    const filename = join(tmpdir(), randomUUID())
    {
      await using db = await Valkeyrie.open(filename, { destroyOnClose: true })
      await db.set(['a'], 1)
      assert.strictEqual((await db.get(['a'])).value, 1)
    }
    await assert.rejects(() => access(filename), {
      name: 'Error',
      message: `ENOENT: no such file or directory, access '${filename}'`,
    })
  })
})
