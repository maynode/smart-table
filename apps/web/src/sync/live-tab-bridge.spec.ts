/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LiveTabBridge,
  liveScopeKey,
  type LiveTabBridgeMsg,
} from './live-tab-bridge';
import type { LiveEvent } from 'shared';

function sampleEvent(id: string): LiveEvent {
  return {
    type: 'live_event',
    eventId: id,
    seq: 1,
    baseId: 'b1',
    workspaceId: null,
    at: new Date().toISOString(),
    actorId: null,
    kind: 'sheet.created',
    entityId: 's1',
  };
}

class FakeChannel {
  static map = new Map<string, Set<FakeChannel>>();
  onmessage: ((ev: MessageEvent<LiveTabBridgeMsg>) => void) | null = null;
  constructor(private readonly name: string) {
    let set = FakeChannel.map.get(name);
    if (!set) {
      set = new Set();
      FakeChannel.map.set(name, set);
    }
    set.add(this);
  }
  postMessage(data: LiveTabBridgeMsg): void {
    const peers = FakeChannel.map.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue;
      peer.onmessage?.({ data } as MessageEvent<LiveTabBridgeMsg>);
    }
  }
  close(): void {
    FakeChannel.map.get(this.name)?.delete(this);
  }
}

describe('liveScopeKey', () => {
  it('encodes public / form / user / base+workspace', () => {
    expect(liveScopeKey({ publicToken: 'pt' })).toBe('pv:pt');
    expect(liveScopeKey({ formToken: 'ft' })).toBe('form:ft');
    expect(liveScopeKey({ userOnly: true })).toBe('user');
    expect(liveScopeKey({ baseId: 'b', workspaceId: 'w' })).toBe(
      'base:b|ws:w',
    );
    expect(liveScopeKey({ workspaceId: 'w' })).toBe('ws:w');
    expect(liveScopeKey({})).toBe('none');
  });
});

describe('LiveTabBridge', () => {
  beforeEach(() => {
    FakeChannel.map.clear();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    // No locks → claim 立即 onLeader
    vi.stubGlobal('navigator', {
      locks: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mirrors live_event to other tabs on the same channel', () => {
    const a = new LiveTabBridge();
    const b = new LiveTabBridge();
    const received: LiveEvent[] = [];
    b.onRemoteEvent((_scope, event) => {
      received.push(event);
    });
    a.broadcast('base:b|ws:w', sampleEvent('e1'));
    expect(received).toHaveLength(1);
    expect(received[0].eventId).toBe('e1');
  });

  it('does not echo broadcast to the sender tab', () => {
    const a = new LiveTabBridge();
    const received: string[] = [];
    a.onRemoteEvent((_s, e) => received.push(e.eventId));
    a.broadcast('ws:w', sampleEvent('e2'));
    expect(received).toHaveLength(0);
  });

  it('claim without locks promotes leader immediately', () => {
    const bridge = new LiveTabBridge();
    const roles: string[] = [];
    const release = bridge.claim('ws:w', {
      onLeader: () => roles.push('leader'),
      onFollower: () => roles.push('follower'),
    });
    expect(roles).toEqual(['leader']);
    expect(bridge.isLeader('ws:w')).toBe(true);
    release();
    expect(bridge.isLeader('ws:w')).toBe(false);
  });

  it('notifies peers on leader_hello', () => {
    const a = new LiveTabBridge();
    const b = new LiveTabBridge();
    const hellos: string[] = [];
    b.onLeaderHello((scope, tabId) => {
      hellos.push(`${scope}:${tabId}`);
    });
    // 无 locks 时 claim 立即升主并广播 hello
    a.claim('ws:w', { onLeader: () => undefined, onFollower: () => undefined });
    expect(hellos.some((h) => h.startsWith('ws:w:'))).toBe(true);
  });
});
