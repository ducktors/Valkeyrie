import { deserialize, serialize } from 'node:v8'
import { KvU64 } from '../kv-u64.js'
import { type SerializedStruct, defineSerializer } from './serializer.js'

/**
 * Default serializer implementation using Node.js V8 serialization
 * Supported types: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
 * Array, ArrayBuffer, Buffer, DataView, Date, Map, Object objects: but only plain objects (e.g. from object literals), null, undefined, boolean, number, bigint, string, RegExp: but note that lastIndex is not preserved, Set, TypedArray
 */
export const v8Serializer = defineSerializer({
  serialize: (value: unknown): Uint8Array => {
    const isU64 = value instanceof KvU64 ? 1 : 0
    const serialized = serialize({
      value: isU64 ? (value as KvU64).value : value,
      isU64,
    } satisfies SerializedStruct)

    return serialized
  },

  deserialize: (value: Uint8Array): unknown => {
    const { value: deserialized, isU64 } = deserialize(
      value,
    ) as SerializedStruct

    if (isU64) {
      return new KvU64(deserialized as bigint)
    }
    return deserialized
  },
})
