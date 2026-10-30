import { Module, forwardRef } from '@nestjs/common';
import { SheetsModule } from '../sheets/sheets.module';
import { StorageModule } from '../storage/storage.module';
import { AiComponentController } from './ai-component.controller';
import { AiComponentService } from './ai-component.service';

@Module({
  imports: [forwardRef(() => SheetsModule), StorageModule],
  controllers: [AiComponentController],
  providers: [AiComponentService],
  exports: [AiComponentService],
})
export class AiComponentModule {}
