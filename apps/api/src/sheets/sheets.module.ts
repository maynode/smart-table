import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';

@Module({
  imports: [WorkspacesModule, AutomationsModule],
  controllers: [SheetsController],
  providers: [SheetsService],
  exports: [SheetsService],
})
export class SheetsModule {}
