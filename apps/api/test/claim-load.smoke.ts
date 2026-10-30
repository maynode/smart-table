/**
 * Claim load smoke: N concurrent submissions against N unclaimed codes.
 * Default 100 concurrent / 50 codes; set PERF_CODES=1000 and
 * PERF_CONCURRENCY=1000 for the Task 26 gate.
 *
 * Run with:
 *   pnpm --filter api exec dotenv -e ../../.env -- \
 *     ts-node --transpile-only test/claim-load.smoke.ts
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';

process.env.PUBLIC_SUBMIT_RATE_LIMIT = '10000';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const CODE_COUNT = Number(process.env.PERF_CODES ?? 50);
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? CODE_COUNT * 2);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const http = () => request(app.getHttpServer());

  try {
    const stamp = Date.now();
    const owner = await http()
      .post('/auth/register')
      .send({
        account: `load${stamp}`,
        password: 'Passw0rd!123',
                securityQuestion: '你小学就读的学校名称是？', securityAnswer: 'demo',
        });
    const token = owner.body.accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    const workspace = await http()
      .post('/workspaces')
      .set(auth)
      .send({ name: `压测工作区${stamp}` });
    const base = await http()
      .post(`/workspaces/${workspace.body.id}/bases`)
      .set(auth)
      .send({ name: '压测 Base' });
    const formSheet = await http()
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth)
      .send({ name: '收集表单', seed: false });
    const phone = await http()
      .post(`/sheets/${formSheet.body.id}/fields`)
      .set(auth)
      .send({ name: '手机号', type: 'phone' });
    const codeSheet = await http()
      .post(`/bases/${base.body.id}/sheets`)
      .set(auth)
      .send({ name: '码库', seed: false });
    const serial = await http()
      .post(`/sheets/${codeSheet.body.id}/fields`)
      .set(auth)
      .send({ name: '序列号', type: 'text' });
    const status = await http()
      .post(`/sheets/${codeSheet.body.id}/fields`)
      .set(auth)
      .send({
        name: '状态',
        type: 'select',
        options: {
          choices: [
            { id: 'unclaimed', name: '未领' },
            { id: 'claimed', name: '已领' },
          ],
        },
      });
    const claimedPhone = await http()
      .post(`/sheets/${codeSheet.body.id}/fields`)
      .set(auth)
      .send({ name: '领取手机号', type: 'phone' });

    const serials = Array.from(
      { length: CODE_COUNT },
      (_, index) => `LOAD-${String(index + 1).padStart(3, '0')}`,
    );
    for (const value of serials) {
      await http()
        .post(`/sheets/${codeSheet.body.id}/records`)
        .set(auth)
        .send({ cells: { [serial.body.id]: value, [status.body.id]: 'unclaimed' } });
    }

    const form = await http()
      .post(`/forms/${randomUUID()}`)
      .set(auth)
      .send({
        baseId: base.body.id,
        sheetId: formSheet.body.id,
        name: '压测领取',
        fields: [{ fieldId: phone.body.id, required: true }],
        share: { enabled: true, audience: 'anyone' },
        successPage: { templateHtml: '序列号：{{序列号}}' },
      });
    await http()
      .post('/automations')
      .set(auth)
      .send({
        baseId: base.body.id,
        name: '压测占码',
        onFindEmpty: 'stop',
        trigger: {
          type: 'recordCreated',
          sheetId: formSheet.body.id,
          filters: {
            conjunction: 'and',
            conditions: [{ fieldId: phone.body.id, operator: 'isNotEmpty' }],
          },
        },
        steps: [
          {
            id: 'find-code',
            type: 'findRecords',
            sheetId: codeSheet.body.id,
            filters: {
              conjunction: 'and',
              conditions: [
                { fieldId: status.body.id, operator: 'equals', value: 'unclaimed' },
              ],
            },
          },
          {
            id: 'claim-code',
            type: 'modifyRecords',
            target: { mode: 'fromStep', stepId: 'find-code' },
            cells: {
              [status.body.id]: { kind: 'literal', value: 'claimed' },
              [claimedPhone.body.id]: {
                kind: 'variable',
                variable: { source: 'trigger', field: '手机号' },
              },
            },
          },
        ],
      })
      .expect(201);

    const shareToken = form.body.share.token;
    const latencies: number[] = [];
    const startedAt = Date.now();

    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, index) => {
        const begin = Date.now();
        const response = await fetch(
          `${baseUrl}/public/forms/${shareToken}/submit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cells: {
                [phone.body.id]: `135${String(index).padStart(8, '0')}`,
              },
            }),
            signal: AbortSignal.timeout(120_000),
          },
        );
        const body = (await response.json()) as Record<string, unknown>;
        latencies.push(Date.now() - begin);
        return { status: response.status, body };
      }),
    );

    const successes = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    const other = responses.filter(
      (response) => response.status !== 201 && response.status !== 409,
    );

    const claimedSerials = successes.map(
      (response) => response.body.stepOutputs?.['序列号'] as string,
    );
    const unique = new Set(claimedSerials);

    const claimedRows: Array<{ claimStatus: string | null }> = [];
    let cursor: string | null = null;
    do {
      const page = await http()
        .get(
          `/sheets/${codeSheet.body.id}/records?limit=200${
            cursor ? `&cursor=${cursor}` : ''
          }`,
        )
        .set(auth);
      assert(page.status === 200, `list records failed: ${page.status}`);
      assert(
        Array.isArray(page.body.records),
        `list records missing records: ${JSON.stringify(page.body)}`,
      );
      claimedRows.push(...(page.body.records as typeof claimedRows));
      cursor = page.body.nextCursor as string | null;
    } while (cursor);
    const claimed = claimedRows.filter(
      (record) => record.claimStatus === 'claimed',
    );

    const summary = {
      codes: CODE_COUNT,
      concurrency: CONCURRENCY,
      success: successes.length,
      conflict: conflicts.length,
      otherStatuses: other.map((response) => response.status),
      uniqueSerials: unique.size,
      claimedRows: claimed.length,
      durationMs: Date.now() - startedAt,
      latencyMs: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        max: Math.max(...latencies),
      },
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));

    assert(successes.length === CODE_COUNT, `expected ${CODE_COUNT} successes, got ${successes.length}`);
    assert(conflicts.length === CONCURRENCY - CODE_COUNT, `expected ${CONCURRENCY - CODE_COUNT} conflicts, got ${conflicts.length}`);
    assert(other.length === 0, `unexpected statuses: ${summary.otherStatuses.join(',')}`);
    assert(unique.size === CODE_COUNT, `expected ${CODE_COUNT} unique serials, got ${unique.size}`);
    assert(claimed.length === CODE_COUNT, `expected ${CODE_COUNT} claimed rows, got ${claimed.length}`);
    for (const response of conflicts) {
      assert(
        String(response.body.message).includes('领取完毕'),
        'conflict must explain exhaustion',
      );
    }

    // eslint-disable-next-line no-console
    console.log('claim load smoke passed');
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
