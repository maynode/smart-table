import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BaseLookupController } from './base-lookup.controller';
import { BasesController } from './bases.controller';
import { BasesService } from './bases.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [BasesController, BaseLookupController],
  providers: [BasesService],
  exports: [BasesService],
})
export class BasesModule {}
