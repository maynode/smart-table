import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WecomNotifyAdapter } from '../notify/wecom.adapter';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { QuotasModule } from '../quotas/quotas.module';
import { AutomationQueueService } from './automation-queue.service';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import {
  LocalNotifyAdapter,
  NOTIFY_ADAPTER,
} from './notify.adapter';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [WorkspacesModule, QuotasModule],
  controllers: [AutomationsController, NotificationsController],
  providers: [
    AutomationsService,
    AutomationRunnerService,
    AutomationQueueService,
    LocalNotifyAdapter,
    {
      provide: NOTIFY_ADAPTER,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) => {
        const mock = config.get<string>('WECOM_MOCK_NOTIFY_URL');
        const enabled = config.get<string>('WECOM_ENABLED') === 'true';
        return mock || enabled
          ? new WecomNotifyAdapter(prisma, config)
          : new LocalNotifyAdapter(prisma);
      },
    },
  ],
  exports: [AutomationRunnerService, AutomationsService, AutomationQueueService],
})
export class AutomationsModule {}
