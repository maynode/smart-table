import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { QuotasModule } from '../quotas/quotas.module';
import { AutomationQueueService } from './automation-queue.service';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { RecordTimerService } from './record-timer.service';
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
    AutomationSchedulerService,
    RecordTimerService,
    LocalNotifyAdapter,
    {
      provide: NOTIFY_ADAPTER,
      useExisting: LocalNotifyAdapter,
    },
  ],
  exports: [
    AutomationRunnerService,
    AutomationsService,
    AutomationQueueService,
    AutomationSchedulerService,
  ],
})
export class AutomationsModule {}
