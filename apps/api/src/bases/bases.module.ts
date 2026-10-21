import { Module } from '@nestjs/common';
import { SharingModule } from '../sharing/sharing.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BaseLookupController } from './base-lookup.controller';
import { BasesController } from './bases.controller';
import { BasesService } from './bases.service';

@Module({
  imports: [WorkspacesModule, SharingModule],
  controllers: [BasesController, BaseLookupController],
  providers: [BasesService],
  exports: [BasesService],
})
export class BasesModule {}
