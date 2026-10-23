import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AnalysisReportsController } from './analysis-reports.controller';
import { AnalysisReportsService } from './analysis-reports.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [AnalysisReportsController],
  providers: [AnalysisReportsService],
})
export class AnalysisReportsModule {}
