import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import type { AiComponentAttachment } from 'shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { AiComponentService } from './ai-component.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class AiComponentController {
  constructor(private readonly aiComponent: AiComponentService) {}

  @Get('fields/:fieldId/ai-component/session')
  getSession(
    @CurrentUser() user: JwtPayload,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
  ) {
    return this.aiComponent.getSession(fieldId, user.sub);
  }

  @Post('fields/:fieldId/ai-component/attachments')
  async upload(
    @CurrentUser() user: JwtPayload,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Req() request: FastifyRequest,
  ) {
    const file = await (
      request as FastifyRequest & {
        file(): Promise<MultipartFile | undefined>;
      }
    ).file();
    if (!file) throw new BadRequestException('未上传文件');
    const buffer = await file.toBuffer();
    return this.aiComponent.uploadAttachment(
      fieldId,
      user.sub,
      buffer,
      file.mimetype,
      file.filename,
    );
  }

  @Post('fields/:fieldId/ai-component/chat')
  chat(
    @CurrentUser() user: JwtPayload,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body()
    body: { text?: string; attachments?: AiComponentAttachment[] },
  ) {
    return this.aiComponent.chat(
      fieldId,
      user.sub,
      body?.text ?? '',
      body?.attachments,
    );
  }

  @Post('fields/:fieldId/ai-component/generate')
  generate(
    @CurrentUser() user: JwtPayload,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
  ) {
    return this.aiComponent.generate(fieldId, user.sub);
  }

  @Post('fields/:fieldId/ai-component/publish')
  publish(
    @CurrentUser() user: JwtPayload,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
  ) {
    return this.aiComponent.publish(fieldId, user.sub);
  }
}
