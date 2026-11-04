import { Module } from '@nestjs/common';
import { ActivityCoreModule } from '../activity/activity-core.module';
import { AiModule } from '../ai/ai.module';
import { AdminUsersModule } from '../admin-users/admin-users.module';
import { AnalysisReportsModule } from '../analysis-reports/analysis-reports.module';
import { AutomationsModule } from '../automations/automations.module';
import { BasesModule } from '../bases/bases.module';
import { CommentsModule } from '../comments/comments.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { FormsModule } from '../forms/forms.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PublicViewsModule } from '../public-views/public-views.module';
import { QuotasModule } from '../quotas/quotas.module';
import { SheetsModule } from '../sheets/sheets.module';
import { TemplatesModule } from '../templates/templates.module';
import { ViewsModule } from '../views/views.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AgentController } from './agent.controller';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentLoopService } from './agent-loop.service';
import { AgentSessionService } from './agent-session.service';
import { AgentTokenService } from './agent-token.service';
import { AgentToolsService } from './agent-tools.service';
import { McpController } from './mcp.controller';

@Module({
  imports: [
    ActivityCoreModule,
    AiModule,
    WorkspacesModule,
    BasesModule,
    SheetsModule,
    ViewsModule,
    FormsModule,
    AutomationsModule,
    DashboardsModule,
    PermissionsModule,
    TemplatesModule,
    CommentsModule,
    PublicViewsModule,
    AnalysisReportsModule,
    QuotasModule,
    AdminUsersModule,
  ],
  controllers: [AgentController, McpController],
  providers: [
    AgentAuthGuard,
    AgentTokenService,
    AgentSessionService,
    AgentToolsService,
    AgentLoopService,
  ],
  exports: [AgentToolsService, AgentTokenService],
})
export class AgentModule {}
