---
"valkeyrie": patch
---

Complete documentation overhaul with new structure and missing feature documentation

**New Documentation Structure:**
- Split monolithic docs into focused guides and API reference
- Created beginner-friendly getting started guide
- Added comprehensive guides for schema validation, factory methods, serializers, and advanced patterns
- Complete API reference with all methods and types

**Previously Missing Documentation:**
- **Watch API** - Complete documentation for real-time key monitoring (added in v0.5.0)
- **Type Inference** - Automatic TypeScript type inference from schemas
- **Multi-instance Concurrency** - Database-level versionstamp generation improvements (v0.7.2)
- **Symbol.asyncDispose** - Automatic resource management support

**New Guides:**
- `docs/guides/getting-started.md` - Complete beginner tutorial
- `docs/guides/schema-validation.md` - Type-safe operations with Zod, Valibot, ArkType
- `docs/guides/factory-methods.md` - Create databases from arrays and streams
- `docs/guides/serializers.md` - Choose and configure serializers
- `docs/guides/advanced-patterns.md` - Watch API, atomic operations, real-world patterns

**API Reference:**
- `docs/api/api-reference.md` - Complete method reference
- `docs/api/types.md` - TypeScript types and interfaces

**Improvements:**
- Clear navigation with `docs/README.md` index
- Real-world examples throughout
- Decision trees for choosing options
- Migration guides from Deno.kv
- Troubleshooting sections

The old `docs/documentation.md` has been archived as `docs/documentation.md.old`.
