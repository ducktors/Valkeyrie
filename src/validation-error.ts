import type { Key } from './valkeyrie.ts'

/**
 * Error thrown when validation fails for a value.
 * Contains the key that failed validation and the validation issues.
 */
export class ValidationError extends Error {
  public readonly key: Key
  public readonly issues: Array<{ message: string; path?: (string | number)[] }>

  constructor(
    key: Key,
    issues: Array<{ message: string; path?: (string | number)[] }>,
  ) {
    const issueMessages = issues
      .map((issue) => {
        const pathStr = issue.path ? ` at path: ${issue.path.join('.')}` : ''
        return `  - ${issue.message}${pathStr}`
      })
      .join('\n')

    super(`Validation failed for key [${key.join(', ')}]:\n${issueMessages}`)
    this.name = 'ValidationError'
    this.key = key
    this.issues = issues
  }
}
