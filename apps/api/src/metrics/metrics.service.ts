import { Injectable } from '@nestjs/common';

/**
 * Minimal Prometheus text exposition. Counters/histograms use OTel-style names
 * so a collector (or the k8s scrape annotations in deploy/k8s) can pick them up
 * without an extra sidecar; add an OTLP exporter when a collector is required.
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; sum: number }>();
  /** Ring buffers for approximate percentiles (p50/p95/p99) on scrape. */
  private readonly samples = new Map<string, number[]>();
  private readonly sampleCap = 2048;

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  setGauge(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    const key = this.key(name, labels);
    this.gauges.set(key, value);
  }

  observe(name: string, valueMs: number, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    const safe = Math.max(0, valueMs);
    const current = this.durations.get(key) ?? { count: 0, sum: 0 };
    this.durations.set(key, {
      count: current.count + 1,
      sum: current.sum + safe,
    });
    const buf = this.samples.get(key) ?? [];
    if (buf.length >= this.sampleCap) buf.shift();
    buf.push(safe);
    this.samples.set(key, buf);
  }

  render(): string {
    const lines: string[] = [];
    for (const [key, value] of this.counters.entries()) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of this.gauges.entries()) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of this.durations.entries()) {
      lines.push(`${key}_count ${value.count}`);
      lines.push(`${key}_sum ${value.sum}`);
      const buf = this.samples.get(key);
      if (buf && buf.length > 0) {
        const sorted = [...buf].sort((a, b) => a - b);
        lines.push(`${key}_p50 ${percentile(sorted, 0.5)}`);
        lines.push(`${key}_p95 ${percentile(sorted, 0.95)}`);
        lines.push(`${key}_p99 ${percentile(sorted, 0.99)}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private key(name: string, labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return name;
    const rendered = entries
      .map(([label, value]) => `${label}="${value.replace(/"/g, "'")}"`)
      .join(',');
    return `${name}{${rendered}}`;
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil(p * sortedAsc.length) - 1),
  );
  return sortedAsc[idx] ?? 0;
}
