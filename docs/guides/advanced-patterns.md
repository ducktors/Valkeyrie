# Advanced Patterns

This guide covers advanced Valkeyrie features for building sophisticated applications.

## Table of Contents

- [Watch API](#watch-api)
- [Atomic Operations](#atomic-operations)
- [Optimistic Concurrency Control](#optimistic-concurrency-control)
- [Numeric Operations with KvU64](#numeric-operations-with-kvu64)
- [Multi-Instance Concurrency](#multi-instance-concurrency)
- [Real-World Patterns](#real-world-patterns)
- [Performance Optimization](#performance-optimization)

## Watch API

The `watch()` API lets you monitor keys for changes in real-time using the Web Streams API.

### Basic Usage

```typescript
import { Valkeyrie } from 'valkeyrie';

const db = await Valkeyrie.open('./data.db');

// Watch a single key
const stream = db.watch([['users', 'alice']]);

// Read changes as they happen
for await (const [entry] of stream) {
  console.log('Change detected:', entry.key, entry.value);
}
```

### How It Works

When you start watching keys:
1. You immediately receive the current state of each key
2. Whenever any watched key changes, you receive an update
3. The stream continues until you cancel it or close the database

```typescript
const watcher = db.watch([['counter']]);

const reader = watcher.getReader();

// Get initial state
const { value: [initial] } = await reader.read();
console.log('Initial value:', initial.value); // null (doesn't exist yet)

// Make a change
await db.set(['counter'], 42);

// Receive the update
const { value: [updated] } = await reader.read();
console.log('Updated value:', updated.value); // 42

// Clean up
await reader.cancel();
```

### Watching Multiple Keys

Watch multiple keys simultaneously with automatic type inference:

```typescript
import { z } from 'zod';

const userSchema = z.object({ name: z.string() });
const postSchema = z.object({ title: z.string() });

const db = await Valkeyrie
  .withSchema(['users', '*'], userSchema)
  .withSchema(['posts', '*'], postSchema)
  .open();

// Watch multiple keys with type inference
const stream = db.watch([
  ['users', 'alice'],
  ['posts', 'post-1']
]);

for await (const [userEntry, postEntry] of stream) {
  // userEntry is typed as EntryMaybe<{ name: string }>
  // postEntry is typed as EntryMaybe<{ title: string }>

  if (userEntry.value) {
    console.log('User changed:', userEntry.value.name);
  }

  if (postEntry.value) {
    console.log('Post changed:', postEntry.value.title);
  }
}
```

### Stream Control

Use standard Web Streams API for control:

```typescript
const stream = db.watch([['key']]);
const reader = stream.getReader();

try {
  // Read with timeout
  const timeout = setTimeout(() => reader.cancel(), 5000);

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    const [entry] = value;
    console.log('Change:', entry);

    // Stop watching after specific condition
    if (entry.value === 'stop') {
      break;
    }
  }

  clearTimeout(timeout);
} finally {
  await reader.cancel(); // Always clean up
}
```

### Real-Time Dashboard Example

```typescript
async function monitorMetrics(db: Valkeyrie) {
  const metricsStream = db.watch([
    ['metrics', 'cpu'],
    ['metrics', 'memory'],
    ['metrics', 'requests']
  ]);

  for await (const [cpu, memory, requests] of metricsStream) {
    updateDashboard({
      cpu: cpu.value,
      memory: memory.value,
      requests: requests.value
    });
  }
}

// Start monitoring
const monitorPromise = monitorMetrics(db);

// Update metrics from another part of your app
setInterval(async () => {
  await db.set(['metrics', 'cpu'], process.cpuUsage());
  await db.set(['metrics', 'memory'], process.memoryUsage());
  await db.set(['metrics', 'requests'], requestCount);
}, 1000);
```

### Live Collaboration Example

```typescript
async function watchUserPresence(db: Valkeyrie) {
  const stream = db.watch([
    ['presence', 'user1'],
    ['presence', 'user2'],
    ['presence', 'user3']
  ]);

  for await (const entries of stream) {
    const onlineUsers = entries
      .filter(entry => entry.value?.online)
      .map(entry => entry.key[1]);

    console.log('Online users:', onlineUsers);
  }
}

// Update presence
await db.set(['presence', 'user1'], { online: true, lastSeen: Date.now() });
```

### Error Handling

```typescript
const stream = db.watch([['key']]);

try {
  for await (const [entry] of stream) {
    console.log(entry);
  }
} catch (error) {
  if (error.message === 'Database is closed') {
    console.log('Watch ended: database closed');
  } else {
    console.error('Watch error:', error);
  }
}
```

### Best Practices for Watch

1. **Always clean up watchers**
   ```typescript
   const stream = db.watch([['key']]);
   try {
     // Use the stream
   } finally {
     const reader = stream.getReader();
     await reader.cancel();
   }
   ```

2. **Limit watched keys** - Don't watch hundreds of keys at once
   ```typescript
   // ✅ Good: Watch specific keys
   db.watch([['users', 'current-user']]);

   // ❌ Bad: Don't try to watch all keys
   // (Use list() with periodic polling instead)
   ```

3. **Handle initial state** - First event is always the current state
   ```typescript
   const stream = db.watch([['key']]);
   const reader = stream.getReader();

   const { value: [initial] } = await reader.read();
   // This is the CURRENT state, not a change
   ```

4. **Clean up on app shutdown**
   ```typescript
   process.on('SIGTERM', async () => {
     await reader.cancel();
     await db.close();
   });
   ```

## Atomic Operations

Atomic operations let you perform multiple database operations as a single, all-or-nothing transaction.

### Basic Atomic Operations

```typescript
const result = await db.atomic()
  .set(['users', 'alice'], { name: 'Alice', balance: 100 })
  .set(['users', 'bob'], { name: 'Bob', balance: 50 })
  .delete(['users', 'charlie'])
  .commit();

if (result.ok) {
  console.log('All operations succeeded');
  console.log('Versionstamp:', result.versionstamp);
} else {
  console.log('One or more operations failed');
}
```

### Why Use Atomic Operations?

**Without atomic operations:**
```typescript
// ❌ Not safe - can leave inconsistent state
await db.set(['accounts', 'alice'], { balance: aliceBalance - 100 });
// App crashes here! Alice lost $100 but Bob didn't receive it
await db.set(['accounts', 'bob'], { balance: bobBalance + 100 });
```

**With atomic operations:**
```typescript
// ✅ Safe - either both succeed or both fail
const result = await db.atomic()
  .set(['accounts', 'alice'], { balance: aliceBalance - 100 })
  .set(['accounts', 'bob'], { balance: bobBalance + 100 })
  .commit();

if (!result.ok) {
  // Transaction failed - no changes were made
  throw new Error('Transfer failed');
}
```

### Combining Operations

```typescript
await db.atomic()
  .set(['post', postId], newPost)              // Create
  .set(['user', userId, 'postCount'], count + 1) // Update
  .delete(['drafts', postId])                  // Delete
  .commit();
```

## Optimistic Concurrency Control

Use version checks to prevent conflicting updates:

### The Problem

```typescript
// User 1 reads
const entry1 = await db.get(['counter']);
const value1 = entry1.value; // 100

// User 2 reads
const entry2 = await db.get(['counter']);
const value2 = entry2.value; // 100

// User 1 writes
await db.set(['counter'], value1 + 10); // Sets to 110

// User 2 writes
await db.set(['counter'], value2 + 5); // Sets to 105 - overwrites User 1's change!
// Lost update! Should be 115
```

### The Solution: Check-and-Set

```typescript
// User 1
const entry1 = await db.get(['counter']);
const result1 = await db.atomic()
  .check({ key: ['counter'], versionstamp: entry1.versionstamp })
  .set(['counter'], entry1.value + 10)
  .commit();

// User 2
const entry2 = await db.get(['counter']);
const result2 = await db.atomic()
  .check({ key: ['counter'], versionstamp: entry2.versionstamp })
  .set(['counter'], entry2.value + 5)
  .commit();

if (!result2.ok) {
  // User 2's transaction failed - counter was modified
  // Retry logic here
}
```

### Retry Pattern

```typescript
async function incrementWithRetry(
  db: Valkeyrie,
  key: Key,
  amount: number,
  maxRetries = 3
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    const entry = await db.get(key);
    const currentValue = entry.value ?? 0;

    const result = await db.atomic()
      .check({ key, versionstamp: entry.versionstamp })
      .set(key, currentValue + amount)
      .commit();

    if (result.ok) {
      return true;
    }

    // Exponential backoff
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
  }

  return false; // Failed after retries
}

// Use it
const success = await incrementWithRetry(db, ['counter'], 1);
```

### Multiple Checks

```typescript
// Transfer money - check both accounts
const alice = await db.get(['accounts', 'alice']);
const bob = await db.get(['accounts', 'bob']);

if (alice.value.balance < 100) {
  throw new Error('Insufficient funds');
}

const result = await db.atomic()
  .check({ key: ['accounts', 'alice'], versionstamp: alice.versionstamp })
  .check({ key: ['accounts', 'bob'], versionstamp: bob.versionstamp })
  .set(['accounts', 'alice'], { balance: alice.value.balance - 100 })
  .set(['accounts', 'bob'], { balance: bob.value.balance + 100 })
  .commit();

if (!result.ok) {
  // One of the accounts was modified - retry
}
```

## Numeric Operations with KvU64

For counters and numeric operations, use `KvU64` with atomic operations:

### Basic Counter

```typescript
import { KvU64 } from 'valkeyrie/KvU64';

// Initialize
await db.set(['counter'], new KvU64(0n));

// Increment atomically
await db.atomic()
  .sum(['counter'], 1n)
  .commit();

// Get value
const counter = await db.get(['counter']);
console.log(counter.value.value); // 1n (bigint)
```

### Numeric Operations

```typescript
// Sum: add to current value
await db.atomic()
  .sum(['visitors'], 5n) // Add 5
  .commit();

// Max: set to maximum of current and new value
await db.atomic()
  .max(['high-score'], 1000n) // Set to 1000 if current is less
  .commit();

// Min: set to minimum of current and new value
await db.atomic()
  .min(['low-price'], 50n) // Set to 50 if current is more
  .commit();
```

### Distributed Counter

```typescript
class DistributedCounter {
  constructor(private db: Valkeyrie, private key: Key) {}

  async increment(amount = 1n): Promise<void> {
    await this.db.atomic()
      .sum(this.key, amount)
      .commit();
  }

  async decrement(amount = 1n): Promise<void> {
    await this.db.atomic()
      .sum(this.key, -amount)
      .commit();
  }

  async getValue(): Promise<bigint> {
    const entry = await this.db.get(this.key);
    return entry.value?.value ?? 0n;
  }

  async reset(): Promise<void> {
    await this.db.set(this.key, new KvU64(0n));
  }
}

// Use it
const pageViews = new DistributedCounter(db, ['metrics', 'page-views']);
await pageViews.increment();
```

### Rate Limiting

```typescript
async function checkRateLimit(
  db: Valkeyrie,
  userId: string,
  limit: bigint
): Promise<boolean> {
  const key = ['rate-limit', userId];

  // Initialize if doesn't exist
  const current = await db.get(key);
  if (current.value === null) {
    await db.set(key, new KvU64(0n), { expireIn: 60_000 }); // 1 minute window
  }

  // Increment and check
  await db.atomic().sum(key, 1n).commit();

  const updated = await db.get(key);
  return updated.value.value <= limit;
}

// Use it
if (await checkRateLimit(db, 'user123', 100n)) {
  // Allow request
} else {
  // Rate limit exceeded
}
```

## Multi-Instance Concurrency

Valkeyrie supports multiple processes accessing the same database file safely.

### How It Works

As of v0.7.2, Valkeyrie uses database-level versionstamp generation with proper locking:
- Each database has a sequence table
- Versionstamps are generated atomically using SQLite's transaction system
- Multiple processes/instances are safe

```typescript
// Process 1
const db1 = await Valkeyrie.open('./shared.db');
await db1.set(['key'], 'value1');

// Process 2 (different Node.js process)
const db2 = await Valkeyrie.open('./shared.db');
await db2.set(['key'], 'value2');

// Both work correctly - last write wins with proper versionstamps
```

### Multi-Instance Patterns

**Worker Pool:**
```typescript
// main.js
import { Worker } from 'worker_threads';

for (let i = 0; i < 4; i++) {
  new Worker('./worker.js');
}

// worker.js
import { Valkeyrie } from 'valkeyrie';

const db = await Valkeyrie.open('./shared.db');

// Each worker can safely write
await db.set(['worker', process.pid], {
  id: process.pid,
  status: 'active'
});
```

**Distributed Queue:**
```typescript
async function processQueue(workerId: string) {
  const db = await Valkeyrie.open('./queue.db');

  while (true) {
    // List pending items
    const items = await Array.fromAsync(
      db.list({ prefix: ['queue', 'pending'] }, { limit: 1 })
    );

    if (items.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }

    const item = items[0];

    // Try to claim it atomically
    const result = await db.atomic()
      .check({ key: item.key, versionstamp: item.versionstamp })
      .delete(item.key)
      .set(['queue', 'processing', workerId], item.value)
      .commit();

    if (result.ok) {
      // We successfully claimed this item
      await processItem(item.value);

      await db.delete(['queue', 'processing', workerId]);
    }
  }
}
```

## Real-World Patterns

### Session Management

```typescript
class SessionStore {
  constructor(private db: Valkeyrie) {}

  async create(userId: string, data: any): Promise<string> {
    const sessionId = crypto.randomUUID();

    await this.db.set(['sessions', sessionId], {
      userId,
      data,
      createdAt: Date.now()
    }, {
      expireIn: 24 * 60 * 60 * 1000 // 24 hours
    });

    return sessionId;
  }

  async get(sessionId: string): Promise<any | null> {
    const entry = await this.db.get(['sessions', sessionId]);
    return entry.value;
  }

  async destroy(sessionId: string): Promise<void> {
    await this.db.delete(['sessions', sessionId]);
  }

  async extend(sessionId: string): Promise<boolean> {
    const entry = await this.db.get(['sessions', sessionId]);
    if (entry.value === null) return false;

    await this.db.set(['sessions', sessionId], entry.value, {
      expireIn: 24 * 60 * 60 * 1000
    });

    return true;
  }
}
```

### Caching Layer

```typescript
class Cache<T> {
  constructor(
    private db: Valkeyrie,
    private prefix: Key,
    private ttl: number
  ) {}

  async get(key: string): Promise<T | null> {
    const entry = await this.db.get([...this.prefix, key]);
    return entry.value as T | null;
  }

  async set(key: string, value: T): Promise<void> {
    await this.db.set([...this.prefix, key], value, {
      expireIn: this.ttl
    });
  }

  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const value = await fetcher();
    await this.set(key, value);
    return value;
  }

  async invalidate(key: string): Promise<void> {
    await this.db.delete([...this.prefix, key]);
  }

  async invalidatePattern(pattern: Key): Promise<void> {
    for await (const entry of this.db.list({ prefix: [...this.prefix, ...pattern] })) {
      await this.db.delete(entry.key);
    }
  }
}

// Usage
const userCache = new Cache<User>(db, ['cache', 'users'], 300_000); // 5 min

const user = await userCache.getOrFetch('alice', async () => {
  return await fetchUserFromAPI('alice');
});
```

### Event Sourcing

```typescript
class EventStore {
  constructor(private db: Valkeyrie) {}

  async appendEvent(streamId: string, event: any): Promise<void> {
    const timestamp = Date.now();
    const eventId = crypto.randomUUID();

    await this.db.set(['events', streamId, timestamp, eventId], {
      ...event,
      timestamp,
      eventId
    });
  }

  async *getEvents(streamId: string) {
    for await (const entry of this.db.list({ prefix: ['events', streamId] })) {
      yield entry.value;
    }
  }

  async getSnapshot(streamId: string): Promise<any> {
    const entry = await this.db.get(['snapshots', streamId]);
    return entry.value;
  }

  async saveSnapshot(streamId: string, state: any): Promise<void> {
    await this.db.set(['snapshots', streamId], {
      state,
      timestamp: Date.now()
    });
  }
}
```

## Performance Optimization

### Batch Operations

```typescript
// ❌ Slow: Individual operations
for (const item of items) {
  await db.set(['items', item.id], item);
}

// ✅ Fast: Batch with atomic
const atomic = db.atomic();
for (const item of items) {
  atomic.set(['items', item.id], item);
}
await atomic.commit();
```

### Smart Caching

```typescript
class SmartCache {
  private memoryCache = new Map();

  async get(key: Key): Promise<any> {
    const keyStr = JSON.stringify(key);

    // Check memory first
    if (this.memoryCache.has(keyStr)) {
      return this.memoryCache.get(keyStr);
    }

    // Then check database
    const entry = await this.db.get(key);
    if (entry.value !== null) {
      this.memoryCache.set(keyStr, entry.value);
    }

    return entry.value;
  }

  invalidate(key: Key): void {
    this.memoryCache.delete(JSON.stringify(key));
  }
}
```

### Connection Pooling

```typescript
class DatabasePool {
  private connections: Valkeyrie[] = [];

  async acquire(): Promise<Valkeyrie> {
    if (this.connections.length > 0) {
      return this.connections.pop()!;
    }
    return await Valkeyrie.open('./data.db');
  }

  release(db: Valkeyrie): void {
    this.connections.push(db);
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.connections.map(db => db.close()));
  }
}
```

## Summary

You've learned:

- ✅ Real-time monitoring with the Watch API
- ✅ Atomic operations for consistency
- ✅ Optimistic concurrency control
- ✅ Numeric operations with KvU64
- ✅ Multi-instance safety
- ✅ Real-world patterns for common use cases
- ✅ Performance optimization techniques

Next steps:
- **[API Reference](../api/api-reference.md)** - Complete method documentation
- **[Types Reference](../api/types.md)** - TypeScript type definitions
