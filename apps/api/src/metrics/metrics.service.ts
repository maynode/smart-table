import { Injectable } from '@nestjs/common';

/**
 * Minimal Prometheus text exposition. Counters/histograms use OTel-style names
 * so a collector (or the k8s scrape annotations in deploy/k8s) can pick them up
 * without an extra sidecar; add an OTLP exporter when a collector is required.
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; sum: number }>();

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  observe(name: string, valueMs: number, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    const current = this.durations.get(key) ?? { count: 0, sum: 0 };
    this.durations.set(key, {
      count: current.count + 1,
      sum: current.sum + Math.max(0, valueMs),
    });
  }

  render(): string {
    const lines: string[] = [];
    for (const [key, value] of this.counters.entries()) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of this.durations.entries()) {
      lines.push(`${key}_count ${value.count}`);
      lines.push(`${key}_sum ${value.sum}`);
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
