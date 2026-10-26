import IORedis from 'ioredis';

/**
 * BullMQ v6 treats ioredis as optional and resolves it from its own package
 * directory, which fails under pnpm's isolated node_modules. Constructing the
 * client in our workspace and handing the instance over avoids that resolution
 * and lets us control retry/blocking behavior explicitly.
 */
export function createRedisConnection(
  url: string,
  options?: {
    connectTimeoutMs?: number;
    maxRetriesPerRequest?: number | null;
    /** false：旁路通道连不上时不排队（默认 true 兼容 BullMQ） */
    enableOfflineQueue?: boolean;
  },
): IORedis {
  return new IORedis(url, {
    maxRetriesPerRequest:
      options?.maxRetriesPerRequest === undefined
        ? null
        : options.maxRetriesPerRequest,
    enableReadyCheck: false,
    connectTimeout: options?.connectTimeoutMs ?? 10_000,
    enableOfflineQueue: options?.enableOfflineQueue ?? true,
  });
}
