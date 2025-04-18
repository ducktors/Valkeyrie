/**
 * A 64-bit unsigned integer value.
 *
 * This class is used to represent 64-bit unsigned integers in the database.
 * It is used to ensure that the value is always a 64-bit unsigned integer.
 * It must be stored as a top-level value.
 */
export class KvU64 {
  readonly value: bigint

  constructor(value: bigint) {
    if (value < 0n) {
      throw new RangeError('Value must be non-negative')
    }
    if (value > 0xffffffffffffffffn) {
      throw new RangeError('Value must not exceed 64 bits')
    }
    this.value = value
  }

  valueOf(): bigint {
    return this.value
  }

  toString(): string {
    return this.value.toString()
  }
}
// biome-ignore lint/suspicious/noExplicitAny: --isolatedDeclarations doesn't support unique symbols and forces us to inject the prop on the prototype
;(KvU64 as any).prototype[Symbol.for('nodejs.util.inspect.custom')] =
  function () {
    return `[KvU64: ${this.value}n]`
  }
