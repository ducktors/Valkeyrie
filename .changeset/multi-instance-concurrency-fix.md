---
"valkeyrie": patch
---

Implement database-level versionstamp generation for multi-instance concurrency and fix watch stream cancel bug

**Multi-Instance Concurrency (fixes #64):**
- Implement database-level sequence table for atomic versionstamp generation across multiple instances
- Replace process-local versionstamp generation with SQLite sequence-based approach  
- Add proper transaction nesting support with `inTransaction` state tracking
- Implement retry logic for versionstamp generation with exponential backoff
- Use `BEGIN IMMEDIATE TRANSACTION` for exclusive database locks to ensure cross-process atomicity
- Maintain 20-character versionstamp format (timestamp + sequence) for API compatibility

**Bug Fix:**
- Fix watch stream `cancel()` callback to correctly use closure-scoped controller
- Remove incorrect `controller.close()` call in cancel handler (stream infrastructure handles this)

**Test Coverage:**
- Add test for concurrent versionstamp generation with multiple driver instances
- Add test for watch controller close errors with unexpected error types
- Add test for rollback failures in transaction retry logic  
- Update watch cancellation test to properly test the cancel path

This prevents race conditions and lost updates when multiple Valkeyrie instances share the same SQLite database file.
