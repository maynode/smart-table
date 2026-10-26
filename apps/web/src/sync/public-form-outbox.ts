import { endpoints } from '../api/endpoints';
import { NetworkError } from '../api/client';
import { newId } from '../ui/id';

const KEY = 'st.public-form-outbox';

export interface PublicFormPending {
  idempotencyKey: string;
  shareToken: string;
  cells: Record<string, unknown>;
  createdAt: number;
}

function load(): PublicFormPending[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PublicFormPending[];
  } catch {
    return [];
  }
}

function save(rows: PublicFormPending[]): void {
  localStorage.setItem(KEY, JSON.stringify(rows));
}

export async function enqueuePublicFormSubmit(
  shareToken: string,
  cells: Record<string, unknown>,
): Promise<{ queued: boolean; result?: Awaited<ReturnType<typeof endpoints.submitPublicForm>> }> {
  const idempotencyKey = newId();
  if (!navigator.onLine) {
    const rows = load();
    rows.push({
      idempotencyKey,
      shareToken,
      cells,
      createdAt: Date.now(),
    });
    save(rows);
    return { queued: true };
  }
  try {
    const result = await endpoints.submitPublicForm(
      shareToken,
      cells,
      idempotencyKey,
    );
    return { queued: false, result };
  } catch (error) {
    if (error instanceof NetworkError) {
      const rows = load();
      rows.push({
        idempotencyKey,
        shareToken,
        cells,
        createdAt: Date.now(),
      });
      save(rows);
      return { queued: true };
    }
    throw error;
  }
}

export async function flushPublicFormOutbox(): Promise<number> {
  const rows = load();
  if (rows.length === 0 || !navigator.onLine) return 0;
  const remain: PublicFormPending[] = [];
  let done = 0;
  for (const row of rows) {
    try {
      await endpoints.submitPublicForm(
        row.shareToken,
        row.cells,
        row.idempotencyKey,
      );
      done += 1;
    } catch (error) {
      if (error instanceof NetworkError) {
        remain.push(row);
        remain.push(...rows.slice(rows.indexOf(row) + 1));
        break;
      }
      // 业务错误丢弃该条，避免永久卡死
      done += 1;
    }
  }
  save(remain);
  return done;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushPublicFormOutbox();
  });
}
