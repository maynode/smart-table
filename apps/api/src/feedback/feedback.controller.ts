import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { JwtService } from '@nestjs/jwt';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { FeedbackService } from './feedback.service';

@Controller()
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly jwt: JwtService,
  ) {}

  /** 登录与匿名均可提交（公开填表扫码场景） */
  @Post('feedback')
  async create(
    @Req() request: FastifyRequest,
    @Body()
    body: { content?: string; pagePath?: string; imageUrls?: string[] },
  ) {
    const userId = await this.optionalUserId(request);
    return this.feedback.create(userId ?? null, {
      content: body.content ?? '',
      pagePath: body.pagePath,
      imageUrls: body.imageUrls,
    }, request.ip);
  }

  @Post('feedback/attachments')
  async uploadAttachment(@Req() request: FastifyRequest) {
    const userId = await this.optionalUserId(request);
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
      userId ?? null,
      buffer,
      file.mimetype,
      file.filename,
      request.ip,
    );
  }

  @Get('admin/feedback')
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: FeedbackStatus | 'all',
  ) {
    return this.feedback.listForAdmin(user.sub, status);
  }

  @Patch('admin/feedback/:id')
  @UseGuards(JwtAuthGuard)
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

  @Delete('admin/feedback/:id')
  @UseGuards(JwtAuthGuard)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.feedback.remove(user.sub, id);
  }

  private async optionalUserId(
    request: FastifyRequest,
  ): Promise<string | undefined> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return undefined;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(
        header.slice('Bearer '.length),
      );
      return payload.sub;
    } catch {
      return undefined;
    }
  }
}
