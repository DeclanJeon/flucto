type CacheEntry<T> = {
  expiresAt: number;
  value: T;
  approxSizeBytes: number;
};

export class TranscriptCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxEntryBytes: number;

  constructor(maxEntries = 1000, ttlMs = 3_600_000, maxEntryBytes = 5 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.maxEntryBytes = maxEntryBytes;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    const approxSizeBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (approxSizeBytes > this.maxEntryBytes) {
      return;
    }

    if (this.entries.size >= this.maxEntries) {
      const firstKey = this.entries.keys().next().value as string | undefined;
      if (firstKey) {
        this.entries.delete(firstKey);
      }
    }

    this.entries.set(key, {
      expiresAt: Date.now() + this.ttlMs,
      value,
      approxSizeBytes,
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
