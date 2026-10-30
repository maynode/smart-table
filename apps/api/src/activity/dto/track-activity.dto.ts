import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class TrackActivityDto {
  @IsString()
  @MaxLength(64)
  event!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
