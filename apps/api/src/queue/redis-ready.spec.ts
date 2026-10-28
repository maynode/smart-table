import type IORedis from 'ioredis';
import { EventEmitter } from 'node:events';
import { waitForRedisReady } from './redis-ready';

class FakeRedis extends EventEmitter {
  status = 'connecting';
}

describe('waitForRedisReady', () => {
  it('resolves immediately when already ready', async () => {
    const client = new FakeRedis() as unknown as IORedis;
    (client as unknown as FakeRedis).status = 'ready';
    await expect(waitForRedisReady(client, 100)).resolves.toBeUndefined();
  });

  it('resolves on ready event', async () => {
    const fake = new FakeRedis();
    const client = fake as unknown as IORedis;
    const pending = waitForRedisReady(client, 500);
    setTimeout(() => {
      fake.status = 'ready';
      fake.emit('ready');
    }, 0);
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects on timeout', async () => {
    const client = new FakeRedis() as unknown as IORedis;
    await expect(waitForRedisReady(client, 30)).rejects.toThrow(/timeout/);
  });
});
