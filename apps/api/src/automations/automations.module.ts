import { Module } from '@nestjs/common';
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
    { provide: NOTIFY_ADAPTER, useExisting: LocalNotifyAdapter },
  ],
  exports: [AutomationRunnerService, AutomationsService, AutomationQueueService],
})
export class AutomationsModule {}
