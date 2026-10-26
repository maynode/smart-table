/** Live Bus 领域事件（与单元格 OT `/collab` 分离）。 */

export type LiveEventKind =
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.deleted'
  | 'workspace.pinned'
  | 'base.created'
  | 'base.updated'
  | 'base.deleted'
  | 'base.reordered'
  | 'base.moved'
  | 'sheet.created'
  | 'sheet.updated'
  | 'sheet.deleted'
  | 'sheet.reordered'
  | 'sheet.schema_changed'
  | 'sheet.rev_bumped'
  | 'form.created'
  | 'form.updated'
  | 'form.deleted'
  | 'form.published'
  | 'dashboard.created'
  | 'dashboard.updated'
  | 'dashboard.deleted'
  | 'widget.changed'
  | 'schedule.updated'
  | 'analysis.created'
  | 'analysis.updated'
  | 'analysis.deleted'
  | 'analysis.message'
  | 'automation.created'
  | 'automation.updated'
  | 'automation.deleted'
  | 'automation.run'
  | 'permission.changed'
  | 'member.changed'
  | 'comment.changed'
  | 'notification.created'
  | 'notification.read'
  | 'public_view.created'
  | 'public_view.updated'
  | 'public_view.deleted'
  | 'view.changed'
  | 'template.changed'
  | 'sync.changed';

export interface LiveEvent {
  type: 'live_event';
  eventId: string;
  /** 单调序号（按 base / workspace / user 作用域） */
  seq: number;
  baseId: string | null;
  workspaceId: string | null;
  at: string;
  actorId: string | null;
  kind: LiveEventKind | string;
  entityId?: string;
  meta?: Record<string, unknown>;
}

export interface LiveHelloMsg {
  type: 'live_hello';
  baseId: string | null;
  workspaceId: string | null;
  /** 当前缓冲中最新 seq；0 表示尚无事件 */
  latestSeq: number;
}

export interface LiveHeartbeatMsg {
  type: 'heart_beat';
  ok: true;
}

export interface LiveErrorMsg {
  type: 'error';
  code: string;
  message: string;
}

export interface LiveCatchupMsg {
  type: 'live_catchup';
  events: LiveEvent[];
}

export type LiveServerMsg =
  | LiveEvent
  | LiveHelloMsg
  | LiveHeartbeatMsg
  | LiveErrorMsg
  | LiveCatchupMsg;

export type LiveClientMsg =
  | { type: 'client_ready' }
  | { type: 'heart_beat' }
  | {
      type: 'catchup';
      fromSeq: number;
      scope?: 'base' | 'workspace' | 'user';
    };
