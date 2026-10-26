import type { SheetMutation } from 'shared';

export type CollabClientMsg =
  | { type: 'client_ready' }
  | { type: 'heart_beat' }
  | {
      type: 'user_changes';
      baseRev: number;
      clientBatchId: string;
      mutations: SheetMutation[];
    }
  | {
      type: 'cursor_message';
      cursor: {
        recordId?: string;
        fieldId?: string;
        rowIndex?: number;
        colIndex?: number;
      };
    }
  | {
      type: 'cell_lock_acquire';
      recordId: string;
      fieldId: string;
    }
  | {
      type: 'cell_lock_release';
      recordId: string;
      fieldId: string;
    }
  | { type: 'get_changes'; fromRev: number };

export type CollabServerMsg =
  | { type: 'last_reversion'; sheetRev: number }
  | {
      type: 'user_newinfos';
      members: Array<{
        userId: string;
        account: string;
        name: string;
        color: string;
        avatarSeed: string;
        avatarUrl: string | null;
      }>;
    }
  | { type: 'heart_beat'; ok: true }
  | {
      type: 'accept_commit';
      baseRev: number;
      newRev: number;
      commitId: string;
      clientBatchId: string;
      results: unknown[];
    }
  | {
      type: 'new_changes';
      baseRev: number;
      newRev: number;
      commitId: string;
      authorId: string;
      mutations: SheetMutation[];
    }
  | {
      type: 'cursor_message';
      userId: string;
      account: string;
      name: string;
      color: string;
      cursor: Record<string, unknown>;
    }
  | {
      type: 'cell_lock_result';
      ok: boolean;
      recordId: string;
      fieldId: string;
      holder?: {
        userId: string;
        account: string;
        name: string;
        color: string;
        expiresAt: number;
      };
    }
  | {
      type: 'cell_lock_update';
      action: 'acquired' | 'released';
      recordId: string;
      fieldId: string;
      holder: {
        userId: string;
        account: string;
        name: string;
        color: string;
        expiresAt: number;
      } | null;
    }
  | {
      type: 'cell_locks_snapshot';
      locks: Array<{
        recordId: string;
        fieldId: string;
        userId: string;
        account: string;
        name: string;
        color: string;
        expiresAt: number;
      }>;
    }
  | { type: 'user_leave'; userId: string }
  | {
      type: 'comm_notice';
      noticeType: 'DIRTY_AREA_CHANGE';
      sheetRev: number;
    }
  | {
      type: 'error';
      code: string;
      message: string;
      sheetRev?: number;
    }
  | {
      type: 'changes';
      fromRev: number;
      toRev: number;
      changesets: Array<{
        rev: number;
        authorId: string | null;
        commitId: string;
        mutations: SheetMutation[];
      }>;
    };
