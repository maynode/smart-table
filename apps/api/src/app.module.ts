import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BasesModule } from './bases/bases.module';
import { CommentsModule } from './comments/comments.module';
import { AutomationsModule } from './automations/automations.module';
import { FeedbackModule } from './feedback/feedback.module';
import { FormsModule } from './forms/forms.module';
import { HealthController } from './health.controller';
import { AnalysisReportsModule } from './analysis-reports/analysis-reports.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AuditModule } from './audit/audit.module';
import { QuotasModule } from './quotas/quotas.module';
import { PublicViewsModule } from './public-views/public-views.module';
import { SharingModule } from './sharing/sharing.module';
import { TemplatesModule } from './templates/templates.module';
import { MetricsModule } from './metrics/metrics.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PrismaModule } from './prisma/prisma.module';
import { SheetsModule } from './sheets/sheets.module';
import { StorageModule } from './storage/storage.module';
import { ViewsModule } from './views/views.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { CollabModule } from './collab/collab.module';
import { LiveModule } from './live/live.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuthModule,
    LiveModule,
    WorkspacesModule,
    BasesModule,
    SheetsModule,
    CollabModule,
    CommentsModule,
    AutomationsModule,
    FormsModule,
    FeedbackModule,
    StorageModule,
    MetricsModule,
    PermissionsModule,
    ViewsModule,
    DashboardsModule,
    AnalysisReportsModule,
    SharingModule,
    PublicViewsModule,
    WebhooksModule,
    AuditModule,
    QuotasModule,
    TemplatesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
