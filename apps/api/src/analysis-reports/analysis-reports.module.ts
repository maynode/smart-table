import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { QuotasModule } from '../quotas/quotas.module';
import { StorageModule } from '../storage/storage.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AnalysisReportsController } from './analysis-reports.controller';
import { AnalysisReportsService } from './analysis-reports.service';

@Module({
  imports: [WorkspacesModule, PermissionsModule, StorageModule, QuotasModule],
  controllers: [AnalysisReportsController],
  providers: [AnalysisReportsService],
})
export class AnalysisReportsModule {}
