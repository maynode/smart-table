import { Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';

/** 仅导出写日志服务，供协同等模块注入，避免重复注册全局拦截器 */
@Module({
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityCoreModule {}
