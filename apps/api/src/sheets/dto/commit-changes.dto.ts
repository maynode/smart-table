import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Allow } from 'class-validator';

const MUTATION_TYPES = [
  'setRecord',
  'createRecord',
  'deleteRecord',
  'insertRecords',
  'createField',
  'updateField',
  'deleteField',
  'createAttachment',
  'publicFormSubmit',
] as const;

/** Loose mutation body — validated per-type in CommitChangesService. */
export class SheetMutationDto {
  @IsString()
  @MinLength(8)
  @MaxLength(80)
  clientOpId!: string;

  @IsIn(MUTATION_TYPES as unknown as string[])
  type!: (typeof MUTATION_TYPES)[number];

  @IsOptional()
  @IsString()
  recordId?: string;

  @IsOptional()
  @IsString()
  clientRecordId?: string;

  @IsOptional()
  @IsObject()
  cells?: Record<string, unknown>;

  @IsOptional()
  @Allow()
  baseVersion?: number;

  @IsOptional()
  @IsArray()
  records?: Array<{ clientRecordId: string; cells?: Record<string, unknown> }>;

  @IsOptional()
  @IsString()
  clientFieldId?: string;

  @IsOptional()
  @IsString()
  fieldId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  fieldType?: string;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown> | null;

  @IsOptional()
  @Allow()
  required?: boolean;

  @IsOptional()
  @Allow()
  hidden?: boolean;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @Allow()
  size?: number;

  @IsOptional()
  @IsString()
  shareToken?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CommitChangesDto {
  @IsUUID()
  clientBatchId!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SheetMutationDto)
  mutations!: SheetMutationDto[];
}
