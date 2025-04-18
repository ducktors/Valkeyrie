import type { Key } from './key.js'

/**
 * Validates that the provided keys are arrays.
 *
 * @param keys - The keys to validate.
 * @throws {TypeError} If any key is not an array.
 */
export function validateKeys(keys: unknown[]): asserts keys is Key[] {
  for (const key of keys) {
    if (!Array.isArray(key)) {
      throw new TypeError('Key must be an array')
    }
  }
}
