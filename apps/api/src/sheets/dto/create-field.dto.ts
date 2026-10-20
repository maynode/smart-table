import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength, Min } from 'class-validator';
import { FIELD_TYPES, type FieldType } from 'shared';

export class CreateFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsIn(FIELD_TYPES as unknown as string[])
  type!: FieldType;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
