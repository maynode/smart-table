import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SheetsModule } from '../sheets/sheets.module';
import { DataSyncController } from './data-sync.controller';
import { DataSyncService } from './data-sync.service';

@Module({
  imports: [SheetsModule, AuditModule],
  controllers: [DataSyncController],
  providers: [DataSyncService],
})
export class DataSyncModule {}
