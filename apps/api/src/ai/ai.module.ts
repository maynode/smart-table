import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { SheetDigestService } from './sheet-digest.service';

@Module({
  imports: [PermissionsModule],
  providers: [SheetDigestService],
  exports: [SheetDigestService],
})
export class AiModule {}
