import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { DataSyncService } from './data-sync.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class DataSyncController {
  constructor(private readonly sync: DataSyncService) {}

  @Post('sheets/:sheetId/data-syncs/files')
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
    @Req() request: FastifyRequest,
  ) {
    const file = await (
      request as FastifyRequest & {
        file: () => Promise<MultipartFile | undefined>;
      }
    ).file();
    if (!file) throw new BadRequestException('缺少上传文件');
    if (file.file.truncated) throw new BadRequestException('文件过大');
    return this.sync.uploadFile(sheetId, user.sub, {
      filename: file.filename,
      mimetype: file.mimetype,
      buffer: await file.toBuffer(),
    });
  }

  @Post('sheets/:sheetId/data-syncs')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
    @Body()
    body: {
      name: string;
      sourceType: 'http' | 'file';
      config?: {
        url?: string;
        headers?: Record<string, string>;
        fileId?: string;
      };
      mapping: Record<string, string>;
      matchFieldId?: string;
      mode?: 'upsert' | 'replace';
      cron?: string;
      enabled?: boolean;
    },
  ) {
    return this.sync.create(sheetId, user.sub, body);
  }

  @Get('sheets/:sheetId/data-syncs')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
  ) {
    return this.sync.list(sheetId, user.sub);
  }

  @Post('data-syncs/:id/run')
  @HttpCode(HttpStatus.CREATED)
  run(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sync.run(id, user.sub);
  }

  @Get('data-syncs/:id/runs')
  runs(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sync.runs(id, user.sub);
  }

  @Delete('data-syncs/:id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sync.remove(id, user.sub);
  }
}
