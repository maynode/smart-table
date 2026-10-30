import { Module } from '@nestjs/common';
import { ActivityCleanupService } from './activity-cleanup.service';
import { ActivityLogService } from './activity-log.service';

/** 仅导出写日志/清理服务，供协同等模块注入，避免重复注册全局拦截器 */
@Module({
  providers: [ActivityLogService, ActivityCleanupService],
  exports: [ActivityLogService, ActivityCleanupService],
})
export class ActivityCoreModule {}
