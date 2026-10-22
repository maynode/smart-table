import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { DisplayConditionOperator } from 'shared';

const OPERATORS: DisplayConditionOperator[] = [
  'equals',
  'notEquals',
  'contains',
  'notEmpty',
  'isEmpty',
];

export class DisplayConditionDto {
  @IsUUID()
  fieldId!: string;

  @IsIn(OPERATORS)
  operator!: DisplayConditionOperator;

  @IsOptional()
  @Allow()
  value?: unknown;
}

export class FormFieldDto {
  @IsUUID()
  fieldId!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DisplayConditionDto)
  displayConditions?: DisplayConditionDto[];

  /** Nested AND/OR rule; validated recursively in FormsService. */
  @IsOptional()
  @IsObject()
  displayRule?: Record<string, unknown>;
}

export class FormShareDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['anyone', 'workspace'])
  audience?: 'anyone' | 'workspace';

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}

export class FormSuccessPageDto {
  @IsString()
  @MaxLength(20_000)
  templateHtml!: string;
}

export class UpsertFormDto {
  @IsUUID()
  baseId!: string;

  @IsUUID()
  sheetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields!: FormFieldDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FormShareDto)
  share?: FormShareDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FormSuccessPageDto)
  successPage?: FormSuccessPageDto;

  @IsOptional()
  @IsBoolean()
  rejectDuplicatePhone?: boolean;
}

export class SubmitFormDto {
  @IsObject()
  cells!: Record<string, unknown>;
}

export class PreviewSuccessDto {
  @IsOptional()
  @IsObject()
  formCells?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  stepOutputs?: Record<string, unknown>;
}
