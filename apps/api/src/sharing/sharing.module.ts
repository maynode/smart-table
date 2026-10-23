import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SharingService } from './sharing.service';

/** Cross-workspace share UI/API removed; service stubs keep access checks member-only. */
@Module({
  imports: [WorkspacesModule],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
