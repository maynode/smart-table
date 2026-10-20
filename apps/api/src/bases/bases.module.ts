import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BasesController } from './bases.controller';
import { BasesService } from './bases.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [BasesController],
  providers: [BasesService],
  exports: [BasesService],
})
export class BasesModule {}
