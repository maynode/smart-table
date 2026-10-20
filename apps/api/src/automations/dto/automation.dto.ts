import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAutomationDto {
  @IsUUID()
  baseId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsObject()
  trigger!: Record<string, unknown>;

  @IsArray()
  @IsObject({ each: true })
  steps!: Array<Record<string, unknown>>;

  @IsOptional()
  @IsIn(['continue', 'stop'])
  onFindEmpty?: 'continue' | 'stop';

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyQuota?: number | null;
}

export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  steps?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsIn(['continue', 'stop'])
  onFindEmpty?: 'continue' | 'stop';

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyQuota?: number | null;
}

export class ManualRunDto {
  @IsOptional()
  @IsUUID()
  recordId?: string;

  @IsOptional()
  @IsObject()
  cells?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
