import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { CurrentApiKey } from '../api-keys/current-api-key.decorator';
import type { OpenApiKey } from '../api-keys/api-key.guard';
import { OpenApiService } from './openapi.service';

@Controller('open/v1')
@UseGuards(ApiKeyGuard)
export class OpenApiController {
  constructor(private readonly openApi: OpenApiService) {}

  @Get('workspaces/:workspaceId/bases')
  listBases(
    @CurrentApiKey() key: OpenApiKey,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.openApi.listBases(workspaceId, key);
  }

  @Post('workspaces/:workspaceId/bases')
  createBase(
    @CurrentApiKey() key: OpenApiKey,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: { name: string },
  ) {
    return this.openApi.createBase(workspaceId, key, body.name);
  }

  @Get('bases/:baseId')
  getBase(
    @CurrentApiKey() key: OpenApiKey,
    @Param('baseId', ParseUUIDPipe) baseId: string,
  ) {
    return this.openApi.getBase(baseId, key);
  }

  @Get('bases/:baseId/sheets')
  listSheets(
    @CurrentApiKey() key: OpenApiKey,
    @Param('baseId', ParseUUIDPipe) baseId: string,
  ) {
    return this.openApi.listSheets(baseId, key);
  }

  @Post('bases/:baseId/sheets')
  createSheet(
    @CurrentApiKey() key: OpenApiKey,
    @Param('baseId', ParseUUIDPipe) baseId: string,
    @Body() body: { name: string },
  ) {
    return this.openApi.createSheet(baseId, key, body.name);
  }

  @Get('sheets/:sheetId/fields')
  listFields(
    @CurrentApiKey() key: OpenApiKey,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
  ) {
    return this.openApi.listFields(sheetId, key);
  }

  @Post('sheets/:sheetId/fields')
  createField(
    @CurrentApiKey() key: OpenApiKey,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
    @Body()
    body: {
      name: string;
      type: string;
      required?: boolean;
      options?: Record<string, unknown>;
    },
  ) {
    return this.openApi.createField(sheetId, key, body);
  }

  @Get('sheets/:sheetId/records')
  listRecords(
    @CurrentApiKey() key: OpenApiKey,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
    @Query() query: { limit?: string; cursor?: string },
  ) {
    return this.openApi.listRecords(sheetId, key, query);
  }

  @Post('sheets/:sheetId/records')
  createRecord(
    @CurrentApiKey() key: OpenApiKey,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
    @Body() body: { cells: Record<string, unknown> },
  ) {
    return this.openApi.createRecord(sheetId, key, body.cells);
  }

  @Patch('records/:id')
  updateRecord(
    @CurrentApiKey() key: OpenApiKey,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { cells: Record<string, unknown>; expectedVersion?: number },
  ) {
    return this.openApi.updateRecord(id, key, body);
  }

  @Delete('records/:id')
  deleteRecord(
    @CurrentApiKey() key: OpenApiKey,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.openApi.deleteRecord(id, key);
  }

  @Get('bases/:baseId/forms')
  listForms(
    @CurrentApiKey() key: OpenApiKey,
    @Param('baseId', ParseUUIDPipe) baseId: string,
  ) {
    return this.openApi.listForms(baseId, key);
  }
}
