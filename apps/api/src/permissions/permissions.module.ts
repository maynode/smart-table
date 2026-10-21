import { Module } from '@nestjs/common';
import { SharingModule } from '../sharing/sharing.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [WorkspacesModule, SharingModule],
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
