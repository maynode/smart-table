import { Module } from '@nestjs/common';
import { SharingModule } from '../sharing/sharing.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { PublicViewsController } from './public-views.controller';
import { PublicViewsService } from './public-views.service';

@Module({
  imports: [WorkspacesModule, SharingModule],
  controllers: [PublicViewsController],
  providers: [PublicViewsService],
})
export class PublicViewsModule {}
