import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { sqliteDriver } from '../src/sqlite-driver.js'

const hash = (key: string) => createHash('sha256').update(key).digest('hex')

interface CustomError extends Error {
  code?: string
}

describe('sqliteDriver', async () => {
  const TEST_DB_PATH = 'test-db.sqlite'
  let driver: Awaited<ReturnType<typeof sqliteDriver>>

  beforeEach(async () => {
    // Clean up any existing test database
    driver = await sqliteDriver(TEST_DB_PATH)
  })

  afterEach(async () => {
    await driver.close()
    await driver.destroy()
  })

  await test('handles null results in watch streams', async () => {
    const keyHash = hash('nonexistent-key')
    const stream = driver.watch([keyHash])
    const reader = stream.getReader()

    // This should return values with null for the nonexistent key
    const { value, done } = await reader.read()
    assert(!done, 'Stream should not be done')
    assert(value && value.length === 1, 'Should return an array with one item')
    assert.deepStrictEqual(value[0], {
      keyHash,
      value: null,
      versionstamp: null,
    })

    // Properly release and clean up (no cancel which causes issues)
    reader.releaseLock()
  })

  await test('destroys file-based databases', async () => {
    // Set some data
    await driver.set(hash('test-key'), 'test-value', 'v1')

    // Use node's unlink directly without spying
    await driver.destroy()

    // Check that the file no longer exists
    assert(!existsSync(TEST_DB_PATH), 'Database file should be deleted')
    assert(!existsSync(`${TEST_DB_PATH}-shm`), 'SHM file should be deleted')
    assert(!existsSync(`${TEST_DB_PATH}-wal`), 'WAL file should be deleted')
  })

  await test('handles unlink errors in destroy gracefully', async () => {
    // For this test, we'll create a special instance of the driver with a custom file path
    const ERROR_TEST_PATH = 'error-test.sqlite'
    const errorDriver = await sqliteDriver(ERROR_TEST_PATH)

    // Set some data
    await errorDriver.set(hash('test-key'), 'test-value', 'v1')

    // Create a file path that doesn't exist to force unlink to fail naturally
    // This test is different - instead of mocking unlink, we'll ensure the destroy
    // function properly handles the catch blocks by trying to destroy a file that
    // has already been deleted

    // First delete the files manually
    if (existsSync(ERROR_TEST_PATH)) {
      await unlink(ERROR_TEST_PATH).catch(() => {})
      await unlink(`${ERROR_TEST_PATH}-shm`).catch(() => {})
      await unlink(`${ERROR_TEST_PATH}-wal`).catch(() => {})
    }

    // Now call destroy - this should not throw even though the files are gone
    await errorDriver.destroy()

    // Clean up
    await errorDriver.close()
  })

  await test('retries transactions on SQLITE_BUSY errors', async () => {
    // Create a mock function that throws SQLITE_BUSY on first call
    let callCount = 0
    const busyErrorFn = async () => {
      if (callCount === 0) {
        callCount++
        const error = new Error('database is locked') as CustomError
        error.code = 'SQLITE_BUSY'
        throw error
      }
      return 'success'
    }

    // Use the mock in a transaction
    const result = await driver.withTransaction(busyErrorFn)

    // Should have retried and succeeded
    assert.strictEqual(callCount, 1)
    assert.strictEqual(result, 'success')
  })

  await test('notifies watchers when data changes', async () => {
    const keyHash = hash('watched-key')

    // Start watching before the key exists
    const stream = driver.watch([keyHash])
    const reader = stream.getReader()

    // Initial read should return null
    const initialRead = await reader.read()
    assert(!initialRead.done, 'Stream should not be done')
    assert(initialRead.value, 'Should have a value')
    assert.strictEqual(initialRead.value?.[0]?.value, null)

    // Set the key
    await driver.set(keyHash, 'test-value', 'v1')

    // Should get notification with the new value
    const update = await reader.read()
    assert(!update.done, 'Stream should not be done')
    assert(update.value, 'Should have a value')
    assert.strictEqual(update.value?.[0]?.keyHash, keyHash)
    assert.strictEqual(update.value?.[0]?.value, 'test-value')

    // Just release the lock without cancelling
    reader.releaseLock()
  })

  await test('properly handles stream cancel mechanism', async () => {
    const keyHash = hash('cancel-mechanic-test')

    // Create mock controller
    const mockController = {
      enqueue: () => {},
      close: () => {},
    }

    // Create a special version of the test driver to test the internal cancel logic
    const testDriver = await sqliteDriver(TEST_DB_PATH)

    // Directly access the watchQueue and insert our mock
    // We need to use 'any' since we are accessing private implementation details for testing

    // biome-ignore lint/suspicious/noExplicitAny: testing
    const driverAny = testDriver as any

    // Find the watchQueue symbol or property
    type WatchQueueItem = {
      keyHashes: string[]
      controller: { close: () => void; enqueue: (val: unknown) => void }
    }
    let watchQueue: WatchQueueItem[] | undefined

    // Try to find watchQueue whether it's a direct property or a symbol
    for (const key of Object.getOwnPropertyNames(driverAny)) {
      if (key === 'watchQueue' || key.includes('watchQueue')) {
        watchQueue = driverAny[key]
        break
      }
    }

    if (!watchQueue) {
      for (const sym of Object.getOwnPropertySymbols(driverAny)) {
        if (sym.toString().includes('watchQueue')) {
          watchQueue = driverAny[sym]
          break
        }
      }
    }

    // If we found the watchQueue, we can test the cancel functionality
    if (watchQueue) {
      // Push our mock controller
      watchQueue.push({
        keyHashes: [keyHash],
        controller: mockController,
      })

      // Get a real stream
      const stream = testDriver.watch([keyHash])

      // Cancel it - this should call controller.close()
      await stream.cancel()

      // Ensure that our driver still works
      await testDriver.set(keyHash, 'after-cancel-test', 'v1')
      const result = await testDriver.get(keyHash, Date.now())
      assert.strictEqual(result?.value, 'after-cancel-test')
    }

    await testDriver.close()
  })

  await test('handles watch cancellation', async () => {
    const keyHash = hash('cancel-test-key')

    // Create a stream and read from it
    const stream = driver.watch([keyHash])
    const reader = stream.getReader()

    // Read the initial null value
    await reader.read()

    // Release the lock (don't cancel)
    reader.releaseLock()

    // Set the key - this should not throw
    await driver.set(keyHash, 'test-value', 'v1')

    // Create a new stream for the same key
    const newStream = driver.watch([keyHash])
    const newReader = newStream.getReader()

    // Should get the value
    const { value, done } = await newReader.read()
    assert(!done, 'Stream should not be done')
    assert(value, 'Should have a value')
    assert.strictEqual(value?.[0]?.value, 'test-value')

    // Just release the lock
    newReader.releaseLock()
  })

  await test('handles controller close errors', async () => {
    // For this test, we'll create a real close error scenario
    // First, create a database and get a watch going
    const memDriver = await sqliteDriver(':memory:')
    const keyHash = hash('test-key')

    // Set up a watch
    const stream = memDriver.watch([keyHash])

    // Start reading from it in a separate task
    const readerTask = (async () => {
      const reader = stream.getReader()
      try {
        await reader.read()
      } catch (e) {
        // This will throw when we close the driver
      }
    })()

    // Give the reader a chance to start
    await setTimeout(10)

    // Close the driver while the reader is active - should not throw
    await memDriver.close()

    // Wait for reader task to complete
    await readerTask
  })

  await test('clears memory databases on destroy', async () => {
    // Create a memory DB
    const memoryDriver = await sqliteDriver(':memory:')

    // Set some data
    const keyHash = hash('memory-key')
    await memoryDriver.set(keyHash, 'memory-value', 'v1')

    // Create a watch to test notification
    const stream = memoryDriver.watch([keyHash])
    const reader = stream.getReader()

    // Initial read
    await reader.read()

    // Release the reader lock
    reader.releaseLock()

    // Destroy should clear, not unlink for memory DBs
    await memoryDriver.destroy()

    // Verify the key is gone
    const result = await memoryDriver.get(keyHash, Date.now())
    assert.strictEqual(result, undefined)

    await memoryDriver.close()
  })

  await test('handles multiple concurrent transactions correctly', async () => {
    // Start multiple transactions that will be processed sequentially
    const results = await Promise.all([
      driver.withTransaction(async () => {
        await driver.set(hash('tx1'), 'value1', 'v1')
        return 1
      }),
      driver.withTransaction(async () => {
        await driver.set(hash('tx2'), 'value2', 'v2')
        return 2
      }),
      driver.withTransaction(async () => {
        await driver.set(hash('tx3'), 'value3', 'v3')
        return 3
      }),
    ])

    assert.deepStrictEqual(results, [1, 2, 3])

    // Verify all transactions were applied
    const tx1 = await driver.get(hash('tx1'), Date.now())
    const tx2 = await driver.get(hash('tx2'), Date.now())
    const tx3 = await driver.get(hash('tx3'), Date.now())

    assert.strictEqual(tx1?.value, 'value1')
    assert.strictEqual(tx2?.value, 'value2')
    assert.strictEqual(tx3?.value, 'value3')
  })

  await test('uses backoff when encountering database locks', async () => {
    let attempts = 0
    const busyErrorFn = async () => {
      attempts++
      if (attempts <= 3) {
        const error = new Error('database is locked') as CustomError
        error.code = 'SQLITE_BUSY'
        throw error
      }
      return 'success after backoff'
    }

    // Since we can't easily mock the built-in setTimeout, just verify transaction succeeds
    const result = await driver.withTransaction(busyErrorFn)

    assert.strictEqual(attempts, 4, 'Should have attempted 4 times')
    assert.strictEqual(result, 'success after backoff')
  })
})
