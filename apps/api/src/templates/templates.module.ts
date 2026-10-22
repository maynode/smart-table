import { Module, forwardRef } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [forwardRef(() => WorkspacesModule)],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
