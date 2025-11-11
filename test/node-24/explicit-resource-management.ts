import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { Valkeyrie } from '../../src/valkeyrie.ts'

describe('Explicit Resource Management (Node.js 24+)', async () => {
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
