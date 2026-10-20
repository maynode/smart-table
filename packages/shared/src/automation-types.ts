import type { FilterGroup, SortSpec } from './view-query';

/** FindRecords.limit defaults to exactly 1: the WeCom behavior we deliberately fix. */
export const DEFAULT_FIND_LIMIT = 1;

export type FindEmptyBehavior = 'continue' | 'stop';

export type AutomationTriggerType =
  | 'recordCreated'
  | 'recordUpdated'
  | 'schedule';

export interface RecordTrigger {
  type: 'recordCreated' | 'recordUpdated';
  sheetId: string;
  /** "且被添加的记录满足条件" — all conditions must match. */
  filters?: FilterGroup;
}

export interface ScheduleTrigger {
  type: 'schedule';
  /** Five-field cron expression. */
  cron: string;
  timezone?: string;
}

export type AutomationTrigger = RecordTrigger | ScheduleTrigger;

export type NaturalTime = 'today' | 'tomorrow' | 'yesterday';

/**
 * A variable reference in a step field mapping or message body:
 * "第N步.<动作>.<字段>", "填写者", or a natural-time phrase.
 */
export interface VariableRef {
  source: 'trigger' | 'step' | 'naturalTime';
  /** Step id (preferred) or 1-based step index. */
  stepId?: string;
  stepIndex?: number;
  /** Field name on the referenced record, e.g. 序列号 / 手机号. */
  field?: string;
  /** Optional path inside the step output, e.g. recordId. */
  path?: string;
  naturalTime?: NaturalTime;
}

export type StepValueExpression =
  | { kind: 'literal'; value: unknown }
  | { kind: 'variable'; variable: VariableRef };

export type CellMapping = Record<string, StepValueExpression>;

export function literal(value: unknown): StepValueExpression {
  return { kind: 'literal', value };
}

export function fromStep(stepId: string, field: string): StepValueExpression {
  return { kind: 'variable', variable: { source: 'step', stepId, field } };
}

export function fromTrigger(field: string): StepValueExpression {
  return { kind: 'variable', variable: { source: 'trigger', field } };
}

export interface BaseStep {
  id: string;
  type: AutomationStepType;
  name?: string;
}

export type AutomationStepType =
  | 'findRecords'
  | 'createRecord'
  | 'modifyRecords'
  | 'sendMessage'
  | 'startGroupChat'
  | 'addGroupMembers';

export interface FindRecordsStep extends BaseStep {
  type: 'findRecords';
  sheetId: string;
  filters?: FilterGroup;
  sorts?: SortSpec[];
  /** Defaults to 1 (see DEFAULT_FIND_LIMIT). */
  limit?: number;
  /** "未找到时：继续执行 / 终止" */
  onEmpty?: FindEmptyBehavior;
}

export interface CreateRecordStep extends BaseStep {
  type: 'createRecord';
  sheetId: string;
  cells: CellMapping;
}

export type ModifyTarget =
  | { mode: 'fromStep'; stepId: string }
  | { mode: 'ids'; recordIds: string[] }
  | { mode: 'filters'; sheetId: string; filters: FilterGroup };

export interface ModifyRecordsStep extends BaseStep {
  type: 'modifyRecords';
  target: ModifyTarget;
  /** "指定内容": field id/name -> value or variable. */
  cells: CellMapping;
}

export interface Recipient {
  /** Who receives the message. */
  source: 'trigger' | 'step' | 'fixed';
  stepId?: string;
  /** e.g. 填写者 on the created-record step. */
  field?: string;
  userIds?: string[];
  /** Group message target. */
  groupChatId?: string;
  label?: string;
}

export interface MessageButton {
  title: string;
  url: string;
}

export interface MessageAttachment {
  type: 'dashboard' | 'report' | 'form' | 'sheet';
  id: string;
  name?: string;
}

export interface MessageContent {
  text: string;
  buttons?: MessageButton[];
}

export interface SendMessageStep extends BaseStep {
  type: 'sendMessage';
  /** 文档消息 | 群消息 */
  channel: 'doc' | 'group';
  recipients: Recipient[];
  content: MessageContent;
  /** Dashboard schedule push attaches the dashboard here. */
  attachments?: MessageAttachment[];
}

export interface StartGroupChatStep extends BaseStep {
  type: 'startGroupChat';
  name: string;
  memberUserIds: string[];
}

export interface AddGroupMembersStep extends BaseStep {
  type: 'addGroupMembers';
  /** Optional: target group created by an earlier step. */
  fromStepId?: string;
  groupChatId?: string;
  memberUserIds: string[];
}

export type AutomationStep =
  | FindRecordsStep
  | CreateRecordStep
  | ModifyRecordsStep
  | SendMessageStep
  | StartGroupChatStep
  | AddGroupMembersStep;

export interface AutomationDefinition {
  id: string;
  baseId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  /** Applied when a find step does not override it. */
  onFindEmpty?: FindEmptyBehavior;
  /** Displayed on the automation list card ("还可运行 N 次"). */
  monthlyQuota?: number;
  monthlyRunCount?: number;
}

export function resolveFindLimit(
  step: Pick<FindRecordsStep, 'limit'>,
): number {
  if (step.limit === undefined || step.limit === null) {
    return DEFAULT_FIND_LIMIT;
  }
  if (!Number.isFinite(step.limit) || step.limit < 1) {
    return DEFAULT_FIND_LIMIT;
  }
  return Math.floor(step.limit);
}

export function resolveOnEmpty(
  step: Pick<FindRecordsStep, 'onEmpty'>,
  automation?: Pick<AutomationDefinition, 'onFindEmpty'>,
): FindEmptyBehavior {
  return step.onEmpty ?? automation?.onFindEmpty ?? 'continue';
}

export interface RecordOutput {
  id: string;
  sheetId: string;
  cells: Record<string, unknown>;
}

export interface StepOutput {
  stepId: string;
  type: AutomationStepType;
  /** findRecords: matched records; createRecord: created record. */
  records?: RecordOutput[];
  recordIds?: string[];
  /** Flat field-name -> display-string values, merged into the success page. */
  values?: Record<string, string>;
  error?: string;
}

export type AutomationRunStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped';

export interface AutomationRunResult {
  runId: string;
  status: AutomationRunStatus;
  stepOutputs: Record<string, string>;
  outputs: StepOutput[];
  error?: string;
}
