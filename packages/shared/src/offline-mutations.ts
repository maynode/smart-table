/**
 * Offline / MessageCenter commit protocol (WeCom-aligned HTTP commitchanges).
 * See docs/OFFLINE.md.
 */

export const COMMIT_ERROR = {
  /** 版本过低 / 行已被他人修改 — 对齐 COMMIT_BASE_VER_TOO_LOW / version break */
  VERSION_CONFLICT: 'COMMIT_VERSION_CONFLICT',
  /** 重复 clientOpId — 对齐 ERR_COMMIT_DUPLICATED */
  DUPLICATED: 'COMMIT_DUPLICATED',
  /** 单条过大 */
  OVERSIZE: 'COMMIT_OVERSIZE',
  /** 未知字段 / 非法载荷 */
  INVALID: 'COMMIT_INVALID',
  /** 权限不足 */
  FORBIDDEN: 'COMMIT_FORBIDDEN',
  /** 资源不存在 */
  NOT_FOUND: 'COMMIT_NOT_FOUND',
  /** 其它业务失败 */
  FAILED: 'COMMIT_FAILED',
} as const;

export type CommitErrorCode =
  (typeof COMMIT_ERROR)[keyof typeof COMMIT_ERROR];

export type SheetMutationType =
  | 'setRecord'
  | 'createRecord'
  | 'deleteRecord'
  | 'insertRecords'
  | 'createField'
  | 'updateField'
  | 'deleteField'
  | 'createAttachment'
  | 'publicFormSubmit';

export interface MutationBase {
  /** 客户端全局唯一；服务端幂等键 */
  clientOpId: string;
  type: SheetMutationType;
}

export interface SetRecordMutation extends MutationBase {
  type: 'setRecord';
  recordId: string;
  cells: Record<string, unknown>;
  /** 行 version；缺省则不做乐观锁（不推荐） */
  baseVersion?: number;
}

export interface CreateRecordMutation extends MutationBase {
  type: 'createRecord';
  /** 客户端临时 UUID；服务端回显 serverRecordId 映射 */
  clientRecordId: string;
  cells?: Record<string, unknown>;
}

export interface DeleteRecordMutation extends MutationBase {
  type: 'deleteRecord';
  recordId: string;
  baseVersion?: number;
}

export interface InsertRecordsMutation extends MutationBase {
  type: 'insertRecords';
  records: Array<{
    clientRecordId: string;
    cells?: Record<string, unknown>;
  }>;
}

export interface CreateFieldMutation extends MutationBase {
  type: 'createField';
  clientFieldId: string;
  name: string;
  fieldType: string;
  options?: Record<string, unknown> | null;
  required?: boolean;
}

export interface UpdateFieldMutation extends MutationBase {
  type: 'updateField';
  fieldId: string;
  name?: string;
  options?: Record<string, unknown> | null;
  required?: boolean;
  hidden?: boolean;
}

export interface DeleteFieldMutation extends MutationBase {
  type: 'deleteField';
  fieldId: string;
}

/** 附件：联网后先 upload 再带 uploadToken；或 flush 前由客户端上传得到 url */
export interface CreateAttachmentMutation extends MutationBase {
  type: 'createAttachment';
  recordId: string;
  fieldId: string;
  fileName: string;
  contentType: string;
  /** 已上传文件的公开 URL（或 /files/...） */
  url: string;
  size?: number;
}

/** 公开表单离线提交；idempotencyKey 防领码双花 */
export interface PublicFormSubmitMutation extends MutationBase {
  type: 'publicFormSubmit';
  shareToken: string;
  cells: Record<string, unknown>;
  idempotencyKey: string;
}

export type SheetMutation =
  | SetRecordMutation
  | CreateRecordMutation
  | DeleteRecordMutation
  | InsertRecordsMutation
  | CreateFieldMutation
  | UpdateFieldMutation
  | DeleteFieldMutation
  | CreateAttachmentMutation
  | PublicFormSubmitMutation;

export interface CommitChangesRequest {
  clientBatchId: string;
  mutations: SheetMutation[];
}

export interface MutationResultOk {
  clientOpId: string;
  status: 'ok' | 'duplicate';
  /** setRecord / create 等回显 */
  record?: {
    id: string;
    cells: Record<string, unknown>;
    version: number;
  };
  /** createRecord：临时 id → 服务端 id */
  recordIdMap?: Record<string, string>;
  field?: {
    id: string;
    name: string;
    type: string;
    options?: unknown;
    order?: number;
    required?: boolean;
    hidden?: boolean;
  };
  fieldIdMap?: Record<string, string>;
  attachment?: { url: string; fileName: string };
  submission?: { id: string; recordId?: string | null; resultHtml?: string | null };
}

export interface MutationResultErr {
  clientOpId: string;
  status: 'error';
  code: CommitErrorCode;
  message: string;
}

export type MutationResult = MutationResultOk | MutationResultErr;

export interface CommitChangesResponse {
  clientBatchId: string;
  results: MutationResult[];
  /** Present when sheet_rev was bumped by this commit. */
  sheetRev?: number;
}
