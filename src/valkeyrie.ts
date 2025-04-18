import type { Mutation } from './atomic-operation.js'
import type { Check } from './atomic-operation.js'
import { AtomicOperation } from './atomic-operation.js'
import type { Driver } from './driver.js'
import { bufferToKey } from './keys/buffer-to-key.js'
import { keyToBuffer } from './keys/key-to-buffer.js'
import type { Key } from './keys/key.js'
import { validateKeys } from './keys/validate-keys.js'
import { KvU64 } from './kv-u64.js'
import type { Serializer } from './serializers/serializer.js'
import { sqliteDriver } from './sqlite-driver.js'

let lastVersionstamp = 0n
/**
 * Generates a unique versionstamp for each operation.
 * This method ensures that each versionstamp is monotonically increasing,
 * even within the same microsecond, by using the current timestamp in microseconds
 * and incrementing the last used versionstamp if it's not greater than the current timestamp.
 * The generated versionstamp is a hexadecimal string representation of the BigInt value.
 *
 * @returns A string representing the generated versionstamp.
 */
function generateVersionstamp(): string {
  // Get current timestamp in microseconds
  const now = BigInt(Date.now()) * 1000n

  // Ensure monotonically increasing values even within the same microsecond
  lastVersionstamp = lastVersionstamp < now ? now : lastVersionstamp + 1n

  // Convert the BigInt to a hexadecimal string and pad it to 20 characters
  return lastVersionstamp.toString(16).padStart(20, '0')
}

type ListSelector =
  | { prefix: Key }
  | { prefix: Key; start: Key }
  | { prefix: Key; end: Key }
  | { start: Key; end: Key }

interface ListOptions {
  limit?: number
  cursor?: string
  reverse?: boolean
  consistency?: 'strong' | 'eventual'
  batchSize?: number
}

export interface SetOptions {
  expireIn?: number
}

interface Entry<T = unknown> {
  key: Key
  value: T
  versionstamp: string
}
export type EntryMaybe<T = unknown> =
  | Entry<T>
  | {
      key: Key
      value: null
      versionstamp: null
    }

const valkeyrieSymbol = Symbol('kValkeyrie')
const commitVersionstampSymbol = Symbol('kValkeyrieCommitVersionstamp')
export class Valkeyrie {
  #driver: Driver
  #isClosed = false
  #destroyOnClose = false

  /**
   * We don't want to allow users to construct their own Valkeyrie instances directly.
   * This is an internal constructor that is used by the open() method. To ensure that is only called by the open() method, we check the private kValkeyrie symbol.
   */
  private constructor(
    functions: Driver,
    options: { destroyOnClose: boolean },
    symbol?: symbol,
  ) {
    if (valkeyrieSymbol !== symbol) {
      throw new TypeError(
        'Valkeyrie can not be constructed: use Valkeyrie.open() to create a new instance',
      )
    }
    this.#driver = functions
    this.#destroyOnClose = options.destroyOnClose
  }

  /**
   * Opens a new Valkeyrie database instance
   * @param path Optional path to the database file (defaults to in-memory)
   * @param options Optional configuration options
   * @returns A new Valkeyrie instance
   */
  public static async open(
    path?: string,
    options: {
      serializer?: () => Serializer
      destroyOnClose?: boolean
    } = {},
  ): Promise<Valkeyrie> {
    const destroyOnClose = options.destroyOnClose ?? false

    const db = new Valkeyrie(
      await sqliteDriver(path, options.serializer),
      { destroyOnClose },
      valkeyrieSymbol,
    )

    await db.cleanup()

    return db
  }

  /**
   * Closes the Valkeyrie database instance.
   * This method is automatically called when valkeyrie is used with '(await) using' keyword.
   */
  public async close(): Promise<void> {
    if (this.#destroyOnClose) {
      await this.destroy()
    }
    await this.#driver.close()
    this.#isClosed = true
  }

  /**
   * This method is automatically called when valkeyrie is used with 'using' keyword.
   * It ensures that the instance is automatically closed when it goes out of the declaration scope.
   * It is recommended to use 'await using' instead of 'using' if error handling is needed.
   * @example
   * ```ts
   * using db = await Valkeyrie.open('path/to/db.sqlite')
   * ```
   */
  [Symbol.dispose](): void {
    this.close().catch(() => {})
  }

  /**
   * This method is automatically called when valkeyrie is used with 'await using' keywords.
   * It ensures that the instance is automatically closed when it goes out of the declaration scope.
   *
   * @example
   * ```ts
   * await using db = await Valkeyrie.open('path/to/db.sqlite')
   * ```
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private throwIfClosed(): void {
    if (this.#isClosed) {
      throw new Error('Database is closed')
    }
  }

  /**
   * Cleans up the database by removing expired entries.
   */
  public async cleanup(): Promise<void> {
    this.throwIfClosed()
    const now = Date.now()
    this.#driver.cleanup(now)
  }

  commitVersionstamp(): symbol {
    return commitVersionstampSymbol
  }

  /**
   * Clears all data from the database but keeps the database itself.
   * This operation cannot be undone and will result in permanent data loss.
   * @returns A promise that resolves when the database has been cleared
   */
  public async clear(): Promise<void> {
    await this.#driver.clear()
  }

  /**
   * Destroys the database.
   * This operation cannot be undone and will result in permanent data loss.
   * @returns A promise that resolves when the database has been destroyed
   */
  public async destroy(): Promise<void> {
    await this.#driver.destroy()
  }

  /**
   * Hashes a key.
   *
   * @param {Key} key - The key to hash.
   * @returns {string} - The hex string representation of the hashed key.
   */
  private encodeKey(key: Key, operation?: 'write' | 'read'): string {
    const fullKey = keyToBuffer(key)
    if (fullKey.length > 2048) {
      throw new TypeError(
        `Key too large for ${operation} (max ${
          operation === 'write' ? 2048 : 2049
        } bytes)`,
      )
    }
    return fullKey.toString('hex')
  }
  /**
   * Decodes a base64-encoded key hash back into its original key parts.
   * This method reverses the encoding process performed by hashKey.
   * It handles the following formats:
   * - Uint8Array: 0x01 + bytes + 0x00
   * - String: 0x02 + utf8 bytes + 0x00
   * - BigInt: 0x03 + 8 bytes int64 + 0x00
   * - Number: 0x04 + 8 bytes double + 0x00
   * - Boolean: 0x05 + single byte + 0x00
   *
   * @param {string} hash - The base64-encoded key hash to decode
   * @returns {Key} The decoded key parts array
   * @throws {Error} If the hash format is invalid or contains an unknown type marker
   */
  private decodeKey(hash: string): Key {
    const buffer = Buffer.from(hash, 'hex')
    return bufferToKey(buffer)
  }

  /**
   * Hashes a key and returns a base64-encoded string.
   *
   * @param {Key} key - The key to get the cursor from.
   * @returns {string} - The base64 string representation of the hashed key.
   */
  private getCursorFromKey(key: Key): string {
    return keyToBuffer(key).toString('base64').replace(/=+$/, '')
  }

  public async get<T = unknown>(key: Key): Promise<EntryMaybe<T>> {
    this.throwIfClosed()
    validateKeys([key])
    if (key.length === 0) {
      throw new Error('Key cannot be empty')
    }
    const keyHash = this.encodeKey(key, 'read')
    const now = Date.now()
    const result = await this.#driver.get(keyHash, now)

    if (!result) {
      return { key, value: null, versionstamp: null }
    }

    return {
      key: this.decodeKey(result.keyHash),
      value: result.value as T,
      versionstamp: result.versionstamp,
    }
  }

  public async getMany<T = unknown>(keys: Key[]): Promise<EntryMaybe<T>[]> {
    this.throwIfClosed()
    validateKeys(keys)
    if (keys.length > 10) {
      throw new TypeError('Too many ranges (max 10)')
    }
    return Promise.all(keys.map((key) => this.get<T>(key)))
  }

  public async set<T = unknown>(
    key: Key,
    value: T,
    options: SetOptions = {},
  ): Promise<{ ok: true; versionstamp: string }> {
    this.throwIfClosed()
    validateKeys([key])
    if (key.length === 0) {
      throw new Error('Key cannot be empty')
    }
    const keyHash = this.encodeKey(key, 'write')
    const versionstamp = generateVersionstamp()

    await this.#driver.set(
      keyHash,
      value,
      versionstamp,
      options.expireIn ? Date.now() + options.expireIn : undefined,
    )

    return { ok: true, versionstamp }
  }

  public async delete(key: Key): Promise<void> {
    this.throwIfClosed()
    validateKeys([key])
    const keyHash = this.encodeKey(key)
    await this.#driver.delete(keyHash)
  }

  private validatePrefixKey(
    prefix: Key,
    key: Key,
    type: 'start' | 'end',
  ): void {
    if (key.length <= prefix.length) {
      throw new TypeError(
        `${
          type.charAt(0).toUpperCase() + type.slice(1)
        } key is not in the keyspace defined by prefix`,
      )
    }
    // Check if key has the same prefix
    const keyPrefix = key.slice(0, prefix.length)
    if (!keyPrefix.every((part, i) => part === prefix[i])) {
      throw new TypeError(
        `${
          type.charAt(0).toUpperCase() + type.slice(1)
        } key is not in the keyspace defined by prefix`,
      )
    }
  }

  private decodeCursorValue(cursor: string): string {
    const bytes = Buffer.from(cursor, 'base64')
    // Skip type marker (0x02) and get the value bytes (excluding terminator 0x00)
    return bytes.subarray(1, bytes.length - 1).toString('utf8')
  }

  private calculatePrefixBounds(
    prefix: Key,
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string } {
    const prefixHash = this.encodeKey(prefix)

    if (cursor) {
      const cursorValue = this.decodeCursorValue(cursor)
      const cursorKey = [...prefix, cursorValue]
      const cursorHash = this.encodeKey(cursorKey)

      return reverse
        ? { startHash: prefixHash, endHash: cursorHash }
        : { startHash: `${cursorHash}\0`, endHash: `${prefixHash}\xff` }
    }

    return {
      startHash: prefixHash,
      endHash: `${prefixHash}\xff`,
    }
  }

  private calculateRangeBounds(
    start: Key,
    end: Key,
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string } {
    // Compare start and end keys
    const startHash = this.encodeKey(start)
    const endHash = this.encodeKey(end)
    if (startHash > endHash) {
      throw new TypeError('Start key is greater than end key')
    }

    if (cursor) {
      const cursorValue = this.decodeCursorValue(cursor)
      // For range queries, we need to reconstruct the full key
      // by taking all parts from the start key except the last one
      // and appending the cursor value
      const cursorKey = [...start.slice(0, -1), cursorValue]
      const cursorHash = this.encodeKey(cursorKey)

      return reverse
        ? { startHash, endHash: cursorHash }
        : { startHash: `${cursorHash}\0`, endHash }
    }

    return { startHash, endHash }
  }

  private calculateEmptyPrefixBounds(
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string } {
    if (cursor) {
      // Attempt to decode the cursor to get the actual key part
      const cursorValue = this.decodeCursorValue(cursor)
      // Create a key hash from the cursor value
      const cursorHash = this.encodeKey([cursorValue])

      return reverse
        ? { startHash: '', endHash: cursorHash }
        : { startHash: `${cursorHash}\0`, endHash: '\uffff' }
    }

    return {
      startHash: '',
      endHash: '\uffff',
    }
  }

  private isPrefixWithStart(
    selector: ListSelector,
  ): selector is { prefix: Key; start: Key } {
    return 'prefix' in selector && 'start' in selector
  }

  private isPrefixWithEnd(
    selector: ListSelector,
  ): selector is { prefix: Key; end: Key } {
    return 'prefix' in selector && 'end' in selector
  }

  private isRangeSelector(
    selector: ListSelector,
  ): selector is { start: Key; end: Key } {
    return 'start' in selector && 'end' in selector
  }

  private validateSelector(selector: ListSelector): void {
    // Cannot have prefix + start + end together
    if ('prefix' in selector && 'start' in selector && 'end' in selector) {
      throw new TypeError('Cannot specify prefix with both start and end keys')
    }

    // Cannot have start without end (unless with prefix)
    if (
      !('prefix' in selector) &&
      'start' in selector &&
      !('end' in selector)
    ) {
      throw new TypeError('Cannot specify start key without prefix')
    }

    // Cannot have end without start (unless with prefix)
    if (
      !('prefix' in selector) &&
      !('start' in selector) &&
      'end' in selector
    ) {
      throw new TypeError('Cannot specify end key without prefix')
    }

    // Validate prefix constraints
    if ('prefix' in selector) {
      if ('start' in selector) {
        this.validatePrefixKey(selector.prefix, selector.start, 'start')
      }
      if ('end' in selector) {
        this.validatePrefixKey(selector.prefix, selector.end, 'end')
      }
    }
  }

  private getBoundsForPrefix(
    prefix: Key,
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string; prefixHash: string } {
    if (prefix.length === 0) {
      const bounds = this.calculateEmptyPrefixBounds(cursor, reverse)
      return { ...bounds, prefixHash: '' }
    }

    const prefixHash = this.encodeKey(prefix)
    const bounds = this.calculatePrefixBounds(prefix, cursor, reverse)
    return { ...bounds, prefixHash }
  }

  private getBoundsForPrefixWithRange(
    prefix: Key,
    start: Key,
    end: Key,
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string; prefixHash: string } {
    const prefixHash = this.encodeKey(prefix)
    const bounds = this.calculateRangeBounds(start, end, cursor, reverse)
    return { ...bounds, prefixHash }
  }

  public list<T = unknown>(
    selector: ListSelector,
    options: ListOptions = {},
  ): AsyncIterableIterator<Entry<T>, void> & {
    readonly cursor: string
    [Symbol.asyncDispose](): Promise<void>
  } {
    this.throwIfClosed()
    this.validateSelector(selector)

    const {
      limit = Number.POSITIVE_INFINITY,
      reverse = false,
      batchSize = 500,
      cursor,
    } = options
    let bounds: { startHash: string; endHash: string; prefixHash: string }

    if (this.isRangeSelector(selector)) {
      bounds = this.getBoundsForPrefixWithRange(
        [],
        selector.start,
        selector.end,
        cursor,
        reverse,
      )
    } else if ('prefix' in selector) {
      if (this.isPrefixWithStart(selector)) {
        bounds = this.getBoundsForPrefixWithRange(
          selector.prefix,
          selector.start,
          [...selector.prefix, '\xff'],
          cursor,
          reverse,
        )
      } else if (this.isPrefixWithEnd(selector)) {
        bounds = this.getBoundsForPrefixWithRange(
          selector.prefix,
          selector.prefix,
          selector.end,
          cursor,
          reverse,
        )
      } else {
        bounds = this.getBoundsForPrefix(selector.prefix, cursor, reverse)
      }
    } else {
      throw new TypeError(
        'Invalid selector: must specify either prefix or start/end range',
      )
    }

    const generator = this.listBatch<T>(
      bounds.startHash,
      bounds.endHash,
      bounds.prefixHash,
      { limit, batchSize, reverse },
    )

    let lastKey: Key | null = null
    const self = this

    const wrapper = {
      [Symbol.asyncIterator]() {
        return this
      },
      async next() {
        const result = await generator.next()
        if (!result.done && result.value) {
          lastKey = result.value.key
        }
        return result
      },
      get cursor() {
        if (!lastKey) return ''
        const lastPart = lastKey[lastKey.length - 1]
        if (!lastPart) return ''
        return self.getCursorFromKey([lastPart])
      },
      async [Symbol.asyncDispose]() {
        await self.close()
      },
    }

    return wrapper
  }

  private async *listBatch<T>(
    startHash: string,
    endHash: string,
    prefixHash: string,
    options: {
      limit: number
      batchSize: number
      reverse: boolean
    },
  ): AsyncIterableIterator<Entry<T>, void> {
    const { limit, batchSize, reverse } = options
    if (batchSize > 1000) {
      throw new TypeError('Too many entries (max 1000)')
    }
    const now = Date.now()
    let remainingLimit = limit
    let currentStartHash = startHash
    let currentEndHash = endHash

    // Continue fetching as long as we have a limit remaining or limit is Infinity
    while (remainingLimit > 0 || limit === Number.POSITIVE_INFINITY) {
      // If limit is Infinity, use batchSize, otherwise use the minimum of batchSize and remainingLimit
      const currentBatchSize =
        limit === Number.POSITIVE_INFINITY
          ? batchSize
          : Math.min(batchSize, remainingLimit)
      const results = await this.#driver.list(
        currentStartHash,
        currentEndHash,
        prefixHash,
        now,
        currentBatchSize,
        reverse,
      )
      if (results.length === 0) break

      for (const result of results) {
        yield {
          key: this.decodeKey(result.keyHash),
          value: result.value as T,
          versionstamp: result.versionstamp,
        }
      }

      if (results.length < currentBatchSize) break

      // Only decrement remainingLimit if it's not Infinity
      if (limit !== Number.POSITIVE_INFINITY) {
        remainingLimit -= results.length
      }

      // Update hash bounds for next batch
      const lastResult = results[results.length - 1]
      if (!lastResult) break
      const lastKeyHash = lastResult.keyHash
      if (reverse) {
        currentEndHash = lastKeyHash
      } else {
        currentStartHash = `${lastKeyHash}\0` // Use next possible hash value
      }
    }
  }

  public atomic(): AtomicOperation {
    this.throwIfClosed()
    return new AtomicOperation(this)
  }

  public async executeAtomicOperation(
    checks: Check[],
    mutations: Mutation[],
  ): Promise<{ ok: true; versionstamp: string } | { ok: false }> {
    this.throwIfClosed()
    const versionstamp = generateVersionstamp()

    try {
      return await this.#driver.withTransaction(async () => {
        // Verify all checks pass within the transaction
        for (const check of checks) {
          const result = await this.get(check.key)
          if (result.versionstamp !== check.versionstamp) {
            return { ok: false }
          }
        }

        // Apply mutations - all using the same versionstamp
        for (const mutation of mutations) {
          const keyHash = this.encodeKey(mutation.key)

          if (mutation.type === 'delete') {
            await this.#driver.delete(keyHash)
          } else if (mutation.type === 'set') {
            const serializedValue = mutation.value

            if (mutation.expireIn) {
              const expiresAt = Date.now() + mutation.expireIn
              await this.#driver.set(
                keyHash,
                serializedValue,
                versionstamp,
                expiresAt,
              )
            } else {
              await this.#driver.set(keyHash, serializedValue, versionstamp)
            }
          } else if (
            mutation.type === 'sum' ||
            mutation.type === 'max' ||
            mutation.type === 'min'
          ) {
            const currentValue = await this.get(mutation.key)
            let newValue: KvU64

            if (currentValue.value === null) {
              newValue = mutation.value
            } else if (!(currentValue.value instanceof KvU64)) {
              throw new TypeError(
                `Failed to perform '${mutation.type}' mutation on a non-U64 value in the database`,
              )
            } else {
              const current = currentValue.value.value
              if (mutation.type === 'sum') {
                newValue = new KvU64(
                  (current + mutation.value.value) & 0xffffffffffffffffn,
                )
              } else if (mutation.type === 'max') {
                newValue = new KvU64(
                  current > mutation.value.value
                    ? current
                    : mutation.value.value,
                )
              } else {
                newValue = new KvU64(
                  current < mutation.value.value
                    ? current
                    : mutation.value.value,
                )
              }
            }

            await this.#driver.set(keyHash, newValue, versionstamp)
          }
        }

        return { ok: true, versionstamp }
      })
    } catch (error) {
      if (error instanceof TypeError) {
        throw error
      }
      /* c8 ignore start */
      return { ok: false }
    } /* c8 ignore end */
  }

  public watch<T extends readonly unknown[]>(
    keys: Key[],
  ): ReadableStream<EntryMaybe<T[number]>[]> {
    this.throwIfClosed()
    validateKeys(keys)
    if (keys.length === 0) {
      throw new Error('Keys cannot be empty')
    }
    const keyHashes = keys.map((key) => this.encodeKey(key))
    return this.#driver.watch(keyHashes).pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          controller.enqueue(
            chunk.map((entry) => ({
              key: this.decodeKey(entry.keyHash),
              value: entry.value as T[number],
              versionstamp: entry.versionstamp as string,
            })),
          )
        },
      }),
    )
  }
}
