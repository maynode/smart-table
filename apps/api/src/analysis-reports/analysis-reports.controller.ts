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
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { AnalysisReportsService } from './analysis-reports.service';
import type { AnalysisMessageAttachment } from './analysis-steps';

@Controller()
@UseGuards(JwtAuthGuard)
export class AnalysisReportsController {
  constructor(private readonly reports: AnalysisReportsService) {}

  @Get('bases/:baseId/analysis-reports')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('baseId', new ParseUUIDPipe()) baseId: string,
  ) {
    return this.reports.list(baseId, user.sub);
  }

  @Post('bases/:baseId/analysis-reports')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('baseId', new ParseUUIDPipe()) baseId: string,
    @Body() body: { name?: string },
  ) {
    return this.reports.create(baseId, user.sub, body?.name);
  }

  @Get('analysis-reports/:id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reports.get(id, user.sub);
  }

  @Patch('analysis-reports/:id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { name?: string },
  ) {
    return this.reports.update(id, user.sub, body ?? {});
  }

  @Delete('analysis-reports/:id')
  delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reports.delete(id, user.sub);
  }

  @Post('analysis-reports/:id/attachments')
  @HttpCode(HttpStatus.CREATED)
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ) {
    const file = await (
      request as FastifyRequest & {
        file(): Promise<MultipartFile | undefined>;
      }
    ).file();
    if (!file) throw new BadRequestException('未选择文件');
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new BadRequestException('单个文件需小于 100MB');
      }
      throw error;
    }
    return this.reports.uploadAttachment(
      id,
      user.sub,
      buffer,
      file.mimetype,
      file.filename,
    );
  }

  @Post('analysis-reports/:id/chat')
  chat(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    body: { text?: string; attachments?: AnalysisMessageAttachment[] },
  ) {
    return this.reports.chat(
      id,
      user.sub,
      body?.text ?? '',
      body?.attachments,
    );
  }

  @Post('analysis-reports/:id/answer')
  answer(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    body: { optionId?: string; text?: string; skip?: boolean },
  ) {
    return this.reports.answer(id, user.sub, body ?? {});
  }

  @Post('analysis-reports/:id/generate')
  generate(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reports.generate(id, user.sub);
  }
}
