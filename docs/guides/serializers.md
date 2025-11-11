# Serializers

Serializers determine how your data is stored in the SQLite database. Valkeyrie supports multiple serializers, each with different trade-offs.

## Table of Contents

- [Overview](#overview)
- [Available Serializers](#available-serializers)
- [Choosing a Serializer](#choosing-a-serializer)
- [Using Serializers](#using-serializers)
- [Serializer Comparison](#serializer-comparison)
- [Custom Serializers](#custom-serializers)
- [Migration Between Serializers](#migration-between-serializers)
- [Best Practices](#best-practices)

## Overview

When you store data in Valkeyrie, it's converted to binary format before being saved to SQLite. Serializers handle this conversion:

```
JavaScript Value  →  [Serializer]  →  Binary Data  →  SQLite
                      ↑
                  Your choice!
```

Different serializers offer different benefits:
- **Performance** - How fast can it serialize/deserialize?
- **Size** - How compact is the serialized data?
- **Compatibility** - Can other languages read it?
- **Features** - What data types does it support?

## Available Serializers

### V8 Serializer (Default)

Uses Node.js's built-in V8 serialization.

```typescript
import { Valkeyrie } from 'valkeyrie';

// Default - no need to specify
const db = await Valkeyrie.open('./data.db');
```

**When to use:**
- You need maximum performance
- You're working with complex JavaScript objects
- You need circular reference support
- You're only using Node.js (no cross-language needs)

**Pros:**
- ✅ Fastest performance
- ✅ Supports circular references
- ✅ No additional dependencies
- ✅ Handles most JavaScript types

**Cons:**
- ❌ Not human-readable
- ❌ Not compatible with other languages
- ❌ Tied to V8 version

### JSON Serializer

Human-readable JSON format.

```typescript
import { Valkeyrie } from 'valkeyrie';
import { jsonSerializer } from 'valkeyrie/serializers/json';

const db = await Valkeyrie.open('./data.db', {
  serializer: jsonSerializer
});
```

**When to use:**
- You need to inspect database contents manually
- You need cross-language compatibility
- You want to debug data issues easily
- Data size and performance are less critical

**Pros:**
- ✅ Human-readable
- ✅ Cross-language compatible
- ✅ Easy to debug
- ✅ No additional dependencies

**Cons:**
- ❌ Larger file sizes
- ❌ Slower than binary formats
- ❌ No circular reference support
- ❌ Binary data encoded as base64 (33% larger)

### BSON Serializer

MongoDB's binary format.

```typescript
import { Valkeyrie } from 'valkeyrie';
import { bsonSerializer } from 'valkeyrie/serializers/bson';

// First: pnpm add bson
const db = await Valkeyrie.open('./data.db', {
  serializer: bsonSerializer
});
```

**When to use:**
- You need MongoDB compatibility
- You want efficient binary storage
- You're migrating from/to MongoDB

**Pros:**
- ✅ Efficient binary format
- ✅ MongoDB compatible
- ✅ Good performance
- ✅ Standard format

**Cons:**
- ❌ Requires `bson` package
- ❌ No Map/Set support
- ❌ No BigInt support
- ❌ No circular references

### MessagePack Serializer

Compact binary format.

```typescript
import { Valkeyrie } from 'valkeyrie';
import { msgpackrSerializer } from 'valkeyrie/serializers/msgpackr';

// First: pnpm add msgpackr
const db = await Valkeyrie.open('./data.db', {
  serializer: msgpackrSerializer
});
```

**When to use:**
- You need compact storage
- You need cross-language support
- Performance and size both matter

**Pros:**
- ✅ Very compact
- ✅ Fast performance
- ✅ Cross-language support
- ✅ Widely adopted

**Cons:**
- ❌ Requires `msgpackr` package
- ❌ Map→object, Set→array conversion
- ❌ No circular references

### CBOR-X Serializer

High-performance CBOR format (RFC 8949).

```typescript
import { Valkeyrie } from 'valkeyrie';
import { cborXSerializer } from 'valkeyrie/serializers/cbor-x';

// First: pnpm add cbor-x
const db = await Valkeyrie.open('./data.db', {
  serializer: cborXSerializer
});
```

**When to use:**
- You need maximum performance AND compact size
- You need a standardized format
- You're working with IoT or embedded systems

**Pros:**
- ✅ Extremely fast
- ✅ Very compact
- ✅ RFC standard
- ✅ Excellent type support

**Cons:**
- ❌ Requires `cbor-x` package
- ❌ No circular references
- ❌ Less widely known than JSON/MessagePack

## Choosing a Serializer

### Decision Tree

```
Need to inspect data manually?
├─ Yes → JSON Serializer
└─ No
   Need cross-language compatibility?
   ├─ Yes
   │  Need MongoDB compatibility?
   │  ├─ Yes → BSON Serializer
   │  └─ No
   │     Need smallest size?
   │     ├─ Yes → CBOR-X Serializer
   │     └─ No → MessagePack Serializer
   └─ No
      Have circular references?
      ├─ Yes → V8 Serializer (only option)
      └─ No
         Need absolute best performance?
         ├─ Yes → CBOR-X or V8 Serializer
         └─ No → V8 Serializer (default)
```

### By Use Case

| Use Case | Recommended Serializer | Why |
|----------|----------------------|-----|
| General purpose | V8 | Best default, no dependencies |
| Development/Debugging | JSON | Easy to inspect |
| Production web app | CBOR-X or V8 | Performance + size |
| MongoDB migration | BSON | Direct compatibility |
| Microservices/APIs | MessagePack | Cross-language + compact |
| IoT/Embedded | CBOR-X | Standard + efficient |
| Caching | V8 or CBOR-X | Maximum performance |
| Data export/import | JSON | Human-readable |

## Using Serializers

### Basic Usage

```typescript
import { Valkeyrie } from 'valkeyrie';
import { jsonSerializer } from 'valkeyrie/serializers/json';

const db = await Valkeyrie.open('./data.db', {
  serializer: jsonSerializer
});

// Use normally - serializer is transparent
await db.set(['key'], { some: 'data' });
const entry = await db.get(['key']);
```

### With Factory Methods

```typescript
import { msgpackrSerializer } from 'valkeyrie/serializers/msgpackr';

const db = await Valkeyrie.from(data, {
  prefix: ['items'],
  keyProperty: 'id',
  path: './data.db',
  serializer: () => msgpackrSerializer()
});
```

### With Schema Validation

```typescript
import { z } from 'zod';
import { cborXSerializer } from 'valkeyrie/serializers/cbor-x';

const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .open('./data.db', {
    serializer: cborXSerializer
  });
```

## Serializer Comparison

### Size Comparison

For typical data (1000 user objects):

| Serializer | Size | vs V8 |
|-----------|------|-------|
| V8 | 145 KB | baseline |
| JSON | 210 KB | +45% |
| BSON | 150 KB | +3% |
| MessagePack | 135 KB | -7% |
| CBOR-X | 130 KB | -10% |

### Feature Matrix

| Feature | V8 | JSON | BSON | MessagePack | CBOR-X |
|---------|----|----|------|-------------|--------|
| Circular refs | ✅ | ❌ | ❌ | ❌ | ❌ |
| Map/Set | ✅ | ✅ | ❌ | ⚠️* | ✅ |
| BigInt | ✅ | ✅ | ❌ | ✅ | ✅ |
| Date | ✅ | ✅ | ✅ | ✅ | ✅ |
| RegExp | ✅ | ✅ | ✅ | ❌ | ❌ |
| Binary data | ✅ | ✅ | ✅ | ✅ | ✅ |
| undefined | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cross-language | ❌ | ✅ | ✅ | ✅ | ✅ |
| Human-readable | ❌ | ✅ | ❌ | ❌ | ❌ |

*⚠️ MessagePack converts Map→Object, Set→Array

## Custom Serializers

You can create custom serializers for specialized needs:

### Basic Custom Serializer

```typescript
import { defineSerializer } from 'valkeyrie/serializers';
import { KvU64 } from 'valkeyrie/KvU64';

const customSerializer = defineSerializer({
  serialize: (value: unknown): Uint8Array => {
    const isU64 = value instanceof KvU64 ? 1 : 0;

    const json = JSON.stringify({
      value: isU64 ? (value as KvU64).value.toString() : value,
      isU64
    });

    return Buffer.from(json, 'utf8');
  },

  deserialize: (data: Uint8Array): unknown => {
    const json = Buffer.from(data).toString('utf8');
    const { value, isU64 } = JSON.parse(json);

    if (isU64) {
      return new KvU64(BigInt(value));
    }

    return value;
  }
});

const db = await Valkeyrie.open('./data.db', {
  serializer: customSerializer
});
```

### Compressed Serializer

```typescript
import { defineSerializer } from 'valkeyrie/serializers';
import { gzipSync, gunzipSync } from 'node:zlib';
import { serialize, deserialize } from 'node:v8';

const compressedSerializer = defineSerializer({
  serialize: (value: unknown): Uint8Array => {
    const serialized = serialize(value);
    return gzipSync(serialized);
  },

  deserialize: (data: Uint8Array): unknown => {
    const decompressed = gunzipSync(data);
    return deserialize(decompressed);
  }
});

// Good for large, compressible data
const db = await Valkeyrie.open('./data.db', {
  serializer: compressedSerializer
});
```

### Encrypted Serializer

```typescript
import { defineSerializer } from 'valkeyrie/serializers';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function createEncryptedSerializer(key: Buffer) {
  return defineSerializer({
    serialize: (value: unknown): Uint8Array => {
      const json = JSON.stringify(value);
      const iv = randomBytes(16);
      const cipher = createCipheriv('aes-256-cbc', key, iv);

      const encrypted = Buffer.concat([
        cipher.update(json, 'utf8'),
        cipher.final()
      ]);

      // Prepend IV
      return Buffer.concat([iv, encrypted]);
    },

    deserialize: (data: Uint8Array): unknown => {
      const iv = data.slice(0, 16);
      const encrypted = data.slice(16);
      const decipher = createDecipheriv('aes-256-cbc', key, iv);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);

      return JSON.parse(decrypted.toString('utf8'));
    }
  });
}

// Use with encryption key
const key = Buffer.from('your-32-byte-key-here-securely!');
const db = await Valkeyrie.open('./encrypted.db', {
  serializer: createEncryptedSerializer(key)
});
```

## Migration Between Serializers

If you need to change serializers:

### Manual Migration

```typescript
// Old database with V8 serializer
const oldDb = await Valkeyrie.open('./old.db');

// New database with JSON serializer
const newDb = await Valkeyrie.open('./new.db', {
  serializer: jsonSerializer
});

// Copy all data
for await (const entry of oldDb.list({ prefix: [] })) {
  await newDb.set(entry.key, entry.value);
}

await oldDb.close();
await newDb.close();
```

### Batch Migration

```typescript
async function migrate(oldPath: string, newPath: string, newSerializer) {
  const oldDb = await Valkeyrie.open(oldPath);
  const newDb = await Valkeyrie.open(newPath, { serializer: newSerializer });

  let count = 0;
  const batch: any[] = [];
  const BATCH_SIZE = 1000;

  for await (const entry of oldDb.list({ prefix: [] })) {
    batch.push(entry);

    if (batch.length >= BATCH_SIZE) {
      const atomic = newDb.atomic();
      for (const item of batch) {
        atomic.set(item.key, item.value);
      }
      await atomic.commit();

      count += batch.length;
      console.log(`Migrated ${count} entries...`);
      batch.length = 0;
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const atomic = newDb.atomic();
    for (const item of batch) {
      atomic.set(item.key, item.value);
    }
    await atomic.commit();
    count += batch.length;
  }

  await oldDb.close();
  await newDb.close();

  console.log(`Migration complete: ${count} entries`);
}

// Use it
await migrate('./old.db', './new.db', jsonSerializer);
```

## Best Practices

### 1. Choose Once, Stick With It

```typescript
// ✅ Good: Consistent serializer
const serializer = cborXSerializer;
const db1 = await Valkeyrie.open('./db1.db', { serializer });
const db2 = await Valkeyrie.open('./db2.db', { serializer });

// ❌ Bad: Mixing serializers confuses things
const db1 = await Valkeyrie.open('./db1.db', { serializer: jsonSerializer });
const db2 = await Valkeyrie.open('./db2.db', { serializer: cborXSerializer });
```

### 2. Test Your Data

```typescript
// Test with your actual data types
const testData = {
  string: 'hello',
  number: 42,
  date: new Date(),
  map: new Map([['key', 'value']]),
  bigint: 123n
};

const db = await Valkeyrie.open(':memory:', { serializer: yourSerializer });
await db.set(['test'], testData);
const result = await db.get(['test']);

// Verify it round-trips correctly
assert.deepEqual(result.value, testData);
```

### 3. Consider Your Requirements

```typescript
// Development: use JSON for debugging
if (process.env.NODE_ENV === 'development') {
  serializer = jsonSerializer;
}

// Production: use fast binary format
if (process.env.NODE_ENV === 'production') {
  serializer = cborXSerializer;
}

const db = await Valkeyrie.open('./data.db', { serializer });
```

### 4. Document Your Choice

```typescript
/**
 * Using CBOR-X serializer for:
 * - Maximum performance
 * - Smallest storage size
 * - Standard format
 *
 * NOTE: If changing serializer, see docs/migration.md
 */
const db = await Valkeyrie.open('./data.db', {
  serializer: cborXSerializer
});
```

## Summary

You've learned:

- ✅ What serializers do and why they matter
- ✅ The five built-in serializers and their trade-offs
- ✅ How to choose the right serializer for your use case
- ✅ How to create custom serializers
- ✅ How to migrate between serializers
- ✅ Best practices for serializer usage

**Quick recommendations:**
- **Default choice**: V8 (it's fast and works great)
- **Need to inspect data**: JSON
- **Maximum performance**: CBOR-X
- **Cross-language**: MessagePack or JSON
- **MongoDB compatibility**: BSON

Next steps:
- **[Advanced Patterns](./advanced-patterns.md)** - Atomic operations, watch API, and more
- **[API Reference](../api/api-reference.md)** - Complete API documentation
