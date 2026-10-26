import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { MAX_RECORD_PAGE_LIMIT } from 'shared';

export class ListRecordsQueryDto {
  /** Opaque record id cursor（与 offset 二选一；窗口加载用 offset）. */
  @IsOptional()
  @IsUUID()
  cursor?: string;

  /** 按排序位置跳过 N 行（大表视口窗口；深 offset 可能较慢）. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RECORD_PAGE_LIMIT)
  limit?: number;
}
