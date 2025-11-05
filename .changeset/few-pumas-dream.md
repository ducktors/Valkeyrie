---
"valkeyrie": minor
---

feat: add `from` and `fromAsync` factory functions for database population

This adds two new static factory methods to create and populate Valkeyrie databases from existing data sources:

- **`Valkeyrie.from(iterable, options)`** - Create and populate a database from synchronous iterables (arrays, Sets, Maps, custom iterables)
- **`Valkeyrie.fromAsync(asyncIterable, options)`** - Create and populate a database from async iterables (async generators, streams, async iterators)

**Key Features:**
- Flexible key extraction via property names or custom functions
- Automatic batching (1000 items per atomic operation) for optimal performance
- Progress tracking with optional callbacks
- Configurable error handling (stop or continue on errors)
- Support for all database options (TTL, custom serializers, file paths, etc.)
- Memory efficient processing for large datasets

**Example:**
```typescript
const users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' }
];

const db = await Valkeyrie.from(users, {
  prefix: ['users'],
  keyProperty: 'id',
  onProgress: (processed, total) => console.log(`${processed}/${total}`)
});
```

This is especially useful for data migrations, imports, seeding databases, and creating databases from API responses or streams.