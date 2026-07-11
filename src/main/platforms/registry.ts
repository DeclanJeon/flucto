import type { PlatformAdapter } from './types.js';

export class PlatformRegistry {
  private adapters: PlatformAdapter[] = [];

  register(adapter: PlatformAdapter): void {
    if (this.adapters.some(a => a.id === adapter.id)) {
      return;
    }
    this.adapters.push(adapter);
    this.adapters.sort((a, b) => b.priority - a.priority);
  }

  resolve(url: string): PlatformAdapter | null {
    return this.adapters.find(a => a.matchUrl(url)) ?? null;
  }

  list(): ReadonlyArray<PlatformAdapter> {
    return this.adapters;
  }

  supports(url: string): boolean {
    return this.resolve(url) !== null;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.adapters.filter(a => a.dispose).map(a => a.dispose!()));
  }
}
