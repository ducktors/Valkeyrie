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

interface SqliteError extends Error {
  code?: string
  message: string
}

// Process-local transaction mutex to prevent concurrent transactions within same process
let transactionMutex: Promise<void> = Promise.resolve()

const MEMORY_PATH = ':memory:'

export const sqliteDriver = defineDriver(
  async (path = MEMORY_PATH, customSerializer?: () => Serializer) => {
    const db = new DatabaseSync(path)

    db.exec(`
    PRAGMA synchronous = NORMAL;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
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
          await Promise.allSettled([
            unlink(path),
            unlink(`${path}-shm`),
            unlink(`${path}-wal`),
          ])
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
        // Use process-level mutex to prevent concurrent transactions within same process
        const currentMutex = transactionMutex
        let resolveMutex: () => void = () => {}
        transactionMutex = new Promise((resolve) => {
          resolveMutex = resolve
        })

        try {
          await currentMutex

          // Implement exponential backoff for cross-process lock contention
          let attempt = 0
          const maxAttempts = 10
          const baseDelay = 5 // ms

          while (attempt < maxAttempts) {
            try {
              // Use IMMEDIATE transaction to acquire exclusive lock immediately
              // This provides cross-process coordination
              db.exec('BEGIN IMMEDIATE TRANSACTION')

              try {
                const result = await callback()
                db.exec('COMMIT')
                await notifyWatchers()
                return result
              } catch (callbackError) {
                db.exec('ROLLBACK')
                throw callbackError
              }
            } catch (error: unknown) {
              const sqliteError = error as SqliteError

              // Check if the error is a SQLite busy/locked error that should trigger retry
              if (
                sqliteError?.code === 'SQLITE_BUSY' ||
                sqliteError?.code === 'SQLITE_LOCKED' ||
                sqliteError?.code === 'SQLITE_BUSY_RECOVERY' ||
                sqliteError?.code === 'SQLITE_BUSY_SNAPSHOT' ||
                sqliteError?.message?.includes('database is locked') ||
                sqliteError?.message?.includes('database is busy') ||
                sqliteError?.message?.includes('database table is locked') ||
                sqliteError?.message?.includes('SQLITE_BUSY')
              ) {
                attempt++

                if (attempt >= maxAttempts) {
                  throw new Error(
                    `Transaction failed after ${maxAttempts} attempts due to database contention`,
                  )
                }

                // Exponential backoff with jitter for cross-process coordination
                const delay = baseDelay * 2 ** attempt + Math.random() * 5
                await setTimeout(delay)
                continue
              }

              // If it's not a lock contention error, throw immediately
              throw error
            }
          }

          throw new Error('Transaction failed: max attempts exceeded')
        } finally {
          resolveMutex()
        }
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
