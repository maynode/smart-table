import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { ExcelService } from './excel.service';

@Controller('sheets')
@UseGuards(JwtAuthGuard)
export class ExcelController {
  constructor(private readonly excel: ExcelService) {}

  @Get(':sheetId/export')
  async export(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', new ParseUUIDPipe()) sheetId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { buffer, filename } = await this.excel.exportSheet(
      sheetId,
      user.sub,
    );
    reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      )
      .header('Content-Length', String(buffer.length));
    return reply.send(buffer);
  }

  @Post(':sheetId/import')
  @HttpCode(HttpStatus.CREATED)
  async import(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', new ParseUUIDPipe()) sheetId: string,
    @Req() request: FastifyRequest,
  ) {
    const file = await (
      request as FastifyRequest & {
        file(): Promise<MultipartFile | undefined>;
      }
    ).file();
    if (!file) {
      throw new BadRequestException('未上传文件');
    }
    if (
      !file.mimetype.includes('spreadsheet') &&
      !file.filename?.toLowerCase().endsWith('.xlsx')
    ) {
      throw new BadRequestException('仅支持 .xlsx 文件');
    }
    const buffer = await file.toBuffer();
    return this.excel.importSheet(sheetId, user.sub, buffer);
  }
}
