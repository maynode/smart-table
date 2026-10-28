import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FeedbackStatus } from '@prisma/client';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { FeedbackService } from './feedback.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post('feedback')
  create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: { content?: string; pagePath?: string; imageUrls?: string[] },
  ) {
    return this.feedback.create(user.sub, {
      content: body.content ?? '',
      pagePath: body.pagePath,
      imageUrls: body.imageUrls,
    });
  }

  @Post('feedback/attachments')
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
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
    const buffer = await file.toBuffer();
    return this.feedback.uploadImage(
      user.sub,
      buffer,
      file.mimetype,
      file.filename,
    );
  }

  @Get('admin/feedback')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: FeedbackStatus | 'all',
  ) {
    return this.feedback.listForAdmin(user.sub, status);
  }

  @Patch('admin/feedback/:id')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: FeedbackStatus },
  ) {
    return this.feedback.updateStatus(
      user.sub,
      id,
      body.status as FeedbackStatus,
    );
  }
}
