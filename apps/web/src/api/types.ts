export interface UserDto {
  id: string;
  account: string;
  name: string;
  avatarSeed: string;
  avatarUrl?: string | null;
  /** 系统管理员（反馈后台 / 配额）；对应 INSTALL_ADMIN_* */
  installAdmin?: boolean;
}

export interface FeedbackDto {
  id: string;
  userId: string | null;
  content: string;
  pagePath: string | null;
  imageUrls: string[];
  status: 'open' | 'done';
  createdAt: string;
  updatedAt: string;
  user: { id: string; account: string; name: string } | null;
}

export interface AdminUserDto {
  id: string;
  account: string;
  name: string;
  createdAt: string;
  blacklistedAt: string | null;
  workspaceCount: number;
  baseCount: number;
  installAdmin: boolean;
}

export interface ActivityLogDto {
  id: string;
  actorId: string | null;
  actorAccount: string;
  action: string;
  op: string;
  summary: string;
  method: string;
  path: string;
  resourceType: string;
  resourceId: string | null;
  workspaceId: string | null;
  baseId: string | null;
  sheetId: string | null;
  source: string;
  ip: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  pinned?: boolean;
  pinnedAt?: string | null;
}

export interface BaseDto {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SheetDto {
  id: string;
  baseId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  fields?: FieldDto[];
}

export interface FieldOptionChoice {
  id: string;
  name: string;
  color?: string;
}

export interface FieldOptions {
  choices?: FieldOptionChoice[];
  [key: string]: unknown;
}

export interface FieldDto {
  id: string;
  sheetId: string;
  name: string;
  type: string;
  options: FieldOptions | null;
  order: number;
  required: boolean;
  hidden: boolean;
}

export interface SavedViewDto {
  id: string;
  sheetId: string;
  name: string;
  query: import('shared').ViewQuery;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentValue {
  url: string;
  name: string;
  mimetype?: string;
  size?: number;
}

export interface RecordDto {
  id: string;
  sheetId: string;
  cells: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecordPage {
  records: RecordDto[];
  nextCursor: string | null;
  /** 表内总行数（用于虚拟滚动条高度） */
  total?: number;
  /** 本次按 offset 拉取时的起始下标 */
  offset?: number;
}

export interface CommentDto {
  id: string;
  sheetId: string;
  body: string;
  createdAt: string;
  author: UserDto;
}

export interface MemberDto {
  userId: string;
  /** 未注册待加入时有值，改角色/移除用此 id */
  inviteId?: string;
  account: string;
  name: string;
  avatarSeed?: string;
  avatarUrl?: string | null;
  role: string;
  createdAt: string;
  /** false = 已邀请但对方尚未注册 */
  registered: boolean;
}

export interface AuthResult {
  accessToken: string;
  user: UserDto;
}

export type DisplayConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notEmpty'
  | 'isEmpty';

export type DisplayConjunction = 'and' | 'or';

export interface DisplayConditionDto {
  fieldId: string;
  operator: DisplayConditionOperator;
  value?: unknown;
}

export interface DisplayConditionRuleDto {
  conjunction: DisplayConjunction;
  conditions: Array<DisplayConditionDto | DisplayConditionRuleDto>;
}

export interface FormFieldConfigDto {
  fieldId: string;
  required?: boolean;
  /** @deprecated flat AND; prefer displayRule */
  displayConditions?: DisplayConditionDto[];
  displayRule?: DisplayConditionRuleDto;
}

export interface FormDto {
  id: string;
  baseId: string;
  sheetId: string;
  name: string;
  coverUrl: string | null;
  fields: FormFieldConfigDto[];
  share: {
    enabled: boolean;
    audience: 'anyone' | 'workspace';
    expiresAt: string | null;
    token: string;
    qrUrl: string;
    qrCodeDataUrl: string;
  };
  successPage: { templateHtml: string };
  rejectDuplicatePhone: boolean;
  /** 去重依据的表单字段 id；空则后端回退第一个手机号字段 */
  duplicateCheckFieldId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicFormFieldDto {
  fieldId: string;
  name: string;
  type: string;
  options: FieldOptions | null;
  required: boolean;
  displayConditions?: DisplayConditionDto[];
  displayRule?: DisplayConditionRuleDto;
}

export interface PublicFormDto {
  id: string;
  name: string;
  coverUrl: string | null;
  qrUrl: string;
  fields: PublicFormFieldDto[];
  /** Present when the form has person fields. */
  members?: Array<{ userId: string; name: string }>;
  /** Relation fieldId → target-sheet record choices. */
  relationChoices?: Record<string, Array<{ id: string; label: string }>>;
}

export interface FormSubmitResult {
  submissionId: string;
  recordId: string | null;
  status: string;
  success?: { html: string };
  pollUrl?: string;
  jobId?: string;
  stepOutputs?: Record<string, unknown>;
  error?: string | null;
}

export interface AutomationDto {
  id: string;
  baseId: string;
  name: string;
  enabled: boolean;
  trigger: Record<string, unknown>;
  steps: unknown[];
  onFindEmpty: string;
  monthlyQuota: number | null;
  monthlyRunCount?: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutomationRunStepDto {
  stepIndex: number;
  type: string;
  status: string;
  error: string | null;
  durationMs: number | null;
  output: Record<string, unknown>;
}

export interface AutomationRunDto {
  id: string;
  automationId: string;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  steps: AutomationRunStepDto[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ViewQueryResult {
  records: RecordDto[];
  total: number;
  groups: Array<{
    fieldId: string;
    key: string;
    label: string;
    count: number;
  }>;
  colors: Record<string, string>;
  cellColors: Record<string, Record<string, string>>;
  rowHeight: string | number;
}

export type AclLevel = 'full' | 'edit' | 'view' | 'none';

export interface AclFieldAccess {
  editable?: boolean;
  viewable?: boolean;
  submitOnce?: boolean;
}

export interface AclRecordRule {
  mode: 'all' | 'condition' | 'own';
  filter?: unknown;
  canAdd?: boolean;
  canDelete?: boolean;
}

export interface AclFieldRule {
  mode: 'all' | 'fields';
  fields?: Record<string, AclFieldAccess>;
  newFields?: AclFieldAccess;
}

export interface AclConfig {
  level: AclLevel;
  recordRule?: AclRecordRule;
  fieldRule?: AclFieldRule;
}

export interface PermissionObjectDto {
  objectType: 'sheet' | 'form';
  objectId: string;
  name: string;
  kind: string;
  level: AclLevel;
}

export interface PermissionSettingsDto {
  objectType: string;
  objectId: string;
  name: string;
  baseId: string;
  canManage: boolean;
  role: string;
  effective: {
    level: AclLevel;
    recordRule: AclRecordRule | null;
    fieldRule: AclFieldRule | null;
  };
  everyone: AclConfig | null;
  members: Array<AclConfig & { userId: string; name: string; account: string }>;
  workspaceMembers: Array<{
    userId: string;
    name: string;
    account: string;
    role: string;
  }>;
}

export interface UpsertFormPayload {
  baseId: string;
  sheetId: string;
  name: string;
  coverUrl?: string;
  fields: FormFieldConfigDto[];
  share?: {
    enabled?: boolean;
    audience?: 'anyone' | 'workspace';
    expiresAt?: string | null;
  };
  successPage?: { templateHtml: string };
  rejectDuplicatePhone?: boolean;
  duplicateCheckFieldId?: string | null;
}

export interface DashboardDto {
  id: string;
  baseId: string;
  name: string;
  kind: 'dashboard' | 'report';
  createdAt: string;
  updatedAt: string;
}

export interface DashboardWidgetDto {
  id: string;
  dashboardId: string;
  type: 'bar' | 'line' | 'pie' | 'metric' | 'table';
  title: string;
  sheetId: string | null;
  config: {
    dimensionFieldId?: string;
    metricFieldId?: string;
    aggregation?: 'sum' | 'count' | 'avg' | 'min' | 'max';
    limit?: number;
    themeColor?: string;
    showLegend?: boolean;
    showLabel?: boolean;
    legendPosition?: 'top' | 'bottom';
  };
  layout?: { w?: number; h?: number };
  order: number;
}

export interface DashboardAiActionResultDto {
  op: 'add_widget' | 'update_widget' | 'delete_widget';
  widgetId?: string;
  ok: boolean;
  detail?: string;
}

export interface DashboardAiMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind?: 'text';
  createdAt: string;
  clientMessageId?: string;
  applied?: DashboardAiActionResultDto[];
}

export interface DashboardAiSessionDto {
  id: string;
  dashboardId: string;
  status: 'idle' | 'thinking' | 'failed' | string;
  messages: DashboardAiMessageDto[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardAiChatResultDto extends DashboardAiSessionDto {
  applied: DashboardAiActionResultDto[];
  widgets: DashboardWidgetDto[];
  idempotent?: boolean;
}

export interface MetricConditionalRule {
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'between';
  value: number;
  value2?: number;
  color: string;
}

export interface DashboardWidgetData {
  id: string;
  type: string;
  title: string;
  labels: string[];
  values: number[];
  rows?: Array<{ label: string; value: number }>;
  layout?: { w?: number; h?: number; x?: number; y?: number };
  metric?: {
    value: number;
    previousValue?: number | null;
    delta?: number | null;
    deltaPercent?: number | null;
    compareLabel?: string;
    displayColor?: string;
    prefix?: string;
    suffix?: string;
    decimalPlaces?: number;
  };
  config?: {
    themeColor?: string;
    showLegend?: boolean;
    showLabel?: boolean;
    legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'topRight';
    stackMode?: 'none' | 'stack' | 'percent';
    showXAxis?: boolean;
    showYAxis?: boolean;
    showGrid?: boolean;
    xAxisTitle?: string;
    yAxisTitle?: string;
    yMin?: number | null;
    yMax?: number | null;
    logScale?: boolean;
    textContent?: string;
    dimensionFieldId?: string;
    metricFieldId?: string;
    aggregation?: string;
    sortBy?: 'value' | 'label';
    sortOrder?: 'asc' | 'desc';
    compareMode?: 'none' | 'mom' | 'yoy';
    compareWindowDays?: number;
    trendEnabled?: boolean;
    trendDays?: number;
    conditionalRules?: MetricConditionalRule[];
    valuePrefix?: string;
    valueSuffix?: string;
    decimalPlaces?: number;
  };
  driver: string;
}

export interface DashboardDataDto {
  dashboard: {
    id: string;
    name: string;
    kind: string;
    layout: unknown;
  };
  widgets: DashboardWidgetData[];
  driver: string;
}

export interface DashboardScheduleDto {
  id: string;
  dashboardId: string;
  cron: string;
  channel: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runs: Array<{
    id: string;
    status: string;
    message: string;
    createdAt: string;
  }>;
}

export type TemplateKind =
  | 'base'
  | 'sheet'
  | 'form'
  | 'dashboard'
  | 'report';

export interface TemplateDto {
  key: string;
  name: string;
  category: string;
  kind?: TemplateKind;
  icon: string;
  description: string;
  sheets: Array<{ name: string; fields: number }>;
}

export interface TemplateInstantiateResult {
  template: string;
  baseId: string;
  kind?: TemplateKind;
  name?: string;
  sheetId?: string;
  formId?: string;
  dashboardId?: string;
  reportId?: string;
  sheets?: Array<{ id: string; name: string }>;
  codes?: number;
  shareUrl?: string;
}

export interface PublicViewScopeOption {
  id: string;
  name: string;
  hasData: boolean;
  recordCount?: number;
  widgetCount?: number;
  formId?: string;
  status?: string;
}

export interface PublicViewScopeOptions {
  sheets: PublicViewScopeOption[];
  formSheets: PublicViewScopeOption[];
  dashboards: PublicViewScopeOption[];
  analysisReports: PublicViewScopeOption[];
}

export interface PublicViewDto {
  id: string;
  sheetId: string;
  sheetIds?: string[];
  formSheetIds?: string[];
  dashboardIds?: string[];
  analysisReportIds?: string[];
  name: string;
  token: string;
  passwordRequired: boolean;
  expiresAt: string | null;
  enabled: boolean;
  createdAt: string;
  url: string;
}

export interface PublicViewSheetData {
  id: string;
  name: string;
  kind?: 'sheet' | 'form';
  fields: Array<{
    id: string;
    name: string;
    type: string;
    options?: unknown;
    required?: boolean;
  }>;
  records: Array<{ id: string; cells: Record<string, unknown> }>;
}

export interface PublicViewDashboardWidget {
  id: string;
  type: string;
  title: string;
  labels: string[];
  values: number[];
  config?: Record<string, unknown>;
  metric?: {
    value: number;
    previousValue?: number | null;
    delta?: number | null;
    deltaPercent?: number | null;
    compareLabel?: string;
    displayColor?: string;
    prefix?: string;
    suffix?: string;
    decimalPlaces?: number;
  } | null;
}

export interface PublicViewDashboardData {
  id: string;
  name: string;
  kind: string;
  widgets: PublicViewDashboardWidget[];
}

export interface PublicViewAnalysisReportData {
  id: string;
  name: string;
  reportMarkdown: string;
}

export interface PublicViewData {
  readonly: true;
  name: string;
  sheet: { id: string; name: string };
  sheets?: PublicViewSheetData[];
  formSheets?: PublicViewSheetData[];
  dashboards?: PublicViewDashboardData[];
  analysisReports?: PublicViewAnalysisReportData[];
  fields: PublicViewSheetData['fields'];
  records: PublicViewSheetData['records'];
  expiresAt: string | null;
}

export interface NotificationDto {
  id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export type AnalysisReportStatus =
  | 'draft'
  | 'asking'
  | 'exploring'
  | 'generating'
  | 'ready'
  | 'failed';

export interface AnalysisStepDto {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
}

export interface AnalysisMessageOptionDto {
  id: string;
  label: string;
}

export interface AnalysisMessageAttachmentDto {
  url: string;
  name: string;
  mimetype: string;
  size: number;
}

export interface AnalysisMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind?: 'text' | 'choice';
  options?: AnalysisMessageOptionDto[];
  attachments?: AnalysisMessageAttachmentDto[];
  createdAt: string;
}

export interface AnalysisReportDto {
  id: string;
  baseId: string;
  name: string;
  status: AnalysisReportStatus;
  messages: AnalysisMessageDto[];
  steps: AnalysisStepDto[];
  sheetIds: string[];
  reportMarkdown: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisReportListItemDto {
  id: string;
  baseId: string;
  name: string;
  status: AnalysisReportStatus;
  createdAt: string;
  updatedAt: string;
}
