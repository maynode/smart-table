import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WebhooksService } from './webhooks.service';

/** Webhook 管理 API 已下线；保留 Service 供写路径空跑投递（无订阅则无副作用）. */
@Module({
  imports: [WorkspacesModule],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
