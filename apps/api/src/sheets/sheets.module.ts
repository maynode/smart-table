import { Module, forwardRef } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { CollabModule } from '../collab/collab.module';
import { FormsModule } from '../forms/forms.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SharingModule } from '../sharing/sharing.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AuditModule } from '../audit/audit.module';
import { QuotasModule } from '../quotas/quotas.module';
import { StorageModule } from '../storage/storage.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CommitChangesService } from './commit-changes.service';
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
    forwardRef(() => FormsModule),
    forwardRef(() => CollabModule),
  ],
  controllers: [SheetsController, ExcelController],
  providers: [SheetsService, ExcelService, CommitChangesService],
  exports: [SheetsService, CommitChangesService],
})
export class SheetsModule {}
