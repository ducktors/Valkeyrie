import type { Key } from './key.js'

/**
 * Generates a buffer for a given key. This method is crucial for indexing and storing keys in the database.
 * It converts each part of the key into a specific byte format based on its type, following Deno.KV's encoding format.
 * The format for each type is as follows:
 * - Uint8Array: 0x01 + bytes + 0x00
 * - String: 0x02 + utf8 bytes + 0x00
 * - BigInt: 0x03 + 8 bytes int64 + 0x00
 * - Number: 0x04 + 8 bytes double + 0x00
 * - Boolean: 0x05 + single byte + 0x00
 *
 * After converting each part, they are concatenated with a null byte delimiter to form the full key.
 * This method ensures that keys are consistently formatted and can be reliably hashed for storage and retrieval.
 * Note that key ordering is determined by a lexicographical comparison of their parts, with the first part being the most significant and the last part being the least significant. Additionally, key comparisons are case sensitive.
 *
 * @param {Key} key - The key to be hashed.
 * @returns {Buffer} - The buffer representation of the key.
 */
export function keyToBuffer(key: Key): Buffer<ArrayBuffer> {
  const parts = key.map((part) => {
    let bytes: Buffer

    if (part instanceof Uint8Array) {
      // Uint8Array format: 0x01 + bytes + 0x00
      bytes = Buffer.alloc(part.length + 2)
      bytes[0] = 0x01 // Uint8Array type marker
      Buffer.from(part).copy(bytes, 1)
      bytes[bytes.length - 1] = 0x00
    } else if (typeof part === 'string') {
      // String format: 0x02 + utf8 bytes + 0x00
      const strBytes = Buffer.from(part, 'utf8')
      bytes = Buffer.alloc(strBytes.length + 2)
      bytes[0] = 0x02 // String type marker
      strBytes.copy(bytes, 1)
      bytes[bytes.length - 1] = 0x00
    } else if (typeof part === 'bigint') {
      // Bigint format: 0x03 + 8 bytes int64 + 0x00
      bytes = Buffer.alloc(10)
      bytes[0] = 0x03 // Bigint type marker
      const hex = part.toString(16).padStart(16, '0')
      Buffer.from(hex, 'hex').copy(bytes, 1)
      bytes[bytes.length - 1] = 0x00
    } else if (typeof part === 'number') {
      // Number format: 0x04 + 8 bytes double + 0x00
      bytes = Buffer.alloc(10)
      bytes[0] = 0x04 // Number type marker
      bytes.writeDoubleBE(part, 1)
      bytes[bytes.length - 1] = 0x00
    } else if (typeof part === 'boolean') {
      // Boolean format: 0x05 + single byte + 0x00
      bytes = Buffer.alloc(3)
      bytes[0] = 0x05 // Boolean type marker
      bytes[1] = part ? 1 : 0
      bytes[bytes.length - 1] = 0x00
    } else {
      throw new Error(`Unsupported key part type: ${typeof part}`)
    }

    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  })

  // Join all parts with a null byte delimiter
  return Buffer.concat([...parts])
}
