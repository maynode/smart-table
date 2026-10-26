import type { LiveEvent } from 'shared';

const CHANNEL = 'st-live-bus';
const LOCK_PREFIX = 'st-live-leader:';

export type LiveScopeOpts = {
  workspaceId?: string;
  baseId?: string;
  publicToken?: string;
  formToken?: string;
  userOnly?: boolean;
};

export type LiveTabBridgeMsg =
  | {
      type: 'live_event';
      scope: string;
      event: LiveEvent;
      fromTab: string;
    }
  | {
      type: 'leader_hello';
      scope: string;
      tabId: string;
    };

export type LiveRemoteHandler = (scope: string, event: LiveEvent) => void;
export type LiveLeaderHelloHandler = (scope: string, tabId: string) => void;

/** 把连接参数压成锁 / 广播作用域键（同 scope 多 Tab 只开一条 WS） */
export function liveScopeKey(opts: LiveScopeOpts): string {
  if (opts.publicToken) return `pv:${opts.publicToken}`;
  if (opts.formToken) return `form:${opts.formToken}`;
  if (opts.userOnly) return 'user';
  const parts: string[] = [];
  if (opts.baseId) parts.push(`base:${opts.baseId}`);
  if (opts.workspaceId) parts.push(`ws:${opts.workspaceId}`);
  return parts.length ? parts.join('|') : 'none';
}

/**
 * 多 Tab Live 镜像：
 * - 每个 scope 用 navigator.locks 选一个 leader 持 WS
 * - leader 收到事件后 BroadcastChannel 推给同 scope 的 follower
 * - 无 BC / locks 时退化为每 Tab 自连（与 P3 行为一致）
 */
export class LiveTabBridge {
  readonly tabId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  private channel: BroadcastChannel | null = null;
  private readonly remoteHandlers = new Set<LiveRemoteHandler>();
  private readonly leaderHelloHandlers = new Set<LiveLeaderHelloHandler>();
  private readonly lockAborts = new Map<string, AbortController>();
  private readonly leading = new Set<string>();

  get supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof BroadcastChannel !== 'undefined'
    );
  }

  private ensureChannel(): BroadcastChannel | null {
    if (!this.supported) return null;
    if (this.channel) return this.channel;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (ev: MessageEvent<LiveTabBridgeMsg>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'live_event') {
        if (msg.fromTab === this.tabId) return;
        for (const handler of this.remoteHandlers) {
          try {
            handler(msg.scope, msg.event);
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (msg.type === 'leader_hello') {
        if (msg.tabId === this.tabId) return;
        for (const handler of this.leaderHelloHandlers) {
          try {
            handler(msg.scope, msg.tabId);
          } catch {
            /* ignore */
          }
        }
      }
    };
    return this.channel;
  }

  onRemoteEvent(handler: LiveRemoteHandler): () => void {
    this.ensureChannel();
    this.remoteHandlers.add(handler);
    return () => this.remoteHandlers.delete(handler);
  }

  /** 其它 Tab 升主时通知（follower 可再 HTTP 补洞） */
  onLeaderHello(handler: LiveLeaderHelloHandler): () => void {
    this.ensureChannel();
    this.leaderHelloHandlers.add(handler);
    return () => this.leaderHelloHandlers.delete(handler);
  }

  isLeader(scope: string): boolean {
    return this.leading.has(scope);
  }

  /** Leader 把已接收事件镜像给其它 Tab（本 Tab 不回环） */
  broadcast(scope: string, event: LiveEvent): void {
    const channel = this.ensureChannel();
    if (!channel) return;
    const msg: LiveTabBridgeMsg = {
      type: 'live_event',
      scope,
      event,
      fromTab: this.tabId,
    };
    try {
      channel.postMessage(msg);
    } catch {
      /* closed */
    }
  }

  /**
   * 争夺 scope 领导权。返回 release；release 后其它 Tab 可升主。
   * 无 locks API 时立即 onLeader（单 Tab 行为）。
   */
  claim(
    scope: string,
    handlers: {
      onLeader: () => void;
      onFollower: () => void;
    },
  ): () => void {
    this.release(scope);
    this.ensureChannel();

    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!this.supported || !locks?.request) {
      this.leading.add(scope);
      this.announceLeader(scope);
      handlers.onLeader();
      return () => {
        this.leading.delete(scope);
      };
    }

    const ac = new AbortController();
    this.lockAborts.set(scope, ac);
    handlers.onFollower();

    void locks
      .request(LOCK_PREFIX + scope, { signal: ac.signal }, async () => {
        if (ac.signal.aborted) return;
        this.leading.add(scope);
        this.announceLeader(scope);
        handlers.onLeader();
        await new Promise<void>((resolve) => {
          if (ac.signal.aborted) {
            resolve();
            return;
          }
          ac.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      })
      .catch(() => {
        /* aborted */
      })
      .finally(() => {
        this.leading.delete(scope);
        if (this.lockAborts.get(scope) === ac) {
          this.lockAborts.delete(scope);
        }
      });

    return () => this.release(scope);
  }

  private announceLeader(scope: string): void {
    const channel = this.ensureChannel();
    if (!channel) return;
    try {
      channel.postMessage({
        type: 'leader_hello',
        scope,
        tabId: this.tabId,
      } satisfies LiveTabBridgeMsg);
    } catch {
      /* ignore */
    }
  }

  release(scope: string): void {
    const ac = this.lockAborts.get(scope);
    if (ac) {
      this.lockAborts.delete(scope);
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
    }
    this.leading.delete(scope);
  }

  releaseAll(): void {
    for (const scope of [...this.lockAborts.keys()]) {
      this.release(scope);
    }
  }
}

export const liveTabBridge = new LiveTabBridge();
