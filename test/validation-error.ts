import assert from 'node:assert'
import { describe, test } from 'node:test'
import { ValidationError } from '../src/validation-error.js'

describe('ValidationError', () => {
  describe('Basic Error Construction', () => {
    test('creates error with single issue', () => {
      const key = ['users', 'alice']
      const issues = [{ message: 'Invalid type' }]

      const error = new ValidationError(key, issues)

      assert.ok(error instanceof Error)
      assert.ok(error instanceof ValidationError)
      assert.strictEqual(error.name, 'ValidationError')
    })

    test('creates error with multiple issues', () => {
      const key = ['users', 'alice']
      const issues = [{ message: 'Invalid type' }, { message: 'Too short' }]

      const error = new ValidationError(key, issues)

      assert.ok(error instanceof ValidationError)
      assert.strictEqual(error.issues.length, 2)
    })

    test('sets correct error name', () => {
      const key = ['test']
      const issues = [{ message: 'Error' }]

      const error = new ValidationError(key, issues)

      assert.strictEqual(error.name, 'ValidationError')
    })

    test('sets correct key property', () => {
      const key = ['users', 'bob', 'profile']
      const issues = [{ message: 'Invalid data' }]

      const error = new ValidationError(key, issues)

      assert.deepStrictEqual(error.key, key)
    })

    test('sets correct issues property', () => {
      const key = ['test']
      const issues = [
        { message: 'Error 1', path: ['field'] },
        { message: 'Error 2' },
      ]

      const error = new ValidationError(key, issues)

      assert.deepStrictEqual(error.issues, issues)
    })
  })

  describe('Error Message Formatting', () => {
    test('formats single issue without path', () => {
      const key = ['users', 'alice']
      const issues = [{ message: 'Invalid type' }]

      const error = new ValidationError(key, issues)

      assert.strictEqual(
        error.message,
        'Validation failed for key [users, alice]:\n  - Invalid type',
      )
    })

    test('formats multiple issues without paths', () => {
      const key = ['users', 'alice']
      const issues = [
        { message: 'Invalid type' },
        { message: 'Too short' },
        { message: 'Missing required field' },
      ]

      const error = new ValidationError(key, issues)

      assert.strictEqual(
        error.message,
        'Validation failed for key [users, alice]:\n' +
          '  - Invalid type\n' +
          '  - Too short\n' +
          '  - Missing required field',
      )
    })

    test('formats single issue with path', () => {
      const key = ['users', 'alice']
      const issues = [{ message: 'Invalid email', path: ['email'] }]

      const error = new ValidationError(key, issues)

      assert.strictEqual(
        error.message,
        'Validation failed for key [users, alice]:\n  - Invalid email at path: email',
      )
    })

    test('formats issue with nested path', () => {
      const key = ['users', 'alice']
      const issues = [
        { message: 'Invalid value', path: ['profile', 'address', 'city'] },
      ]

      const error = new ValidationError(key, issues)

      assert.strictEqual(
        error.message,
        'Validation failed for key [users, alice]:\n  - Invalid value at path: profile.address.city',
      )
    })

    test('formats issues with mixed paths', () => {
      const key = ['users', 'alice']
      const issues = [
        { message: 'Invalid email', path: ['email'] },
        { message: 'Too short' },
        { message: 'Invalid age', path: ['age'] },
      ]

      const error = new ValidationError(key, issues)

      assert.strictEqual(
        error.message,
        'Validation failed for key [users, alice]:\n' +
          '  - Invalid email at path: email\n' +
          '  - Too short\n' +
          '  - Invalid age at path: age',
      )
    })
  })

  describe('Key Type Handling', () => {
    test('handles string keys', () => {
      const key = ['users', 'alice', 'profile']
      const issues = [{ message: 'Error' }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('[users, alice, profile]'))
    })

    test('handles number keys', () => {
      const key = ['items', 123, 456]
      const issues = [{ message: 'Error' }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('[items, 123, 456]'))
    })

    test('handles bigint keys', () => {
      const key = ['data', 9007199254740991n]
      const issues = [{ message: 'Error' }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('[data, 9007199254740991]'))
    })

    test('handles boolean keys', () => {
      const key = ['flags', true, false]
      const issues = [{ message: 'Error' }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('[flags, true, false]'))
    })

    test('handles Uint8Array keys', () => {
      const key = ['binary', new Uint8Array([1, 2, 3])]
      const issues = [{ message: 'Error' }]

      const error = new ValidationError(key, issues)

      // Uint8Array toString representation
      assert.ok(error.message.includes('binary'))
    })

    test('handles mixed type keys', () => {
      const key = ['data', 42, 'test', true, 123n]
      const issues = [{ message: 'Error' }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('[data, 42, test, true, 123]'))
    })

    test('handles empty key array', () => {
      const key: [] = []
      const issues = [{ message: 'Error' }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('[]'))
    })
  })

  describe('Path Formatting', () => {
    test('formats simple string path', () => {
      const key = ['users', 'alice']
      const issues = [{ message: 'Invalid', path: ['email'] }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('at path: email'))
    })

    test('formats simple numeric path', () => {
      const key = ['users', 'alice']
      const issues = [{ message: 'Invalid', path: [0] }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('at path: 0'))
    })

    test('formats nested path with mixed types', () => {
      const key = ['users', 'alice']
      const issues = [{ message: 'Invalid', path: ['items', 0, 'name'] }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('at path: items.0.name'))
    })

    test('formats deeply nested path', () => {
      const key = ['data']
      const issues = [
        {
          message: 'Invalid',
          path: ['a', 'b', 'c', 'd', 'e', 'f'],
        },
      ]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('at path: a.b.c.d.e.f'))
    })

    test('formats empty path array', () => {
      const key = ['users', 'alice']
      const issues = [{ message: 'Invalid', path: [] }]

      const error = new ValidationError(key, issues)

      // Empty path should be treated as no path
      assert.ok(error.message.includes('at path: '))
    })
  })

  describe('Edge Cases', () => {
    test('handles empty issues array', () => {
      const key = ['test']
      const issues: Array<{ message: string; path?: (string | number)[] }> = []

      const error = new ValidationError(key, issues)

      assert.strictEqual(error.message, 'Validation failed for key [test]:\n')
      assert.deepStrictEqual(error.issues, [])
    })

    test('handles issue with empty message', () => {
      const key = ['test']
      const issues = [{ message: '' }]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('  - '))
    })

    test('handles special characters in messages', () => {
      const key = ['test']
      const issues = [
        { message: 'Invalid: "value" must be <string>' },
        { message: "Can't be null or undefined" },
      ]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('Invalid: "value" must be <string>'))
      assert.ok(error.message.includes("Can't be null or undefined"))
    })

    test('handles very long path', () => {
      const key = ['test']
      const longPath = Array.from({ length: 50 }, (_, i) => `level${i}`)
      const issues = [{ message: 'Error', path: longPath }]

      const error = new ValidationError(key, issues)

      const expectedPath = longPath.join('.')
      assert.ok(error.message.includes(`at path: ${expectedPath}`))
    })

    test('handles special characters in path elements', () => {
      const key = ['test']
      const issues = [
        { message: 'Error', path: ['user-name', 'first_name', '$id'] },
      ]

      const error = new ValidationError(key, issues)

      assert.ok(error.message.includes('at path: user-name.first_name.$id'))
    })

    test('error is throwable and catchable', () => {
      const key = ['test']
      const issues = [{ message: 'Test error' }]

      assert.throws(
        () => {
          throw new ValidationError(key, issues)
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError)
          assert.strictEqual((error as ValidationError).name, 'ValidationError')
          return true
        },
      )
    })

    test('preserves stack trace', () => {
      const key = ['test']
      const issues = [{ message: 'Test error' }]

      const error = new ValidationError(key, issues)

      assert.ok(error.stack)
      assert.ok(error.stack.includes('ValidationError'))
    })
  })
})
