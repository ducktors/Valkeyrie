---
# Valkeyrie - Key-Value Store

<p align="center">
 <img align="center" alt="Valkeyrie" height="200" src="https://github.com/user-attachments/assets/87c60a17-0f17-42aa-9db8-993dddb08e31">
</p>

---

[![GitHub package.json version](https://img.shields.io/github/package-json/v/ducktors/valkeyrie)](https://github.com/ducktors/valkeyrie/releases) ![node:22.14.0](https://img.shields.io/badge/node-22.14.0-lightgreen) ![pnpm@10.6.2](https://img.shields.io/badge/pnpm-10.6.2-yellow) [![npm](https://img.shields.io/npm/dt/valkeyrie)](https://www.npmjs.com/package/valkeyrie) [![CI](https://github.com/ducktors/valkeyrie/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ducktors/valkeyrie/actions/workflows/ci.yml) [![Test](https://github.com/ducktors/valkeyrie/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/ducktors/valkeyrie/actions/workflows/test.yaml) [![Coverage Status](https://coveralls.io/repos/github/ducktors/valkeyrie/badge.svg)](https://coveralls.io/github/ducktors/valkeyrie) [![Maintainability](https://api.codeclimate.com/v1/badges/c1a77d6d8b158d442572/maintainability)](https://codeclimate.com/github/ducktors/valkeyrie/maintainability) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/ducktors/valkeyrie/badge)](https://scorecard.dev/viewer/?uri=github.com/ducktors/valkeyrie)

Valkeyrie is a key-value store for Node.js applications. It provides the same API as Deno.kv for storing and retrieving data with support for complex data types, atomic operations, and efficient querying.
The code is tested against Deno.kv tests to ensure 100% compatibility.

This is a work in progress, but the API and everything already implemented is stable and ready for production.

## Features

- **Simple and intuitive API** - Easy to learn and use
- **Rich data type support** - Store and retrieve complex data structures
- **Hierarchical keys** - Organize data with multi-part keys
- **Atomic operations** - Perform multiple operations in a single transaction
- **Efficient querying** - List data with prefix and range queries
- **Data expiration** - Set time-to-live for values
- **High performance** - Built on SQLite with optimized operations
- **Specialized numeric type** - 64-bit unsigned integers for counters

## Installation

```bash
# Using pnpm
pnpm add valkeyrie
```

## Quick Start

```typescript
import { Valkeyrie, KvU64 } from 'valkeyrie';

// Open a database
const db = await Valkeyrie.open();

// Store values
await db.set(['users', 'user1'], { name: 'John Doe', age: 30 });
await db.set(['counters', 'visitors'], new KvU64(1000n));

// Retrieve values
const user = await db.get(['users', 'user1']);
console.log(user.value); // { name: 'John Doe', age: 30 }

// List values with a common prefix
for await (const entry of db.list({ prefix: ['users'] })) {
  console.log(entry.key, entry.value);
}

// Perform atomic operations
await db.atomic()
  .check({ key: ['users', 'user1'], versionstamp: user.versionstamp })
  .set(['users', 'user1'], { ...user.value, lastLogin: new Date() })
  .sum(['counters', 'visitors'], 1n)
  .commit();

// Close the database when done
await db.close();
```

## Key Concepts

### Hierarchical Keys

Keys in Valkeyrie are arrays of parts, allowing for hierarchical organization:

```typescript
// User data
await db.set(['users', 'user1', 'profile'], { ... });
await db.set(['users', 'user1', 'settings'], { ... });
```

### Value Types

Valkeyrie supports a wide range of value types:

- Primitive types: string, number, boolean, bigint, null, undefined
- Binary data: Uint8Array, ArrayBuffer
- Complex types: objects, arrays, Map, Set
- Date objects, RegExp objects
- KvU64 (specialized 64-bit unsigned integer)

> **Important Note**: KvU64 instances can only be used as top-level values, not nested within objects or arrays.

### Atomic Operations

Perform multiple operations atomically with optimistic concurrency control:

```typescript
await db.atomic()
  .set(['users', 'user1'], { name: 'John' })
  .set(['users', 'user2'], { name: 'Jane' })
  .delete(['users', 'user3'])
  .commit();
```

## Documentation

For complete documentation, see [DOCUMENTATION.md](./DOCUMENTATION.md).

## Benchmarks

Valkeyrie includes a comprehensive benchmarking suite to measure performance:

```bash
# Run all benchmarks
pnpm benchmark

# Run specific benchmark suites
pnpm benchmark:basic    # Basic operations
pnpm benchmark:list     # List operations
pnpm benchmark:atomic   # Atomic operations
```

## License

Valkeyrie is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details. 
