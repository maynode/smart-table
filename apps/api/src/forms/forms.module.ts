import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { PublicFormsController } from './public-forms.controller';

@Module({
  imports: [WorkspacesModule, StorageModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
