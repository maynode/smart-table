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
