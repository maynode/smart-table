import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { ActivityCoreModule } from './activity-core.module';
import { ActivityController } from './activity.controller';
import { ActivityInterceptor } from './activity.interceptor';

@Module({
  imports: [AuthModule, ActivityCoreModule],
  controllers: [ActivityController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityInterceptor,
    },
  ],
  exports: [ActivityCoreModule],
})
export class ActivityModule {}
