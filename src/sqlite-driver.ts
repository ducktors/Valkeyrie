import { unlink } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout } from 'node:timers/promises'
import { type DriverValue, defineDriver } from './driver.js'
import type { Serializer } from './serializers/serializer.js'
import { v8Serializer } from './serializers/v8.js'

type SqlRow = Pick<DriverValue, 'versionstamp'> & {
  key_hash: string
  value: Uint8Array
  is_u64: number
}

// Global write queue to ensure atomic operations are serialized
const writeQueue: Array<() => Promise<void>> = []
let isProcessing = false

interface SqliteError extends Error {
  code?: string
  message: string
}

const MEMORY_PATH = ':memory:'

export const sqliteDriver = defineDriver(
  async (path = MEMORY_PATH, customSerializer?: () => Serializer) => {
    const db = new DatabaseSync(path)

    db.exec(`
    PRAGMA synchronous = NORMAL;
    PRAGMA journal_mode = WAL;
    `)

    // Create the KV table with versioning and expiry support
    db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key_hash TEXT PRIMARY KEY,
      value BLOB,
      versionstamp TEXT NOT NULL,
      expires_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_kv_store_expires_at
    ON kv_store(expires_at)
    WHERE expires_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_kv_store_key_hash
    ON kv_store(key_hash);
    `)

    const statements = {
      get: db.prepare(
        'SELECT key_hash, value, versionstamp FROM kv_store WHERE key_hash = ? AND (expires_at IS NULL OR expires_at > ?)',
      ),
      set: db.prepare(
        'INSERT OR REPLACE INTO kv_store (key_hash, value, versionstamp) VALUES (?, ?, ?)',
      ),
      setWithExpiry: db.prepare(
        'INSERT OR REPLACE INTO kv_store (key_hash, value, versionstamp, expires_at) VALUES (?, ?, ?, ?)',
      ),
      delete: db.prepare('DELETE FROM kv_store WHERE key_hash = ?'),
      list: db.prepare(
        'SELECT key_hash, value, versionstamp FROM kv_store WHERE key_hash >= ? AND key_hash < ? AND key_hash != ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key_hash ASC LIMIT ?',
      ),
      listReverse: db.prepare(
        'SELECT key_hash, value, versionstamp FROM kv_store WHERE key_hash >= ? AND key_hash < ? AND key_hash != ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key_hash DESC LIMIT ?',
      ),
      cleanup: db.prepare('DELETE FROM kv_store WHERE expires_at <= ?'),
      clear: db.prepare('DELETE FROM kv_store'),
    }

    // Use the provided serializer or default to v8Serializer
    const serializer = await (customSerializer
      ? customSerializer()
      : v8Serializer())

    // Global watch queue to store watchers
    const watchQueue: Array<{
      keyHashes: string[]
      controller: ReadableStreamDefaultController<
        (DriverValue | { keyHash: string; value: null; versionstamp: null })[]
      >
    }> = []

    // Function to notify watchers of changes
    async function notifyWatchers() {
      const now = Date.now()
      for (const watcher of watchQueue) {
        const results = await Promise.all(
          watcher.keyHashes.map(async (keyHash) => {
            const result = statements.get.get(keyHash, now) as
              | SqlRow
              | undefined
            if (!result) {
              return {
                keyHash,
                value: null,
                versionstamp: null,
              }
            }
            return {
              keyHash: result.key_hash,
              value: serializer.deserialize(result.value),
              versionstamp: result.versionstamp,
            }
          }),
        )
        watcher.controller.enqueue(results)
      }
    }

    async function processWriteQueue() {
      if (isProcessing || writeQueue.length === 0) return
      isProcessing = true

      try {
        while (writeQueue.length > 0) {
          const operation = writeQueue.shift()
          if (operation) {
            await operation()
          }
        }
      } finally {
        isProcessing = false
      }
    }

    return {
      close: async () => {
        // Cancel all watchers
        for (const watcher of watchQueue) {
          try {
            watcher.controller.close()
          } catch (error: unknown) {
            // Ignore errors from already closed controllers
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'ERR_INVALID_STATE'
            ) {
              continue
            }
            throw error
          }
        }
        watchQueue.length = 0
        db.close()
      },
      destroy: async () => {
        if (path !== MEMORY_PATH) {
          await unlink(path).catch(() => {})
        } else {
          statements.clear.run()
          await notifyWatchers()
        }
      },
      clear: async () => {
        statements.clear.run()
        await notifyWatchers()
      },
      get: async (keyHash: string, now: number) => {
        const result = statements.get.get(keyHash, now) as SqlRow | undefined
        if (!result) {
          return undefined
        }
        return {
          keyHash: result.key_hash,
          value: serializer.deserialize(result.value),
          versionstamp: result.versionstamp,
        }
      },
      set: async (key, value, versionstamp, expiresAt) => {
        const serialized = serializer.serialize(value)
        if (expiresAt) {
          statements.setWithExpiry.run(key, serialized, versionstamp, expiresAt)
        } else {
          statements.set.run(key, serialized, versionstamp)
        }
        await notifyWatchers()
      },
      delete: async (keyHash) => {
        statements.delete.run(keyHash)
        await notifyWatchers()
      },
      list: async (
        startHash,
        endHash,
        prefixHash,
        now,
        limit,
        reverse = false,
      ) => {
        return (
          (reverse
            ? statements.listReverse.all(
                startHash,
                endHash,
                prefixHash,
                now,
                limit,
              )
            : statements.list.all(
                startHash,
                endHash,
                prefixHash,
                now,
                limit,
              )) as SqlRow[]
        ).map((r) => ({
          keyHash: r.key_hash,
          value: serializer.deserialize(r.value),
          versionstamp: r.versionstamp,
        }))
      },
      cleanup: async (now) => {
        statements.cleanup.run(now)
        await notifyWatchers()
      },
      withTransaction: async <T>(callback: () => Promise<T>): Promise<T> => {
        return new Promise((resolve, reject) => {
          writeQueue.push(async () => {
            while (true) {
              try {
                db.exec('BEGIN IMMEDIATE TRANSACTION')
                const result = await callback()
                db.exec('COMMIT')
                await notifyWatchers()
                resolve(result)
                return
              } catch (error: unknown) {
                db.exec('ROLLBACK')
                // Check if the error is a SQLite busy error
                const sqliteError = error as SqliteError
                if (
                  sqliteError?.code === 'SQLITE_BUSY' ||
                  sqliteError?.message?.includes('database is locked')
                ) {
                  // Random backoff between 5-20ms
                  const backoff = 5 + Math.random() * 15

                  await setTimeout(backoff)
                  continue
                }
                reject(error)
                return
              }
            }
          })
          processWriteQueue()
        })
      },
      watch: (keyHashes: string[]) => {
        return new ReadableStream({
          start(controller) {
            watchQueue.push({ keyHashes, controller })
            // Send initial values
            const now = Date.now()
            Promise.all(
              keyHashes.map(async (keyHash) => {
                const result = statements.get.get(keyHash, now) as
                  | SqlRow
                  | undefined
                if (!result) {
                  return {
                    keyHash,
                    value: null,
                    versionstamp: null,
                  }
                }
                return {
                  keyHash: result.key_hash,
                  value: serializer.deserialize(result.value),
                  versionstamp: result.versionstamp,
                }
              }),
            ).then((results) => {
              controller.enqueue(results)
            })
          },
          cancel(controller) {
            const index = watchQueue.findIndex(
              (w) => w.controller === controller,
            )
            if (index !== -1) {
              watchQueue.splice(index, 1)
            }
            controller.close()
          },
        })
      },
    }
  },
)
