# Valkeyrie - Key-Value Store

<p align="center">
 <img align="center" alt="Valkeyrie" height="200" src="https://github.com/user-attachments/assets/87c60a17-0f17-42aa-9db8-993dddb08e31">
</p>

---

[![GitHub package.json version](https://img.shields.io/github/package-json/v/ducktors/Valkeyrie)](https://github.com/ducktors/Valkeyrie/releases) ![node:22.14.0](https://img.shields.io/badge/node-22.14.0-lightgreen) ![pnpm@10.20.0](https://img.shields.io/badge/pnpm-10.20.0-yellow) [![npm](https://img.shields.io/npm/dt/valkeyrie)](https://www.npmjs.com/package/valkeyrie) [![CI](https://github.com/ducktors/Valkeyrie/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ducktors/Valkeyrie/actions/workflows/ci.yml) [![Test](https://github.com/ducktors/Valkeyrie/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/ducktors/Valkeyrie/actions/workflows/test.yaml) [![Coverage Status](https://coveralls.io/repos/github/ducktors/Valkeyrie/badge.svg)](https://coveralls.io/github/ducktors/Valkeyrie) [![Maintainability](https://api.codeclimate.com/v1/badges/c1a77d6d8b158d442572/maintainability)](https://codeclimate.com/github/ducktors/valkeyrie/maintainability) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/ducktors/Valkeyrie/badge)](https://scorecard.dev/viewer/?uri=github.com/ducktors/valkeyrie) [![OpenSSF Best Practices](https://www.bestpractices.dev/projects/10163/badge)](https://www.bestpractices.dev/projects/10163)

Valkeyrie is a high-performance key-value store for Node.js applications that solves the problem of efficient data storage and retrieval in JavaScript environments. It brings the powerful Deno.kv API to Node.js, enabling developers to store complex data structures with atomic guarantees without the complexity of setting up external databases. Whether you need a lightweight database for your application, a caching layer, or a way to persist application state, Valkeyrie provides a simple yet powerful solution built on SQLite.

This is a work in progress, but the API and everything already implemented is stable and ready for production.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Building from Source](#building-from-source)
- [Quick Start](#quick-start)
- [Key Concepts](#key-concepts)
  - [Creating and Populating Databases](#creating-and-populating-databases)
  - [Hierarchical Keys](#hierarchical-keys)
  - [Value Types](#value-types)
  - [Atomic Operations](#atomic-operations)
  - [Serializers](#serializers)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Benchmarks](#benchmarks)
- [License](#license)

## Features

- **Simple and intuitive API** - Easy to learn and use
- **Factory functions** - Create and populate databases from iterables and async sources
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

# Using npm
npm install valkeyrie

# Using yarn
yarn add valkeyrie
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

// Create and populate database from existing data
const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
  { id: 3, name: 'Charlie', email: 'charlie@example.com' }
];

const db2 = await Valkeyrie.from(users, {
  prefix: ['users'],
  keyProperty: 'id', // or use a function: (user) => user.email
  path: './users.db' // optional: file path
});

// Database management
// Clear all data but keep the database file
await db.clear();
// Or completely destroy the database (deletes the file)
// await db.destroy();

// Close the database when done
await db.close();
```

## Key Concepts

### Creating and Populating Databases

Valkeyrie provides convenient factory methods to create and populate databases from existing data:

#### `Valkeyrie.from()` - Synchronous Iterables

Create a database from arrays, Sets, Maps, or any iterable:

```typescript
import { Valkeyrie } from 'valkeyrie';

// From an array of objects
const users = [
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob', role: 'user' },
  { id: 3, name: 'Charlie', role: 'user' }
];

const db = await Valkeyrie.from(users, {
  prefix: ['users'],           // Key prefix for all entries
  keyProperty: 'id'             // Property to use as key
});

// Access the data
const alice = await db.get(['users', 1]);
console.log(alice.value); // { id: 1, name: 'Alice', role: 'admin' }

// Using a custom key function
const db2 = await Valkeyrie.from(users, {
  prefix: ['users', 'by-name'],
  keyProperty: (user) => user.name.toLowerCase()
});

// With additional options
const db3 = await Valkeyrie.from(users, {
  prefix: ['users'],
  keyProperty: 'id',
  path: './users.db',           // Save to file
  expireIn: 86400000,           // TTL: 24 hours
  onProgress: (processed, total) => {
    console.log(`Processed ${processed}/${total} items`);
  }
});
```

#### `Valkeyrie.fromAsync()` - Async Iterables

Create a database from async generators or async iterables:

```typescript
// From an async generator
async function* fetchUsers() {
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`/api/users?page=${page}`);
    const users = await response.json();
    for (const user of users) {
      yield user;
    }
  }
}

const db = await Valkeyrie.fromAsync(fetchUsers(), {
  prefix: ['users'],
  keyProperty: 'id',
  onProgress: (processed) => {
    console.log(`Imported ${processed} users...`);
  }
});

// From a stream
import { Readable } from 'stream';

const stream = Readable.from(largeDataset);
const db2 = await Valkeyrie.fromAsync(stream, {
  prefix: ['data'],
  keyProperty: 'id'
});
```

#### Factory Options

Both `from()` and `fromAsync()` support the following options:

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `prefix` | `Key` | ✅ | Key prefix for all entries |
| `keyProperty` | `keyof T \| (item: T) => KeyPart` | ✅ | Property name or function to extract key |
| `path` | `string` | ❌ | Database file path (default: in-memory) |
| `serializer` | `() => Serializer` | ❌ | Custom serializer |
| `destroyOnClose` | `boolean` | ❌ | Destroy database on close (default: false) |
| `expireIn` | `number` | ❌ | TTL for all entries in milliseconds |
| `onProgress` | `(processed, total?) => void` | ❌ | Progress callback |
| `onError` | `'stop' \| 'continue'` | ❌ | Error handling strategy (default: 'stop') |
| `onErrorCallback` | `(error, item) => void` | ❌ | Called for each error when `onError: 'continue'` |

**Performance Notes:**
- Automatically batches inserts in chunks of 1000 items using atomic operations
- Handles datasets of any size efficiently
- Progress callbacks receive `total` parameter for sync iterables (when size is known)

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

### Serializers

Valkeyrie supports pluggable serializers that allow you to customize how values are stored in the database:

- **V8 Serializer (Default)** - Uses Node.js's built-in `node:v8` module for efficient binary serialization
- **JSON Serializer** - Human-readable format compatible with other programming languages
- **BSON Serializer** - Uses MongoDB's BSON format for efficient binary serialization
- **MessagePack Serializer** - Uses the msgpackr library for compact binary serialization
- **CBOR-X Serializer** - Uses the cbor-x library for high-performance CBOR serialization
- **Custom Serializers** - Create your own serializers for specialized needs like compression or encryption

```typescript
import { Valkeyrie } from 'valkeyrie';
import { bsonSerializer } from 'valkeyrie/serializers/bson';
import { cborXSerializer } from 'valkeyrie/serializers/cbor-x';

// Using the BSON serializer
const dbBson = await Valkeyrie.open('./data.db', {
  serializer: bsonSerializer
});

// Using the CBOR-X serializer
const dbCbor = await Valkeyrie.open('./cbor-data.db', {
  serializer: cborXSerializer
});
```

For detailed information about serializers, see the [Serializers section in the documentation](./docs/documentation.md#serializer-comparison).

## Documentation

For complete documentation, see [Documentation](./docs/documentation.md).

## Contributing

For detailed information on how to contribute to this project, please see our [Contributing Guide](./CONTRIBUTING.md).

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

Valkeyrie is licensed under the MIT License. See the [License](./LICENSE) file for details. 
