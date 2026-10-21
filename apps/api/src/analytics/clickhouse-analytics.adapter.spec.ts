import { ClickHouseAnalyticsAdapter } from './clickhouse-analytics.adapter';

describe('ClickHouseAnalyticsAdapter', () => {
  it('issues an aggregate JSON query and maps rows', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          data: [
            { label: '华东', value: '12.5' },
            { label: '华南', value: '3' },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const adapter = new ClickHouseAnalyticsAdapter({
      url: 'http://clickhouse:8123/',
      database: 'smart_table',
      username: 'default',
      fetcher,
    });

    const rows = await adapter.query({
      sheetId: '11111111-1111-1111-1111-111111111111',
      dimensionFieldId: 'region',
      metricFieldId: 'amount',
      aggregation: 'sum',
      limit: 10,
    });

    expect(rows).toEqual([
      { label: '华东', value: 12.5 },
      { label: '华南', value: 3 },
    ]);
    const body = String(calls[0]?.init?.body ?? '');
    expect(body).toContain("JSONExtractString(cells, 'region')");
    expect(body).toContain("sum(toFloat64OrZero(JSONExtractString(cells, 'amount')))");
    expect(body).toContain('LIMIT 10');
    expect(calls[0]?.url).toContain('database=smart_table');
  });

  it('surfaces ClickHouse HTTP failures', async () => {
    const adapter = new ClickHouseAnalyticsAdapter({
      url: 'http://clickhouse:8123',
      fetcher: (async () => ({
        ok: false,
        status: 500,
        text: async () => 'boom',
      })) as unknown as typeof fetch,
    });
    await expect(
      adapter.query({
        sheetId: '11111111-1111-1111-1111-111111111111',
        dimensionFieldId: 'region',
        aggregation: 'count',
      }),
    ).rejects.toThrow('ClickHouse query failed: 500 boom');
  });
});
