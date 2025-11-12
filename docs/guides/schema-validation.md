# Schema Validation

Valkeyrie supports runtime schema validation using [Standard Schema](https://github.com/standard-schema/standard-schema), enabling compatibility with popular validation libraries like Zod, Valibot, and ArkType. This feature provides type-safe data validation at write-time and automatic TypeScript type inference for read operations.

## Table of Contents

- [Why Schema Validation?](#why-schema-validation)
- [Quick Start](#quick-start)
- [Type Inference](#type-inference)
- [Supported Libraries](#supported-libraries)
- [Pattern Matching](#pattern-matching)
- [Multiple Schemas](#multiple-schemas)
- [Validation Timing](#validation-timing)
- [Error Handling](#error-handling)
- [Schema Transformations](#schema-transformations)
- [Factory Methods with Schemas](#factory-methods-with-schemas)
- [Best Practices](#best-practices)
- [Advanced Usage](#advanced-usage)

## Why Schema Validation?

Schema validation helps you:

- **Catch errors early** - Validate data before it's persisted
- **Maintain data consistency** - Ensure all data matches expected structure
- **Get type safety** - Automatic TypeScript type inference from schemas
- **Document your data** - Schemas serve as documentation
- **Prevent bugs** - Invalid data is rejected before causing problems

## Quick Start

Here's a simple example using Zod:

```typescript
import { Valkeyrie } from 'valkeyrie';
import { z } from 'zod';

// Define your schema
const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0)
});

// Register the schema for a key pattern
const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .open();

// ✅ Valid data - accepted
await db.set(['users', 'alice'], {
  name: 'Alice',
  email: 'alice@example.com',
  age: 30
});

// ❌ Invalid data - throws ValidationError
await db.set(['users', 'bob'], {
  name: 'Bob',
  email: 'not-an-email', // Invalid!
  age: -5 // Invalid!
});
```

## Type Inference

With schema validation, Valkeyrie automatically infers TypeScript types for your operations:

```typescript
import { z } from 'zod';

const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number()
});

const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .open();

// TypeScript knows the type!
const user = await db.get(['users', 'alice']);
// user.value is typed as: { name: string; email: string; age: number } | null

// This type-checks
if (user.value) {
  console.log(user.value.name); // ✅ TypeScript knows 'name' exists
}

// This doesn't type-check
// console.log(user.value.invalid); // ❌ TypeScript error
```

### Type Inference for Multiple Operations

Type inference works across all operations:

```typescript
const postSchema = z.object({
  title: z.string(),
  content: z.string(),
  published: z.boolean()
});

const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .withSchema(['posts', '*'], postSchema)
  .open();

// get() - automatically typed
const user = await db.get(['users', 'alice']);
// user.value: { name: string; email: string; age: number } | null

const post = await db.get(['posts', 'post-1']);
// post.value: { title: string; content: string; published: boolean } | null

// getMany() - array of typed entries
const entries = await db.getMany([
  ['users', 'alice'],
  ['users', 'bob']
]);
// entries: Array<Entry<{ name: string; email: string; age: number }> | { value: null; ... }>

// list() - typed iterator
for await (const entry of db.list({ prefix: ['users'] })) {
  // entry.value: { name: string; email: string; age: number }
  console.log(entry.value.name); // ✅ Type-safe
}

// watch() - typed stream
const stream = db.watch([
  ['users', 'alice'],
  ['posts', 'post-1']
]);
// stream: ReadableStream<[EntryMaybe<User>, EntryMaybe<Post>]>
```

### Automatic Type Inference

Type inference works automatically without any type annotations:

```typescript
// Type is automatically inferred!
const user = await db.get(['users', 'alice']);
// user.value: { name: string; email: string; age: number } | null

const post = await db.get(['posts', 'post-1']);
// post.value: { title: string; content: string; published: boolean } | null

// No `as const` needed - it just works!
```

## Supported Libraries

Valkeyrie works with any library that implements the Standard Schema specification:

### Zod

```typescript
import { z } from 'zod';

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number().positive(),
  inStock: z.boolean(),
  tags: z.array(z.string()).optional()
});

const db = await Valkeyrie
  .withSchema(['products', '*'], productSchema)
  .open();
```

### Valibot

```typescript
import * as v from 'valibot';

const productSchema = v.object({
  id: v.string(),
  name: v.string(),
  price: v.pipe(v.number(), v.minValue(0)),
  inStock: v.boolean(),
  tags: v.optional(v.array(v.string()))
});

const db = await Valkeyrie
  .withSchema(['products', '*'], productSchema)
  .open();
```

### ArkType

```typescript
import { type } from 'arktype';

const productSchema = type({
  id: 'string',
  name: 'string',
  price: 'number>0',
  inStock: 'boolean',
  'tags?': 'string[]'
});

const db = await Valkeyrie
  .withSchema(['products', '*'], productSchema)
  .open();
```

All three produce the same validation behavior.

## Pattern Matching

Valkeyrie uses patterns to match keys to schemas. The `*` character acts as a wildcard that matches exactly one key part.

### Basic Patterns

```typescript
// Pattern: ['users', '*']
// Matches: ['users', 'alice'], ['users', 'bob'], ['users', 123]
// Does NOT match: ['users'] (missing part), ['users', 'alice', 'extra'] (too many parts)

const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .open();

await db.set(['users', 'alice'], user);  // ✅ Matches
await db.set(['users', 123], user);      // ✅ Matches (numbers work too)
await db.set(['users'], user);           // ❌ Doesn't match (no validation)
await db.set(['users', 'alice', 'x'], user); // ❌ Doesn't match (no validation)
```

### Multi-Level Patterns

```typescript
// Pattern: ['users', '*', 'posts', '*']
// Matches: ['users', 'alice', 'posts', 'post-1']
// Does NOT match: ['users', 'alice', 'posts'] (missing last part)

const postSchema = z.object({
  title: z.string(),
  content: z.string()
});

const db = await Valkeyrie
  .withSchema(['users', '*', 'posts', '*'], postSchema)
  .open();

// ✅ Matches pattern - validated
await db.set(['users', 'alice', 'posts', 'post-1'], {
  title: 'My First Post',
  content: '...'
});

// ❌ Doesn't match pattern - not validated (but still works)
await db.set(['users', 'alice', 'posts'], anyValue);
```

### Pattern Priority

Exact patterns take priority over wildcard patterns:

```typescript
const userSchema = z.object({
  name: z.string(),
  email: z.string()
});

const adminSchema = z.object({
  name: z.string(),
  email: z.string(),
  permissions: z.array(z.string())
});

const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)         // Wildcard pattern
  .withSchema(['users', 'admin'], adminSchema)    // Exact pattern
  .open();

// Uses adminSchema (exact match has priority)
await db.set(['users', 'admin'], {
  name: 'Admin',
  email: 'admin@example.com',
  permissions: ['read', 'write', 'delete']
});

// Uses userSchema (wildcard match)
await db.set(['users', 'alice'], {
  name: 'Alice',
  email: 'alice@example.com'
  // permissions not required
});
```

### Reserved Characters

The `*` character is reserved for patterns and cannot be used as an actual key part:

```typescript
const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .open();

// ❌ Throws TypeError
await db.set(['users', '*'], user);
```

## Multiple Schemas

You can register multiple schemas for different key patterns:

```typescript
import { z } from 'zod';

const userSchema = z.object({
  name: z.string(),
  email: z.string().email()
});

const postSchema = z.object({
  title: z.string(),
  content: z.string(),
  authorId: z.string()
});

const commentSchema = z.object({
  text: z.string(),
  authorId: z.string(),
  postId: z.string()
});

const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .withSchema(['posts', '*'], postSchema)
  .withSchema(['comments', '*'], commentSchema)
  .open();

// Each key pattern uses its own schema
await db.set(['users', 'alice'], { name: 'Alice', email: 'alice@example.com' });
await db.set(['posts', 'post-1'], { title: 'Hello', content: '...', authorId: 'alice' });
await db.set(['comments', 'c1'], { text: 'Great!', authorId: 'bob', postId: 'post-1' });
```

### Permissive by Default

Keys without matching schemas are not validated:

```typescript
const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .open();

// Validated (matches pattern)
await db.set(['users', 'alice'], { name: 'Alice', email: 'alice@example.com' });

// NOT validated (no matching pattern)
await db.set(['settings', 'theme'], 'dark');
await db.set(['cache', 'key'], anyValue);
```

This allows you to use validation only where you need it.

## Validation Timing

Understanding when validation occurs:

### Write Operations

Validation happens synchronously during `set()`:

```typescript
try {
  await db.set(['users', 'alice'], invalidData);
} catch (error) {
  // ValidationError thrown immediately
}
```

### Atomic Operations

Validation happens asynchronously at `commit()` time:

```typescript
const atomic = db.atomic()
  .set(['users', 'alice'], validData)
  .set(['users', 'bob'], invalidData)  // Not validated yet
  .set(['users', 'charlie'], validData);

// Validation happens here
try {
  await atomic.commit();
} catch (error) {
  // ValidationError for bob's data
  // Nothing was committed (atomic guarantee)
}
```

### Read Operations

No validation occurs during read operations:

```typescript
// No validation - always returns stored data
const entry = await db.get(['users', 'alice']);
```

This means reads are fast, but you should be careful if you're manually modifying the database outside of Valkeyrie.

## Error Handling

Failed validations throw a `ValidationError` with detailed information:

```typescript
import { ValidationError } from 'valkeyrie';

try {
  await db.set(['users', 'bob'], {
    name: 'Bob',
    email: 'invalid-email',
    age: -5
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Failed for key:', error.key);
    // ['users', 'bob']

    console.log('Validation issues:', error.issues);
    // [
    //   { message: 'Invalid email', path: ['email'] },
    //   { message: 'Number must be greater than or equal to 0', path: ['age'] }
    // ]
  }
}
```

### Atomic Operation Errors

With atomic operations, the error tells you which mutation failed:

```typescript
try {
  await db.atomic()
    .set(['users', 'alice'], validData)
    .set(['users', 'bob'], invalidData)
    .commit();
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Failed mutation key:', error.key);
    // ['users', 'bob']
  }
}
```

### Custom Error Handling

You can wrap validation errors with more context:

```typescript
async function createUser(id: string, data: unknown) {
  try {
    await db.set(['users', id], data);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new Error(`Failed to create user ${id}: ${error.message}`);
    }
    throw error;
  }
}
```

## Schema Transformations

Schemas can transform data during validation:

```typescript
import { z } from 'zod';

const userSchema = z.object({
  name: z.string().transform(name => name.trim().toUpperCase()),
  email: z.string().email().transform(email => email.toLowerCase()),
  age: z.number(),
  tags: z.array(z.string()).default([])
});

const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .open();

await db.set(['users', 'alice'], {
  name: '  alice  ',        // Will be transformed
  email: 'Alice@EXAMPLE.COM',  // Will be transformed
  age: 30
  // tags will be added as []
});

const user = await db.get(['users', 'alice']);
console.log(user.value);
// {
//   name: 'ALICE',
//   email: 'alice@example.com',
//   age: 30,
//   tags: []
// }
```

### Common Transformations

```typescript
// Trim whitespace
name: z.string().transform(s => s.trim())

// Normalize emails
email: z.string().email().transform(e => e.toLowerCase())

// Add default values
tags: z.array(z.string()).default([])

// Parse dates
createdAt: z.string().transform(s => new Date(s))

// Sanitize input
bio: z.string().transform(s => s.replace(/<[^>]*>/g, ''))
```

## Factory Methods with Schemas

Schema validation works seamlessly with `from()` and `fromAsync()`:

```typescript
import { z } from 'zod';

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email()
});

const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
  { id: 3, name: 'Charlie', email: 'invalid-email' } // Invalid!
];

// All items are validated during import
const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .from(users, {
    prefix: ['users'],
    keyProperty: 'id'
  });
// Throws ValidationError for Charlie
```

### Error Handling with Factory Methods

```typescript
const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .from(users, {
    prefix: ['users'],
    keyProperty: 'id',
    onError: 'continue',  // Don't stop on errors
    onErrorCallback: (error, item) => {
      console.error(`Failed to import user ${item.id}:`, error);
    }
  });
// Imports valid items, skips invalid ones
```

## Best Practices

### 1. Validate Critical Data

Not everything needs validation. Focus on:

```typescript
// ✅ Validate user input
const userSchema = z.object({
  name: z.string(),
  email: z.string().email()
});

// ✅ Validate external data
const apiResponseSchema = z.object({
  id: z.string(),
  data: z.unknown()
});

// ❌ Probably don't need validation
// Internal cache or temporary data
await db.set(['cache', 'key'], anyValue);
```

### 2. Design Patterns Carefully

Think about your key structure before adding schemas:

```typescript
// Good: Clear hierarchy, easy to validate
const db = await Valkeyrie
  .withSchema(['users', '*', 'profile'], profileSchema)
  .withSchema(['users', '*', 'settings'], settingsSchema)
  .open();

// Bad: Flat structure, hard to organize
const db = await Valkeyrie
  .withSchema(['profile', '*'], profileSchema)
  .withSchema(['settings', '*'], settingsSchema)
  .open();
```

### 3. Use Transformations Wisely

Transformations are powerful but can be confusing:

```typescript
// Good: Simple, clear transformations
name: z.string().transform(s => s.trim())

// Bad: Complex logic in transform
name: z.string().transform(s => {
  if (s.length > 50) {
    return s.slice(0, 50);
  }
  return s.toUpperCase().trim().replace(/[^a-z]/gi, '');
})
// Better: Do this in application code
```

### 4. Handle ValidationError Appropriately

```typescript
try {
  await db.set(['users', userId], userData);
} catch (error) {
  if (error instanceof ValidationError) {
    // Log the specific validation issues
    console.error('Validation failed:', error.issues);

    // Return user-friendly error
    return {
      error: 'Invalid user data',
      details: error.issues
    };
  }

  // Handle other errors differently
  throw error;
}
```

### 5. Document Your Schemas

```typescript
// Good: Self-documenting schema
const userSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
  bio: z.string().max(500).optional(),
  tags: z.array(z.string()).max(10).default([])
});

// Even better: Add descriptions
const userSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name too long'),
  email: z.string()
    .email('Invalid email format'),
  age: z.number()
    .int('Age must be a whole number')
    .min(0, 'Age cannot be negative')
    .max(150, 'Age seems unrealistic')
});
```

### 6. Test Your Schemas

```typescript
// Test valid data
await db.set(['users', 'test'], validUser);

// Test invalid data
try {
  await db.set(['users', 'test'], invalidUser);
  throw new Error('Should have thrown ValidationError');
} catch (error) {
  if (!(error instanceof ValidationError)) {
    throw error;
  }
}
```

## Advanced Usage

### Dynamic Schemas

You can create schemas programmatically:

```typescript
function createUserSchema(requiredFields: string[]) {
  const schema: any = {
    name: z.string(),
    email: z.string().email()
  };

  if (requiredFields.includes('age')) {
    schema.age = z.number();
  }

  if (requiredFields.includes('bio')) {
    schema.bio = z.string();
  }

  return z.object(schema);
}

const schema = createUserSchema(['age', 'bio']);

const db = await Valkeyrie
  .withSchema(['users', '*'], schema)
  .open();
```

### Conditional Validation

```typescript
import { z } from 'zod';

const documentSchema = z.object({
  type: z.enum(['draft', 'published']),
  title: z.string(),
  content: z.string(),
  publishedAt: z.date().optional()
}).refine(
  (data) => {
    // If published, must have publishedAt
    if (data.type === 'published') {
      return data.publishedAt !== undefined;
    }
    return true;
  },
  {
    message: 'Published documents must have a publishedAt date',
    path: ['publishedAt']
  }
);
```

### Nested Schemas

```typescript
const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  country: z.string(),
  zipCode: z.string()
});

const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  address: addressSchema,  // Nested schema
  alternateAddresses: z.array(addressSchema).optional()
});
```

### Union Types

```typescript
const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user_created'),
    userId: z.string(),
    name: z.string()
  }),
  z.object({
    type: z.literal('user_deleted'),
    userId: z.string()
  }),
  z.object({
    type: z.literal('post_created'),
    postId: z.string(),
    title: z.string()
  })
]);

const db = await Valkeyrie
  .withSchema(['events', '*'], eventSchema)
  .open();
```

## Notes on validation

1. **Write-time only** - Validation only occurs on writes, not reads
2. **No schema migration** - Changing schemas doesn't validate existing data
3. **Pattern-based only** - Cannot validate based on data content, only key patterns
4. **No cross-key validation** - Cannot validate relationships between different keys

## Summary

- ✅ How to add schema validation with Zod, Valibot, or ArkType
- ✅ Automatic TypeScript type inference from schemas
- ✅ Pattern matching for different key structures
- ✅ When and how validation occurs
- ✅ Error handling and transformations
- ✅ Best practices for schema design
- ✅ Advanced validation patterns

Next, explore:
- **[Factory Methods](./factory-methods.md)** - Import validated data in bulk
- **[Advanced Patterns](./advanced-patterns.md)** - Combine validation with atomic operations
