import { IsInt, IsObject, IsOptional, Min } from 'class-validator';

export class UpdateRecordDto {
  @IsObject()
  cells!: Record<string, unknown>;

  /** Optimistic concurrency: stale writes get 409 instead of silently winning. */
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
