import { serialize } from 'node:v8'
import type { Key } from './keys/key.js'
import { validateKeys } from './keys/validate-keys.js'
import { KvU64 } from './kv-u64.js'
import type { SetOptions, Valkeyrie } from './valkeyrie.js'

interface AtomicCheck {
  key: Key
  versionstamp: string | null
}

export interface Check {
  key: Key
  versionstamp: string | null
}

export type Mutation<T = unknown> = { key: Key } & (
  | { type: 'set'; value: T; expireIn?: number }
  | { type: 'delete' }
  | { type: 'sum'; value: KvU64 }
  | { type: 'max'; value: KvU64 }
  | { type: 'min'; value: KvU64 }
)

/**
 * AtomicOperation is a class that allows you to perform atomic operations on a Valkeyrie database.
 * It is used to ensure that all operations are performed in a single transaction.
 *
 * It is not exported from the module. To use it, you must call `valkeyrieInstance.atomic()`.
 */
export class AtomicOperation {
  private checks: Check[] = []
  private mutations: Mutation[] = []
  private vk: Valkeyrie
  private totalMutationSize = 0
  private totalKeySize = 0

  constructor(valkeyrie: Valkeyrie) {
    this.vk = valkeyrie
  }

  private validateVersionstamp(versionstamp: string | null): void {
    if (versionstamp === null) return
    if (typeof versionstamp !== 'string') {
      throw new TypeError('Versionstamp must be a string or null')
    }
    if (versionstamp.length !== 20) {
      throw new TypeError('Versionstamp must be 20 characters long')
    }
    if (!/^[0-9a-f]{20}$/.test(versionstamp)) {
      throw new TypeError('Versionstamp must be a hex string')
    }
  }

  check(...checks: AtomicCheck[]): AtomicOperation {
    for (const check of checks) {
      if (this.checks.length >= 100) {
        throw new TypeError('Too many checks (max 100)')
      }
      validateKeys([check.key])
      this.validateVersionstamp(check.versionstamp)
      this.checks.push(check)
    }
    return this
  }

  mutate(...mutations: Mutation[]): AtomicOperation {
    for (const mutation of mutations) {
      if (this.mutations.length >= 1000) {
        throw new TypeError('Too many mutations (max 1000)')
      }
      validateKeys([mutation.key])
      if (mutation.key.length === 0) {
        throw new Error('Key cannot be empty')
      }

      const keySize = serialize(mutation.key).length
      this.totalKeySize += keySize

      // Track mutation size without validation
      let mutationSize = keySize
      if ('value' in mutation) {
        if (
          mutation.type === 'sum' ||
          mutation.type === 'max' ||
          mutation.type === 'min'
        ) {
          mutationSize += 8 // 64-bit integer size
        } else {
          mutationSize += serialize(mutation.value).length
        }
      }
      this.totalMutationSize += mutationSize

      // Validate mutation type and required fields
      switch (mutation.type) {
        case 'set':
          if (!('value' in mutation)) {
            throw new TypeError('Set mutation requires a value')
          }
          break
        case 'delete':
          if ('value' in mutation) {
            throw new TypeError('Delete mutation cannot have a value')
          }
          break
        case 'sum':
          if (!('value' in mutation) || !(mutation.value instanceof KvU64)) {
            throw new TypeError('Cannot sum KvU64 with Number')
          }
          break
        case 'max':
        case 'min':
          if (!('value' in mutation) || !(mutation.value instanceof KvU64)) {
            throw new TypeError(
              `Failed to perform '${mutation.type}' mutation on a non-U64 operand`,
            )
          }
          break
        default:
          throw new TypeError('Invalid mutation type')
      }

      this.mutations.push(mutation)
    }
    return this
  }

  set<T = unknown>(
    key: Key,
    value: T,
    options: SetOptions = {},
  ): AtomicOperation {
    return this.mutate({
      type: 'set',
      key,
      value,
      ...(options.expireIn ? { expireIn: options.expireIn } : {}),
    })
  }

  delete(key: Key): AtomicOperation {
    return this.mutate({ type: 'delete', key })
  }

  sum(key: Key, value: bigint | KvU64): AtomicOperation {
    const u64Value = value instanceof KvU64 ? value : new KvU64(BigInt(value))
    return this.mutate({ type: 'sum', key, value: u64Value })
  }

  max(key: Key, value: bigint | KvU64): AtomicOperation {
    const u64Value = value instanceof KvU64 ? value : new KvU64(BigInt(value))
    return this.mutate({ type: 'max', key, value: u64Value })
  }

  min(key: Key, value: bigint | KvU64): AtomicOperation {
    const u64Value = value instanceof KvU64 ? value : new KvU64(BigInt(value))
    return this.mutate({ type: 'min', key, value: u64Value })
  }

  async commit(): Promise<{ ok: true; versionstamp: string } | { ok: false }> {
    // Validate total sizes before executing the atomic operation
    if (this.totalKeySize > 81920) {
      throw new TypeError('Total key size too large (max 81920 bytes)')
    }
    if (this.totalMutationSize > 819200) {
      throw new TypeError('Total mutation size too large (max 819200 bytes)')
    }
    return this.vk.executeAtomicOperation(this.checks, this.mutations)
  }
}
