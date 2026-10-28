/**
 * Coalesce high-frequency events: keep latest payload per key, flush at most
 * once per minIntervalMs (COLLAB-SCALE S5 cursor/presence downsampling).
 */
export class CoalesceThrottle<T> {
  private readonly pending = new Map<string, T>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastFlush = new Map<string, number>();
  private dropped = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly onFlush: (key: string, value: T) => void,
  ) {}

  get droppedCount(): number {
    return this.dropped;
  }

  push(key: string, value: T, now = Date.now()): void {
    const hadPending = this.pending.has(key);
    this.pending.set(key, value);
    if (hadPending) this.dropped += 1;
    if (this.timers.has(key)) return;

    const last = this.lastFlush.get(key) ?? 0;
    const wait = Math.max(0, this.minIntervalMs - (now - last));
    const timer = setTimeout(() => {
      this.timers.delete(key);
      const latest = this.pending.get(key);
      this.pending.delete(key);
      if (latest === undefined) return;
      this.lastFlush.set(key, Date.now());
      this.onFlush(key, latest);
    }, wait);
    // Don't keep the process alive solely for throttle timers.
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
    this.timers.set(key, timer);
  }

  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
  }
}
