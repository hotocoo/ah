# LRU cache

Implement `LRUCache<K, V>` in `src/lru.ts` (export it by name):

- `constructor(capacity: number)` — throws `RangeError` if capacity < 1.
- `get(key): V | undefined` — returns the value and marks the key most recently used.
- `set(key, value): void` — inserts/updates and marks most recently used; when over capacity, evicts the least recently used entry.
- `has(key): boolean` — does NOT change recency.
- `delete(key): boolean`
- `size: number` (getter)
- `keys(): K[]` — from least to most recently used.
- `onEvict?: (key, value) => void` — optional constructor 2nd argument, called for each eviction.

All operations must be O(1) average.
