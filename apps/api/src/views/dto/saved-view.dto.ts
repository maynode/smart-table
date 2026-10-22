import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSavedViewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsObject()
  query!: Record<string, unknown>;
}

export class UpdateSavedViewDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsObject()
  query?: Record<string, unknown>;
}
