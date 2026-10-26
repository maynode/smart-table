import type { LiveEvent } from 'shared';

export type LiveHandler = (event: LiveEvent) => void;

type Entry = {
  pattern: string;
  handler: LiveHandler;
};

/**
 * In-process pub/sub for Base Live events.
 * Patterns: exact kind, or prefix ending with `.*` (e.g. `sheet.*`).
 */
class LiveBus {
  private readonly entries: Entry[] = [];
  private readonly seen = new Set<string>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debouncePending = new Map<string, LiveEvent>();

  on(pattern: string, handler: LiveHandler): () => void {
    const entry: Entry = { pattern, handler };
    this.entries.push(entry);
    return () => {
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) this.entries.splice(idx, 1);
    };
  }

  /** Dispatch with eventId dedupe + 300ms debounce per kind+entityId */
  dispatch(event: LiveEvent): void {
    if (this.seen.has(event.eventId)) return;
    this.seen.add(event.eventId);
    if (this.seen.size > 4000) {
      const first = this.seen.values().next().value as string;
      this.seen.delete(first);
    }
    const key = `${event.kind}:${event.entityId ?? ''}`;
    this.debouncePending.set(key, event);
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        const latest = this.debouncePending.get(key);
        this.debouncePending.delete(key);
        if (latest) this.fanout(latest);
      }, 300),
    );
  }

  /** Immediate fanout without debounce (for catchup batches) */
  dispatchNow(event: LiveEvent): void {
    if (this.seen.has(event.eventId)) return;
    this.seen.add(event.eventId);
    this.fanout(event);
  }

  private fanout(event: LiveEvent): void {
    for (const entry of this.entries) {
      if (!matchKind(entry.pattern, event.kind)) continue;
      try {
        entry.handler(event);
      } catch {
        /* ignore handler errors */
      }
    }
  }
}

function matchKind(pattern: string, kind: string): boolean {
  if (pattern === '*' || pattern === kind) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1); // keep trailing dot → "sheet."
    return kind.startsWith(prefix);
  }
  return false;
}

export const liveBus = new LiveBus();
