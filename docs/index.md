---
layout: home

hero:
  name: "Valkeyrie"
  text: "Type-safe key-value store"
  tagline: "Runtime schema validation with pluggable storage drivers for Node.js"
  image:
    src: /logo.png
    alt: Valkeyrie Logo
  actions:
    - theme: brand
      text: Get Started
      link: /guides/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/ducktors/valkeyrie
    - theme: alt
      text: API Reference
      link: /api/api-reference

features:
  - icon: 🛡️
    title: Type-safe with Schema Validation
    details: Runtime validation with Zod, Valibot, ArkType, and other Standard Schema libraries. Ensure data integrity at every operation.

  - icon: 🔮
    title: Automatic Type Inference
    details: Full TypeScript support with schema-based type inference across all operations. No manual type definitions needed.

  - icon: ⚛️
    title: Atomic Operations
    details: Perform multiple operations in a single transaction with optimistic locking and automatic rollback on conflicts.

  - icon: 👀
    title: Real-time Updates
    details: Watch keys for changes with the reactive watch() API. Get notified immediately when values change.

  - icon: 🔌
    title: Pluggable Storage Drivers
    details: Built on SQLite with a driver architecture designed for extensibility. More drivers coming soon.

  - icon: 🔒
    title: Multi-instance Safe
    details: Proper concurrency control and version tracking for safe access from multiple processes or instances.

  - icon: 🚀
    title: Serialization Options
    details: Choose from JSON, V8, BSON, MessagePack, or CBOR serializers based on your performance and compatibility needs.

  - icon: 📦
    title: Factory Methods
    details: Simplify instance creation with built-in factory methods for common use cases. Start coding faster.

  - icon: 🎯
    title: Developer Experience
    details: Intuitive API design with excellent error messages, comprehensive docs, and TypeScript-first development.
---

## Quick Start

Install Valkeyrie in your project:

::: code-group
```bash [npm]
npm install valkeyrie
```

```bash [pnpm]
pnpm add valkeyrie
```

```bash [yarn]
yarn add valkeyrie
```
:::

Create a type-safe key-value store with schema validation:

```typescript
import { ValkeyrieBuilder } from 'valkeyrie'
import { z } from 'zod'

// Define your schema with Zod (or Valibot, ArkType, etc.)
const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0)
})

// Create a Valkeyrie instance
const kv = new ValkeyrieBuilder()
  .withDriver('sqlite', { path: './my-data.db' })
  .build()

// Define a key with a schema
const userKey = kv.key('user', userSchema)

// Set a value - automatically validated!
await userKey.set({ name: 'Alice', email: 'alice@example.com', age: 30 })

// Get the value - fully typed!
const user = await userKey.get() // Type: { name: string, email: string, age: number } | null

// Watch for changes
for await (const entry of userKey.watch()) {
  console.log('User updated:', entry.value)
}
```

## Why Valkeyrie?

Valkeyrie brings the best of both worlds: the simplicity of key-value stores and the safety of runtime schema validation.

### 🔐 Runtime Safety

Never trust input data again. Valkeyrie validates every value against your schema at runtime, catching bugs before they become problems.

### 💎 Type Inference Magic

Define your schema once, get TypeScript types everywhere. No more maintaining parallel type definitions.

### ⚡ Atomic Transactions

Modify multiple keys in a single atomic operation with automatic conflict resolution. No more race conditions.

### 🎨 Flexible Serialization

Choose the serializer that fits your needs:
- **JSON**: Maximum compatibility
- **V8**: Best performance for Node.js
- **BSON, MessagePack, CBOR**: Efficient binary formats

## What's Next?

<div class="vp-doc">

- 📚 Read the [Getting Started Guide](/guides/getting-started) to learn the basics
- 🔍 Explore [Schema Validation](/guides/schema-validation) for different schema libraries
- ⚙️ Learn about [Factory Methods](/guides/factory-methods) for easier setup
- 🎯 Check out [Advanced Patterns](/guides/advanced-patterns) for real-world use cases
- 📖 Browse the [API Reference](/api/api-reference) for complete documentation

</div>

## License

MIT © [Ducktors](https://github.com/ducktors)
