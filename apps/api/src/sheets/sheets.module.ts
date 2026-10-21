import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ExcelController } from './excel.controller';
import { ExcelService } from './excel.service';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';

@Module({
  imports: [WorkspacesModule, AutomationsModule, PermissionsModule],
  controllers: [SheetsController, ExcelController],
  providers: [SheetsService, ExcelService],
  exports: [SheetsService],
})
export class SheetsModule {}
