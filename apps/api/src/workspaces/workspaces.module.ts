import { Module, forwardRef } from '@nestjs/common';
import { QuotasModule } from '../quotas/quotas.module';
import { TemplatesModule } from '../templates/templates.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [QuotasModule, forwardRef(() => TemplatesModule)],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
