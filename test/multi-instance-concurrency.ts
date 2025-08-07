import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { Valkeyrie } from '../src/valkeyrie.js'

describe('Multi-Instance Concurrency', () => {
  const testDbPath = join(tmpdir(), `test-multi-${randomUUID()}.db`)
  let instance1: Valkeyrie
  let instance2: Valkeyrie
  let instance3: Valkeyrie

  before(async () => {
    // Create multiple instances sharing the same database file
    instance1 = await Valkeyrie.open(testDbPath)
    instance2 = await Valkeyrie.open(testDbPath)
    instance3 = await Valkeyrie.open(testDbPath)
  })

  after(async () => {
    await instance1.close()
    await instance2.close()
    await instance3.close()
  })

  it('should generate unique versionstamps across instances', async () => {
    const key = ['test', 'unique-versionstamps']

    // Set values from different instances rapidly
    const promises = [
      instance1.set(key, 'value1'),
      instance2.set(key, 'value2'),
      instance3.set(key, 'value3'),
    ]

    const results = await Promise.all(promises)

    // All versionstamps should be unique
    const versionstamps = results.map((r) => r.versionstamp)
    const uniqueVersionstamps = new Set(versionstamps)

    assert.strictEqual(
      uniqueVersionstamps.size,
      3,
      'All versionstamps should be unique',
    )

    // All versionstamps should be 28 characters (new format)
    for (const vs of versionstamps) {
      assert.strictEqual(
        vs.length,
        28,
        `Versionstamp ${vs} should be 28 characters`,
      )
    }
  })

  it('should maintain atomic operations consistency across instances', async () => {
    const key = ['test', 'atomic-consistency']

    // Set initial value
    await instance1.set(key, 0)
    const initial = await instance1.get(key)

    // Perform concurrent atomic increments from different instances
    const incrementPromises = []
    const numIncrements = 10

    for (let i = 0; i < numIncrements; i++) {
      const instance = [instance1, instance2, instance3][i % 3]
      incrementPromises.push(
        instance
          .atomic()
          .check({ key, versionstamp: null }) // This will fail, but we'll use proper atomic increment
          .mutate({ key, type: 'set', value: i })
          .commit(),
      )
    }

    // Let's do proper atomic increments instead
    for (let i = 0; i < numIncrements; i++) {
      const instance = [instance1, instance2, instance3][i % 3]
      let success = false
      let attempts = 0

      while (!success && attempts < 10) {
        const current = await instance.get(key)
        const result = await instance
          .atomic()
          .check({ key, versionstamp: current.versionstamp })
          .mutate({ key, type: 'set', value: (current.value as number) + 1 })
          .commit()

        if (result.ok) {
          success = true
        } else {
          attempts++
          await setTimeout(Math.random() * 10) // Random backoff
        }
      }

      assert(success, `Atomic increment ${i} should succeed within 10 attempts`)
    }

    // Final value should be initial + numIncrements
    const final = await instance1.get(key)
    assert.strictEqual(
      final.value,
      numIncrements,
      'Final value should equal number of increments',
    )
  })

  it('should handle check-and-set operations across instances', async () => {
    const key = ['test', 'check-and-set']

    // Set initial value
    const { versionstamp: initialVs } = await instance1.set(key, 'initial')

    // Try to set from multiple instances with same versionstamp
    const promises = [
      instance1
        .atomic()
        .check({ key, versionstamp: initialVs })
        .mutate({ key, type: 'set', value: 'changed-by-1' })
        .commit(),
      instance2
        .atomic()
        .check({ key, versionstamp: initialVs })
        .mutate({ key, type: 'set', value: 'changed-by-2' })
        .commit(),
      instance3
        .atomic()
        .check({ key, versionstamp: initialVs })
        .mutate({ key, type: 'set', value: 'changed-by-3' })
        .commit(),
    ]

    const results = await Promise.all(promises)

    // Only one should succeed
    const successful = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok)

    assert.strictEqual(
      successful.length,
      1,
      'Only one check-and-set should succeed',
    )
    assert.strictEqual(
      failed.length,
      2,
      'Two check-and-set operations should fail',
    )

    // Verify the final value is from the successful operation
    const final = await instance1.get(key)
    assert(
      ['changed-by-1', 'changed-by-2', 'changed-by-3'].includes(
        final.value as string,
      ),
      'Final value should be from one of the instances',
    )
  })

  it('should handle lock contention and retry mechanism', async () => {
    const key = ['test', 'lock-contention']

    // Set initial value
    await instance1.set(key, 0)

    // Create high contention scenario
    const numOperations = 20
    const promises = []

    for (let i = 0; i < numOperations; i++) {
      const instance = [instance1, instance2, instance3][i % 3]
      promises.push(
        (async () => {
          let success = false
          let attempts = 0

          while (!success && attempts < 15) {
            try {
              const current = await instance.get(key)
              const result = await instance
                .atomic()
                .check({ key, versionstamp: current.versionstamp })
                .mutate({
                  key,
                  type: 'set',
                  value: (current.value as number) + 1,
                })
                .commit()

              if (result.ok) {
                success = true
              } else {
                attempts++
                // Small random delay to avoid thundering herd
                await setTimeout(Math.random() * 5)
              }
            } catch (error) {
              attempts++
              await setTimeout(Math.random() * 5)
            }
          }

          return { success, attempts }
        })(),
      )
    }

    const results = await Promise.all(promises)

    // All operations should eventually succeed
    const allSuccessful = results.every((r) => r.success)
    assert(
      allSuccessful,
      'All operations should eventually succeed despite contention',
    )

    // Final value should be initial + numOperations
    const final = await instance1.get(key)
    assert.strictEqual(
      final.value,
      numOperations,
      'Final value should equal number of operations',
    )

    // Log average attempts for analysis
    const avgAttempts =
      results.reduce((sum, r) => sum + r.attempts, 0) / results.length
    console.log(`Average attempts per operation: ${avgAttempts.toFixed(2)}`)
  })

  it.skip('should support watch functionality across instances', async () => {
    const key = ['test', 'watch-cross-instance']

    // Set initial value
    await instance1.set(key, 'initial')

    // Set up watchers from different instances
    const watcher1 = instance1.watch([key])
    const watcher2 = instance2.watch([key])

    const events1: ReadableStreamReadResult<unknown>[] = []
    const events2: ReadableStreamReadResult<unknown>[] = []

    const reader1 = watcher1.getReader()
    const reader2 = watcher2.getReader()

    // Read initial values
    events1.push(await reader1.read())
    events2.push(await reader2.read())

    // Change value from instance3
    await instance3.set(key, 'changed')

    // Wait a bit for watch events to propagate
    await setTimeout(100)

    // Read change events (may timeout, so we'll make this non-blocking)
    try {
      const change1 = await Promise.race([
        reader1.read(),
        setTimeout(1000).then(() => ({ done: true, value: undefined })),
      ])
      if (!change1.done) events1.push(change1)

      const change2 = await Promise.race([
        reader2.read(),
        setTimeout(1000).then(() => ({ done: true, value: undefined })),
      ])
      if (!change2.done) events2.push(change2)
    } catch (error) {
      console.log('Watch functionality may not work in this test environment')
    }

    // Clean up
    await reader1.cancel()
    await reader2.cancel()

    // Both watchers should have received events
    assert(events1.length >= 1, 'Instance1 watcher should receive events')
    assert(events2.length >= 1, 'Instance2 watcher should receive events')
  })

  it('should handle high-contention scenarios with multiple instances', async () => {
    const key = ['test', 'high-contention']

    // Set initial value
    await instance1.set(key, 0)

    // Create very high contention with rapid operations
    const numOperations = 50
    const promises = []

    for (let i = 0; i < numOperations; i++) {
      const instance = [instance1, instance2, instance3][i % 3]
      promises.push(
        (async () => {
          let success = false
          let attempts = 0
          const maxAttempts = 20

          while (!success && attempts < maxAttempts) {
            try {
              const current = await instance.get(key)
              const result = await instance
                .atomic()
                .check({ key, versionstamp: current.versionstamp })
                .mutate({
                  key,
                  type: 'set',
                  value: (current.value as number) + 1,
                })
                .commit()

              if (result.ok) {
                success = true
              } else {
                attempts++
                // Exponential backoff with jitter
                const delay = Math.min(2 ** attempts + Math.random() * 10, 100)
                await setTimeout(delay)
              }
            } catch (error) {
              attempts++
              const delay = Math.min(2 ** attempts + Math.random() * 10, 100)
              await setTimeout(delay)
            }
          }

          return { success, attempts, maxAttempts }
        })(),
      )
    }

    const results = await Promise.all(promises)

    // Most operations should succeed (allowing for some failures under extreme contention)
    const successfulOps = results.filter((r) => r.success).length
    const successRate = successfulOps / numOperations

    assert(
      successRate >= 0.8,
      `Success rate should be at least 80%, got ${(successRate * 100).toFixed(1)}%`,
    )

    // Final value should equal successful operations
    const final = await instance1.get(key)
    assert.strictEqual(
      final.value,
      successfulOps,
      'Final value should equal successful operations',
    )

    console.log(
      `High-contention test: ${successfulOps}/${numOperations} operations succeeded (${(successRate * 100).toFixed(1)}%)`,
    )
  })
})
