import IORedis from 'ioredis';

/**
 * BullMQ v6 treats ioredis as optional and resolves it from its own package
 * directory, which fails under pnpm's isolated node_modules. Constructing the
 * client in our workspace and handing the instance over avoids that resolution
 * and lets us control retry/blocking behavior explicitly.
 */
export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
