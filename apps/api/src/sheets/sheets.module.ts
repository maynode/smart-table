import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SharingModule } from '../sharing/sharing.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AuditModule } from '../audit/audit.module';
import { QuotasModule } from '../quotas/quotas.module';
import { StorageModule } from '../storage/storage.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ExcelController } from './excel.controller';
import { ExcelService } from './excel.service';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';

@Module({
  imports: [
    WorkspacesModule,
    AutomationsModule,
    PermissionsModule,
    SharingModule,
    WebhooksModule,
    AuditModule,
    StorageModule,
    QuotasModule,
  ],
  controllers: [SheetsController, ExcelController],
  providers: [SheetsService, ExcelService],
  exports: [SheetsService],
})
export class SheetsModule {}
