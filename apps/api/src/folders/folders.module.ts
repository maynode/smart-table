import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [FoldersController],
  providers: [FoldersService],
})
export class FoldersModule {}
