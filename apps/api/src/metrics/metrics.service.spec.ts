import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders counters, gauges, and duration percentiles', () => {
    const m = new MetricsService();
    m.increment('form_submit_total', { status: 'ok' });
    m.setGauge('collab_connections', 3);
    m.setGauge('collab_sheet_connections', 2, { sheet_id: 's1' });
    for (const v of [10, 20, 30, 40, 100]) {
      m.observe('collab_accept_duration_ms', v);
    }
    m.increment('collab_conflict_total', { reason: 'version' });

    const text = m.render();
    expect(text).toContain('form_submit_total{status="ok"} 1');
    expect(text).toContain('collab_connections 3');
    expect(text).toContain('collab_sheet_connections{sheet_id="s1"} 2');
    expect(text).toContain('collab_accept_duration_ms_count 5');
    expect(text).toContain('collab_accept_duration_ms_p95 100');
    expect(text).toContain('collab_conflict_total{reason="version"} 1');
  });
});
