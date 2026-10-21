export interface UserDto {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
}

export interface BaseDto {
  id: string;
  workspaceId: string;
  name: string;
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
  email: string;
  name: string;
  role: string;
  createdAt: string;
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

export interface DisplayConditionDto {
  fieldId: string;
  operator: DisplayConditionOperator;
  value?: unknown;
}

export interface FormFieldConfigDto {
  fieldId: string;
  required?: boolean;
  displayConditions?: DisplayConditionDto[];
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
}

export interface PublicFormDto {
  id: string;
  name: string;
  coverUrl: string | null;
  qrUrl: string;
  fields: PublicFormFieldDto[];
}

export interface FormSubmitResult {
  submissionId: string;
  recordId: string;
  status: string;
  success: { html: string };
  stepOutputs?: Record<string, string>;
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
  members: Array<AclConfig & { userId: string; name: string; email: string }>;
  workspaceMembers: Array<{
    userId: string;
    name: string;
    email: string;
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
  order: number;
}

export interface DashboardWidgetData {
  id: string;
  type: string;
  title: string;
  labels: string[];
  values: number[];
  rows?: Array<{ label: string; value: number }>;
  config?: {
    themeColor?: string;
    showLegend?: boolean;
    showLabel?: boolean;
    legendPosition?: 'top' | 'bottom';
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

export interface FolderNodeDto {
  id: string;
  name: string;
  parentId: string | null;
  bases: Array<{ id: string; name: string }>;
  children: FolderNodeDto[];
}

export interface FolderTreeDto {
  folders: FolderNodeDto[];
  unfiled: Array<{ id: string; name: string }>;
}

export interface TemplateDto {
  key: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  sheets: Array<{ name: string; fields: number }>;
}

export interface TemplateInstantiateResult {
  template: string;
  baseId: string;
  sheets: Array<{ id: string; name: string }>;
  codes?: number;
  shareUrl?: string;
}

export interface CrossWorkspaceShareDto {
  id: string;
  objectType: 'base' | 'sheet';
  objectId: string;
  objectName: string;
  role: 'view' | 'edit';
  sourceWorkspaceId: string;
  sourceWorkspaceName: string;
  targetWorkspaceId: string;
  targetWorkspaceName: string;
  createdAt: string;
}
