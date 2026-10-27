/**
 * Object-level offline outbox (dashboard layout, automation defs, notifications).
 * Stored in object_cache; flushed online via existing REST endpoints.
 */

import { endpoints } from '../api/endpoints';
import { localDb } from './local-db-client';
import { newId } from '../ui/id';

const OUTBOX_KEY = 'outbox:object-mutations';

export type ObjectOutboxItem =
  | {
      clientOpId: string;
      type: 'dashboard.widget';
      dashboardId: string;
      widgetId: string;
      patch: Record<string, unknown>;
    }
  | {
      clientOpId: string;
      type: 'dashboard.widgetDelete';
      dashboardId: string;
      widgetId: string;
    }
  | {
      clientOpId: string;
      type: 'automation.upsert';
      automationId?: string;
      baseId: string;
      body: Record<string, unknown>;
    }
  | {
      clientOpId: string;
      type: 'automation.delete';
      automationId: string;
    }
  | {
      clientOpId: string;
      type: 'automation.toggle';
      automationId: string;
      enabled: boolean;
    }
  | {
      clientOpId: string;
      type: 'notification.read';
      notificationId: string;
    }
  | {
      clientOpId: string;
      type: 'notification.readAll';
    };

let flushing = false;
let bootstrapped = false;

async function readQueue(): Promise<ObjectOutboxItem[]> {
  const raw = await localDb.getObjectCache(OUTBOX_KEY);
  return Array.isArray(raw) ? (raw as ObjectOutboxItem[]) : [];
}

async function writeQueue(items: ObjectOutboxItem[]): Promise<void> {
  await localDb.putObjectCache(OUTBOX_KEY, 'outbox', items);
}

export async function enqueueObjectMutation(
  item: Omit<ObjectOutboxItem, 'clientOpId'> & { clientOpId?: string },
): Promise<string> {
  const clientOpId = item.clientOpId ?? newId();
  const full = { ...item, clientOpId } as ObjectOutboxItem;
  const queue = await readQueue();
  queue.push(full);
  await writeQueue(queue);
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void flushObjectOutbox();
  }
  return clientOpId;
}

export async function objectOutboxPendingCount(): Promise<number> {
  return (await readQueue()).length;
}

async function applyOne(item: ObjectOutboxItem): Promise<void> {
  switch (item.type) {
    case 'dashboard.widget':
      await endpoints.updateDashboardWidget(
        item.dashboardId,
        item.widgetId,
        item.patch,
      );
      break;
    case 'dashboard.widgetDelete':
      await endpoints.deleteDashboardWidget(item.dashboardId, item.widgetId);
      break;
    case 'automation.upsert':
      if (item.automationId) {
        await endpoints.updateAutomation(
          item.automationId,
          item.body as {
            name?: string;
            enabled?: boolean;
            trigger?: Record<string, unknown>;
            steps?: Array<Record<string, unknown>>;
            onFindEmpty?: 'continue' | 'stop';
            monthlyQuota?: number | null;
          },
        );
      } else {
        await endpoints.createAutomation({
          baseId: item.baseId,
          name: String(item.body.name ?? '未命名流程'),
          enabled: Boolean(item.body.enabled),
          trigger: (item.body.trigger ?? {}) as Record<string, unknown>,
          steps: (item.body.steps ?? []) as Array<Record<string, unknown>>,
          onFindEmpty:
            item.body.onFindEmpty === 'stop' ? 'stop' : 'continue',
          monthlyQuota:
            (item.body.monthlyQuota as number | null | undefined) ?? null,
        });
      }
      break;
    case 'automation.delete':
      await endpoints.deleteAutomation(item.automationId);
      break;
    case 'automation.toggle':
      await endpoints.updateAutomation(item.automationId, {
        enabled: item.enabled,
      });
      break;
    case 'notification.read':
      await endpoints.markNotificationRead(item.notificationId);
      break;
    case 'notification.readAll':
      await endpoints.markAllNotificationsRead();
      break;
    default:
      break;
  }
}

export async function flushObjectOutbox(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  flushing = true;
  try {
    let queue = await readQueue();
    while (queue.length > 0) {
      const head = queue[0]!;
      try {
        await applyOne(head);
        queue = queue.slice(1);
        await writeQueue(queue);
      } catch {
        // Keep head for retry; stop batch to preserve order.
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export function bootstrapObjectOutbox(): void {
  if (bootstrapped || typeof window === 'undefined') return;
  bootstrapped = true;
  window.addEventListener('online', () => {
    void flushObjectOutbox();
  });
  if (navigator.onLine) void flushObjectOutbox();
}
