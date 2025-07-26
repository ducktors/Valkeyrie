import assert from 'node:assert'
import { unlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { Valkeyrie } from '../src/valkeyrie.js'

const cleanup = async (path: string) =>
  Promise.allSettled([
    unlink(path),
    unlink(`${path}-shm`),
    unlink(`${path}-wal`),
  ])

describe('Multi-Instance Concurrency', async () => {
  const TEST_DB_PATH = 'multi-instance-test.sqlite'
  let instances: Valkeyrie[] = []

  beforeEach(async () => {
    await cleanup(TEST_DB_PATH)
    instances = []
  })

  afterEach(async () => {
    // Close all instances
    await Promise.all(instances.map((instance) => instance.close()))
    await cleanup(TEST_DB_PATH)
    instances = []
  })

  await test('multiple instances generate unique versionstamps', async () => {
    // Create multiple instances
    const instance1 = await Valkeyrie.open(TEST_DB_PATH)
    const instance2 = await Valkeyrie.open(TEST_DB_PATH)
    const instance3 = await Valkeyrie.open(TEST_DB_PATH)
    instances.push(instance1, instance2, instance3)

    const versionstamps = new Set<string>()
    const operations = []

    // Perform concurrent set operations
    for (let i = 0; i < 100; i++) {
      operations.push(
        instance1
          .set([`test1-${i}`], `value1-${i}`)
          .then((result) => versionstamps.add(result.versionstamp)),
        instance2
          .set([`test2-${i}`], `value2-${i}`)
          .then((result) => versionstamps.add(result.versionstamp)),
        instance3
          .set([`test3-${i}`], `value3-${i}`)
          .then((result) => versionstamps.add(result.versionstamp)),
      )
    }

    await Promise.all(operations)

    // All versionstamps should be unique
    assert.strictEqual(
      versionstamps.size,
      300,
      'All versionstamps should be unique',
    )

    // Verify versionstamps have the new format (28 characters)
    for (const versionstamp of versionstamps) {
      assert.strictEqual(
        versionstamp.length,
        28,
        'Versionstamp should be 28 characters long',
      )
      assert.match(
        versionstamp,
        /^[0-9a-f]{28}$/,
        'Versionstamp should be hex string',
      )
    }
  })

  await test('atomic operations maintain consistency across instances', async () => {
    const instance1 = await Valkeyrie.open(TEST_DB_PATH)
    const instance2 = await Valkeyrie.open(TEST_DB_PATH)
    instances.push(instance1, instance2)

    const key = ['counter']

    // Initialize counter
    await instance1.set(key, 0)

    // Perform concurrent atomic increments
    const numOperations = 50
    const operations = []

    for (let i = 0; i < numOperations; i++) {
      // Alternate between instances
      const instance = i % 2 === 0 ? instance1 : instance2

      operations.push(
        instance
          .atomic()
          .set(key, i) // Set to operation index for testing
          .commit(),
      )
    }

    const results = await Promise.all(operations)

    // Count successful operations
    const successful = results.filter((result) => result.ok).length

    // All operations should succeed (no conflicts since we're not checking specific versionstamps)
    assert.strictEqual(
      successful,
      numOperations,
      'All atomic operations should succeed',
    )

    // Verify final state is consistent
    const finalEntry1 = await instance1.get(key)
    const finalEntry2 = await instance2.get(key)

    assert.deepStrictEqual(
      finalEntry1,
      finalEntry2,
      'Both instances should see the same final state',
    )
    assert.notStrictEqual(
      finalEntry1.versionstamp,
      null,
      'Final entry should have a versionstamp',
    )
  })

  await test('check-and-set operations work correctly across instances', async () => {
    const instance1 = await Valkeyrie.open(TEST_DB_PATH)
    const instance2 = await Valkeyrie.open(TEST_DB_PATH)
    instances.push(instance1, instance2)

    const key = ['shared-value']

    // Set initial value from instance1
    const initialResult = await instance1.set(key, 'initial')

    // Both instances read the current value
    const entry1 = await instance1.get(key)
    const entry2 = await instance2.get(key)

    assert.deepStrictEqual(
      entry1,
      entry2,
      'Both instances should read the same value',
    )
    assert.strictEqual(
      entry1.versionstamp,
      initialResult.versionstamp,
      'Versionstamp should match',
    )

    // Instance1 performs check-and-set
    const update1 = instance1
      .atomic()
      .check({ key, versionstamp: entry1.versionstamp })
      .set(key, 'updated-by-instance1')
      .commit()

    // Instance2 performs check-and-set with same versionstamp (should fail)
    const update2 = instance2
      .atomic()
      .check({ key, versionstamp: entry2.versionstamp })
      .set(key, 'updated-by-instance2')
      .commit()

    const [result1, result2] = await Promise.all([update1, update2])

    // Exactly one should succeed
    const successCount = [result1, result2].filter((r) => r.ok).length
    assert.strictEqual(
      successCount,
      1,
      'Exactly one check-and-set should succeed',
    )

    // Verify final state
    const finalEntry = await instance1.get(key)
    const finalEntry2 = await instance2.get(key)

    assert.deepStrictEqual(
      finalEntry,
      finalEntry2,
      'Both instances should see consistent final state',
    )

    if (result1.ok) {
      assert.strictEqual(finalEntry.value, 'updated-by-instance1')
      assert.strictEqual(finalEntry.versionstamp, result1.versionstamp)
    } else if (result2.ok) {
      assert.strictEqual(finalEntry.value, 'updated-by-instance2')
      assert.strictEqual(finalEntry.versionstamp, result2.versionstamp)
    }
  })

  await test('concurrent atomic operations handle lock contention gracefully', async () => {
    const instance1 = await Valkeyrie.open(TEST_DB_PATH)
    const instance2 = await Valkeyrie.open(TEST_DB_PATH)
    const instance3 = await Valkeyrie.open(TEST_DB_PATH)
    instances.push(instance1, instance2, instance3)

    const key = ['contention-test']

    // Set initial value
    await instance1.set(key, 0)

    // Create many concurrent atomic operations
    const numOperations = 30
    const operations = []

    for (let i = 0; i < numOperations; i++) {
      const instance = [instance1, instance2, instance3][i % 3]

      operations.push(instance.atomic().set(key, i).commit())
    }

    // Execute all operations concurrently
    const startTime = Date.now()
    const results = await Promise.all(operations)
    const endTime = Date.now()

    // All operations should complete successfully
    const successful = results.filter((result) => result.ok).length
    assert.strictEqual(
      successful,
      numOperations,
      'All atomic operations should succeed despite contention',
    )

    // Operations should complete in reasonable time (less than 5 seconds)
    const duration = endTime - startTime
    assert(duration < 5000, `Operations took too long: ${duration}ms`)

    // Final state should be consistent across all instances
    const [final1, final2, final3] = await Promise.all([
      instance1.get(key),
      instance2.get(key),
      instance3.get(key),
    ])

    assert.deepStrictEqual(
      final1,
      final2,
      'Instance1 and Instance2 should see same state',
    )
    assert.deepStrictEqual(
      final2,
      final3,
      'Instance2 and Instance3 should see same state',
    )
  })

  await test.skip('instances can watch and receive updates from other instances (cross-process watching not implemented)', async () => {
    const instance1 = await Valkeyrie.open(TEST_DB_PATH)
    const instance2 = await Valkeyrie.open(TEST_DB_PATH)
    instances.push(instance1, instance2)

    const key = ['watched-key']

    // Start watching from instance1
    const stream = instance1.watch([key])
    const reader = stream.getReader()

    // Read initial state (should be null)
    const initial = await reader.read()
    assert(!initial.done, 'Stream should not be done')
    assert.strictEqual(
      initial.value?.[0]?.value,
      null,
      'Initial value should be null',
    )

    // Set value from instance2
    await instance2.set(key, 'hello from instance2')

    // Instance1 should receive the update
    const update = await reader.read()
    assert(!initial.done, 'Stream should not be done')
    assert.strictEqual(
      update.value?.[0]?.value,
      'hello from instance2',
      'Should receive update from other instance',
    )

    // Update from instance1
    await instance1.set(key, 'response from instance1')

    // Should receive own update too
    const selfUpdate = await reader.read()
    assert.strictEqual(
      selfUpdate.value?.[0]?.value,
      'response from instance1',
      'Should receive own updates',
    )

    reader.releaseLock()
  })

  await test.skip('transaction retry mechanism works under high contention (test needs refinement)', async () => {
    const numInstances = 5
    const instancePromises = []

    for (let i = 0; i < numInstances; i++) {
      instancePromises.push(Valkeyrie.open(TEST_DB_PATH))
    }

    const instanceArray = await Promise.all(instancePromises)
    instances.push(...instanceArray)

    const key = ['retry-test']

    // Set initial value
    if (instances.length > 0) {
      await instances[0].set(key, 0)
    }

    // Create operations that will cause high contention
    const operations = []

    for (let i = 0; i < 20; i++) {
      const instance = instances[i % numInstances]

      if (instance) {
        operations.push(instance.atomic().set(key, `operation-${i}`).commit())
      }
    }

    // All should complete successfully despite contention
    const results = await Promise.all(operations)
    const successful = results.filter((r) => r.ok).length

    assert.strictEqual(
      successful,
      20,
      'All operations should succeed with retry mechanism',
    )

    // Verify consistency
    const finalValues = await Promise.all(
      instances.map((instance) => instance.get(key)),
    )

    // All instances should see the same final value
    const firstValue = finalValues[0]
    for (const value of finalValues) {
      assert.deepStrictEqual(
        value,
        firstValue,
        'All instances should see consistent final state',
      )
    }
  })
})
