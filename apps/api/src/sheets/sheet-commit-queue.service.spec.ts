import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service';
import type { CommitChangesService } from './commit-changes.service';
import { SheetCommitQueue } from './sheet-commit-queue.service';

function memoryQueue(
  commits?: Partial<CommitChangesService>,
): SheetCommitQueue {
  return new SheetCommitQueue(
    new MetricsService(),
    new ConfigService({ COLLAB_SHEET_ACTOR: 'memory' }),
    commits as CommitChangesService,
  );
}

describe('SheetCommitQueue', () => {
  it('serializes tasks for the same sheetId', async () => {
    const q = memoryQueue();
    const order: number[] = [];
    const slow = q.run('s1', async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
      return 'a';
    });
    const fast = q.run('s1', async () => {
      order.push(3);
      return 'b';
    });
    await expect(Promise.all([slow, fast])).resolves.toEqual(['a', 'b']);
    expect(order).toEqual([1, 2, 3]);
    expect(q.depth('s1')).toBe(0);
  });

  it('allows different sheets to run in parallel', async () => {
    const q = memoryQueue();
    let released = false;
    const gate = new Promise<void>((resolve) => {
      setTimeout(() => {
        released = true;
        resolve();
      }, 40);
    });
    const a = q.run('a', async () => {
      await gate;
      return 'a';
    });
    const bStarted = { value: false };
    const b = q.run('b', async () => {
      bStarted.value = true;
      return 'b';
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(bStarted.value).toBe(true);
    expect(released).toBe(false);
    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b']);
  });

  it('enqueue in memory mode delegates to executeCommitJob', async () => {
    const executeCommitJob = jest.fn(async () => ({
      clientBatchId: 'b1',
      results: [],
    }));
    const q = memoryQueue({ executeCommitJob });
    const result = await q.enqueue({
      sheetId: 's1',
      userId: 'u1',
      dto: { clientBatchId: 'b1', mutations: [] },
      clientIp: '0.0.0.0',
    });
    expect(executeCommitJob).toHaveBeenCalledTimes(1);
    expect(result.clientBatchId).toBe('b1');
    expect(q.isBullmq()).toBe(false);
  });
});
