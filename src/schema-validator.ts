import type { SchemaRegistry } from './schema-registry.js'
import { ValidationError } from './validation-error.js'
import type { Key } from './valkeyrie.js'

/**
 * Validates a value against a schema found in the registry for the given key.
 * Returns the validated/transformed value if validation succeeds.
 * Throws ValidationError if validation fails.
 * Returns the original value if no schema is found (permissive mode).
 *
 * @param key The key to match against registered schemas
 * @param value The value to validate
 * @param schemaRegistry The registry containing schema patterns
 * @returns The validated/transformed value
 * @throws ValidationError if validation fails
 */
export async function validateValue<T>(
  key: Key,
  value: T,
  schemaRegistry: SchemaRegistry | undefined,
): Promise<T> {
  // No schema registry means no validation (backward compatibility)
  if (!schemaRegistry) {
    return value
  }

  // Get matching schema for the key
  const schema = schemaRegistry.getSchema(key)

  // No matching schema means no validation (permissive mode)
  if (!schema) {
    return value
  }

  // Perform validation using standard-schema
  try {
    const result = await schema['~standard'].validate(value)

    // Check if validation failed (has issues)
    if (result.issues) {
      // Convert standard-schema issues to our ValidationError format
      const issues = result.issues.map((issue) => {
        const issueData: { message: string; path?: (string | number)[] } = {
          message: issue.message ?? 'Validation failed',
        }
        if (issue.path) {
          issueData.path = issue.path as (string | number)[]
        }
        return issueData
      })

      throw new ValidationError(key, issues)
    }

    // Return the validated value (may be transformed by the schema)
    return result.value as T
  } catch (error) {
    // Re-throw ValidationError as-is
    if (error instanceof ValidationError) {
      throw error
    }

    // Wrap any other error in ValidationError
    throw new ValidationError(key, [
      {
        message: error instanceof Error ? error.message : 'Validation failed',
      },
    ])
  }
}

/**
 * Validates that a key does not contain '*' as a key part.
 * The '*' character is reserved for wildcard patterns in schema registration.
 *
 * @param key The key to validate
 * @throws TypeError if the key contains '*'
 */
export function validateReservedKeyParts(key: Key): void {
  for (const part of key) {
    if (part === '*') {
      throw new TypeError(
        "Key part '*' is reserved for schema pattern wildcards and cannot be used as an actual key",
      )
    }
  }
}
