import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { SheetsModule } from '../sheets/sheets.module';
import { OpenApiController } from './openapi.controller';
import { OpenApiService } from './openapi.service';

@Module({
  imports: [ApiKeysModule, SheetsModule],
  controllers: [OpenApiController],
  providers: [OpenApiService],
})
export class OpenApiModule {}
