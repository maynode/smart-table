import type IORedis from 'ioredis';

/**
 * Wait until ioredis reports `ready` before issuing commands.
 * Required when `enableOfflineQueue: false` — otherwise psubscribe/ping
 * fail with "Stream isn't writeable" during the TCP handshake.
 */
export function waitForRedisReady(
  client: IORedis,
  timeoutMs = 5_000,
): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('end', onFail);
      client.off('close', onFail);
      fn();
    };
    const onReady = () => finish(() => resolve());
    const onFail = () =>
      finish(() =>
        reject(new Error(`redis closed before ready (status=${client.status})`)),
      );
    const timer = setTimeout(() => {
      finish(() => reject(new Error('redis ready timeout')));
    }, timeoutMs);
    client.once('ready', onReady);
    client.once('end', onFail);
    client.once('close', onFail);
    // Status may flip to ready between the check and listener attach.
    if (client.status === 'ready') onReady();
  });
}
