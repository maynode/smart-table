import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DashboardAiController } from './dashboard-ai.controller';
import { DashboardAiService } from './dashboard-ai.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

@Module({
  imports: [WorkspacesModule, PermissionsModule, AnalyticsModule, AiModule],
  controllers: [DashboardsController, DashboardAiController],
  providers: [DashboardsService, DashboardAiService],
  exports: [DashboardsService],
})
export class DashboardsModule {}
