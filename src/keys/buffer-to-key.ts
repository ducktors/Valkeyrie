import type { Key, KeyPart } from './key.js'

/**
 * Converts a buffer to a Key.
 * This method reverses the encoding process performed by keyToBuffer.
 * It handles the following formats:
 * - Uint8Array: 0x01 + bytes + 0x00
 * - String: 0x02 + utf8 bytes + 0x00
 * - BigInt: 0x03 + 8 bytes int64 + 0x00
 * - Number: 0x04 + 8 bytes double + 0x00
 * - Boolean: 0x05 + single byte + 0x00
 *
 * @param {Buffer} buffer - The buffer to convert.
 * @returns {Key} The decoded key parts array
 * @throws {Error} If the buffer format is invalid or contains an unknown type marker
 */
export function bufferToKey(buffer: Buffer): Key {
  const parts: KeyPart[] = []
  let pos = 0

  while (pos < buffer.length) {
    const typeMarker = buffer[pos] as number
    pos++

    switch (typeMarker) {
      case 0x01: {
        // Uint8Array
        let end = pos
        // Find the terminator (0x00) that marks the end of the Uint8Array
        // We need to scan for it rather than stopping at the first 0 value
        // since the Uint8Array itself might contain zeros
        while (end < buffer.length) {
          // Check if this position is the terminator
          if (buffer[end] === 0x00) {
            const nextPos = end + 1
            // Check if we're at the end of the buffer
            if (nextPos >= buffer.length) {
              break
            }

            // Check if the next byte is a valid type marker
            const nextByte = buffer[nextPos]
            if (
              nextByte === 0x01 ||
              nextByte === 0x02 ||
              nextByte === 0x03 ||
              nextByte === 0x04 ||
              nextByte === 0x05
            ) {
              break
            }
          }
          end++
        }

        if (end >= buffer.length)
          throw new Error('Invalid key hash: unterminated Uint8Array')
        const bytes = buffer.subarray(pos, end)
        parts.push(new Uint8Array(bytes))
        pos = end + 1
        break
      }
      case 0x02: {
        // String
        let end = pos
        while (end < buffer.length && buffer[end] !== 0x00) end++
        if (end >= buffer.length)
          throw new Error('Invalid key hash: unterminated String')
        const str = buffer.subarray(pos, end).toString('utf8')
        parts.push(str)
        pos = end + 1
        break
      }
      case 0x03: {
        // BigInt
        if (pos + 8 >= buffer.length)
          throw new Error('Invalid key hash: BigInt too short')
        if (buffer[pos + 8] !== 0x00)
          throw new Error('Invalid key hash: BigInt not terminated')
        const hex = buffer.subarray(pos, pos + 8).toString('hex')
        parts.push(BigInt(`0x${hex}`))
        pos += 9
        break
      }
      case 0x04: {
        // Number
        if (pos + 8 >= buffer.length)
          throw new Error('Invalid key hash: Number too short')
        if (buffer[pos + 8] !== 0x00)
          throw new Error('Invalid key hash: Number not terminated')
        const num = buffer.readDoubleBE(pos)
        parts.push(num)
        pos += 9
        break
      }
      case 0x05: {
        // Boolean
        if (pos >= buffer.length)
          throw new Error('Invalid key hash: Boolean too short')
        if (buffer[pos + 1] !== 0x00)
          throw new Error('Invalid key hash: Boolean not terminated')
        parts.push(buffer[pos] === 1)
        pos += 2
        break
      }
      default:
        throw new Error(
          `Invalid key hash: unknown type marker 0x${typeMarker.toString(16)}`,
        )
    }
  }

  return parts
}
