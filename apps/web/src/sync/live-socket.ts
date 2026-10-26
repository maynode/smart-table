import { ref, type Ref } from 'vue';
import type { LiveClientMsg, LiveEvent, LiveServerMsg } from 'shared';
import { api, getToken } from '../api/client';
import { liveBus } from './live-bus';
import { liveScopeKey, liveTabBridge } from './live-tab-bridge';
import { resolveApiWsBase } from './ws-base';

export type LiveConnectOpts = {
  workspaceId?: string;
  baseId?: string;
  publicToken?: string;
  formToken?: string;
  /** 仅 JWT 用户房（通知页） */
  userOnly?: boolean;
};

type CatchupTarget = {
  key: string;
  path: string;
  token?: string | null;
  wsScope?: 'base' | 'workspace' | 'user';
};

export class LiveSocket {
  readonly connected: Ref<boolean> = ref(false);
  readonly latestSeq: Ref<number> = ref(0);
  readonly lastError: Ref<string | null> = ref(null);
  /** 当前 Tab 是否为本 scope 的 Live WS 主连接 */
  readonly isLeader: Ref<boolean> = ref(true);

  private ws: WebSocket | null = null;
  private opts: LiveConnectOpts = {};
  private scopeKey = '';
  private releaseClaim: (() => void) | null = null;
  private unsubRemote: (() => void) | null = null;
  private unsubLeaderHello: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  /** 每个历史流独立游标（base: / ws: / user: / pv: / form:） */
  private readonly cursors = new Map<string, number>();
  private role: 'leader' | 'follower' | 'idle' = 'idle';

  constructor() {
    if (typeof window !== 'undefined') {
      this.unsubRemote = liveTabBridge.onRemoteEvent((scope, event) => {
        if (!this.scopeKey || scope !== this.scopeKey) return;
        this.applyEvent(event, false, { fromMirror: true });
      });
      this.unsubLeaderHello = liveTabBridge.onLeaderHello((scope) => {
        if (!this.scopeKey || scope !== this.scopeKey) return;
        if (this.role !== 'follower') return;
        void this.catchupHttp();
      });
    }
  }

  /** @deprecated 用 connect({ baseId, workspaceId }) */
  connectBase(baseId: string, workspaceId?: string): void {
    this.connect({ baseId, workspaceId });
  }

  connectPublic(publicToken: string): void {
    this.connect({ publicToken });
  }

  connect(opts: LiveConnectOpts): void {
    const next = { ...opts };
    const nextScope = liveScopeKey(next);
    if (
      this.sameOpts(next) &&
      this.scopeKey === nextScope &&
      (this.ws?.readyState === WebSocket.OPEN || this.role === 'follower')
    ) {
      return;
    }
    this.disconnect();
    this.intentionalClose = false;
    this.opts = next;
    this.scopeKey = nextScope;
    if (!nextScope || nextScope === 'none') return;

    this.releaseClaim = liveTabBridge.claim(nextScope, {
      onLeader: () => {
        if (this.intentionalClose || this.scopeKey !== nextScope) return;
        this.role = 'leader';
        this.isLeader.value = true;
        this.open();
      },
      onFollower: () => {
        if (this.intentionalClose || this.scopeKey !== nextScope) return;
        this.role = 'follower';
        this.isLeader.value = false;
        this.teardownSocketOnly();
        this.connected.value = false;
        void this.catchupHttp();
      },
    });
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.role = 'idle';
    this.isLeader.value = true;
    if (this.releaseClaim) {
      this.releaseClaim();
      this.releaseClaim = null;
    }
    this.scopeKey = '';
    this.teardownSocketOnly();
    this.opts = {};
    this.connected.value = false;
  }

  private teardownSocketOnly(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  private sameOpts(next: LiveConnectOpts): boolean {
    return (
      (this.opts.baseId ?? '') === (next.baseId ?? '') &&
      (this.opts.workspaceId ?? '') === (next.workspaceId ?? '') &&
      (this.opts.publicToken ?? '') === (next.publicToken ?? '') &&
      (this.opts.formToken ?? '') === (next.formToken ?? '') &&
      Boolean(this.opts.userOnly) === Boolean(next.userOnly)
    );
  }

  private open(): void {
    if (typeof window === 'undefined') return;
    if (this.role !== 'leader') return;
    const root = resolveApiWsBase();
    if (!root) return;
    const params = new URLSearchParams();

    if (this.opts.publicToken) {
      params.set('publicToken', this.opts.publicToken);
    } else if (this.opts.formToken) {
      params.set('formToken', this.opts.formToken);
    } else {
      const token = getToken();
      if (!token) return;
      params.set('token', token);
      if (this.opts.baseId) params.set('baseId', this.opts.baseId);
      if (this.opts.workspaceId) {
        params.set('workspaceId', this.opts.workspaceId);
      }
      if (
        !this.opts.baseId &&
        !this.opts.workspaceId &&
        !this.opts.userOnly
      ) {
        return;
      }
    }

    this.teardownSocketOnly();
    const ws = new WebSocket(`${root}/live?${params.toString()}`);
    this.ws = ws;

    ws.onopen = () => {
      if (this.role !== 'leader') return;
      this.connected.value = true;
      this.lastError.value = null;
      this.send({ type: 'client_ready' });
      this.heartbeat = setInterval(() => {
        this.send({ type: 'heart_beat' });
      }, 15_000);
      void this.catchupHttp();
    };

    ws.onmessage = (ev) => {
      let msg: LiveServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as LiveServerMsg;
      } catch {
        return;
      }
      this.handleServer(msg);
    };

    ws.onclose = () => {
      this.connected.value = false;
      if (this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
      this.ws = null;
      if (!this.intentionalClose && this.role === 'leader') {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      this.lastError.value = 'Live 连接异常';
    };
  }

  private handleServer(msg: LiveServerMsg): void {
    if (msg.type === 'live_hello') {
      this.latestSeq.value = msg.latestSeq;
      // 按连接涉及的每个历史流分别 WS 补洞
      for (const target of this.catchupTargets()) {
        if (!target.wsScope) continue;
        const from = this.cursors.get(target.key) ?? 0;
        if (from > 0 && from < msg.latestSeq) {
          this.send({
            type: 'catchup',
            fromSeq: from,
            scope: target.wsScope,
          });
        }
      }
      return;
    }
    if (msg.type === 'live_catchup') {
      for (const event of msg.events) {
        this.applyEvent(event, true);
      }
      return;
    }
    if (msg.type === 'live_event') {
      this.applyEvent(msg, false);
      return;
    }
    if (msg.type === 'error') {
      this.lastError.value = msg.message;
    }
  }

  private applyEvent(
    event: LiveEvent,
    fromCatchup: boolean,
    opts?: { fromMirror?: boolean },
  ): void {
    this.bumpCursorForEvent(event);
    if (event.seq > this.latestSeq.value) this.latestSeq.value = event.seq;
    if (fromCatchup) liveBus.dispatchNow(event);
    else liveBus.dispatch(event);
    if (
      !opts?.fromMirror &&
      this.role === 'leader' &&
      this.scopeKey &&
      this.scopeKey !== 'none'
    ) {
      liveTabBridge.broadcast(this.scopeKey, event);
    }
  }

  /** 只推进事件主归属流的游标，避免 base.seq 污染 ws/user */
  private bumpCursorForEvent(event: LiveEvent): void {
    if (event.baseId) {
      this.bumpCursor(`base:${event.baseId}`, event.seq);
      // 公开连接的 catchup key 与 base 流对齐
      if (this.opts.publicToken) {
        this.bumpCursor(`pv:${this.opts.publicToken}`, event.seq);
      }
      if (this.opts.formToken) {
        this.bumpCursor(`form:${this.opts.formToken}`, event.seq);
      }
      return;
    }
    if (event.workspaceId) {
      this.bumpCursor(`ws:${event.workspaceId}`, event.seq);
      return;
    }
    const userId =
      typeof event.meta?.userId === 'string' ? event.meta.userId : null;
    if (userId) this.bumpCursor('user:me', event.seq);
  }

  private bumpCursor(key: string, seq: number): void {
    const prev = this.cursors.get(key) ?? 0;
    if (seq > prev) this.cursors.set(key, seq);
  }

  private catchupTargets(): CatchupTarget[] {
    const targets: CatchupTarget[] = [];
    if (this.opts.publicToken) {
      targets.push({
        key: `pv:${this.opts.publicToken}`,
        path: `/public-views/${encodeURIComponent(this.opts.publicToken)}/live/since`,
        token: null,
        wsScope: 'base',
      });
      return targets;
    }
    if (this.opts.formToken) {
      targets.push({
        key: `form:${this.opts.formToken}`,
        path: `/public/forms/${encodeURIComponent(this.opts.formToken)}/live/since`,
        token: null,
        wsScope: 'base',
      });
      return targets;
    }
    if (this.opts.userOnly) {
      targets.push({
        key: 'user:me',
        path: '/live/me/since',
        wsScope: 'user',
      });
      return targets;
    }
    if (this.opts.baseId) {
      targets.push({
        key: `base:${this.opts.baseId}`,
        path: `/bases/${this.opts.baseId}/live/since`,
        wsScope: 'base',
      });
    }
    if (this.opts.workspaceId) {
      targets.push({
        key: `ws:${this.opts.workspaceId}`,
        path: `/workspaces/${this.opts.workspaceId}/live/since`,
        wsScope: 'workspace',
      });
    }
    // Base 壳同时进 user 房：补通知洞
    if (this.opts.baseId || this.opts.workspaceId) {
      targets.push({
        key: 'user:me',
        path: '/live/me/since',
        wsScope: 'user',
      });
    }
    return targets;
  }

  private async catchupHttp(): Promise<void> {
    for (const target of this.catchupTargets()) {
      const from = this.cursors.get(target.key) ?? 0;
      try {
        const data = await api<{ latestSeq: number; events: LiveEvent[] }>(
          `${target.path}?seq=${from}`,
          target.token === null ? { token: null } : {},
        );
        this.bumpCursor(target.key, data.latestSeq);
        if (data.latestSeq > this.latestSeq.value) {
          this.latestSeq.value = data.latestSeq;
        }
        for (const event of data.events) {
          this.applyEvent(event, true, { fromMirror: true });
        }
      } catch {
        /* offline / auth */
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose || this.role !== 'leader') return;
      if (
        this.opts.publicToken ||
        this.opts.formToken ||
        this.opts.baseId ||
        this.opts.workspaceId ||
        this.opts.userOnly
      ) {
        this.open();
      }
    }, 2_000);
  }

  private send(msg: LiveClientMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

export const liveSocket = new LiveSocket();
