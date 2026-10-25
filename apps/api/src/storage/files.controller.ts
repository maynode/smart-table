import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream } from 'node:fs';
import { StorageService } from './storage.service';

@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Get('uploads/:name')
  upload(
    @Param('name') name: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): StreamableFile | void {
    const resolved = this.storage.resolveUpload(name);
    if (resolved.redirectUrl) {
      reply.redirect(resolved.redirectUrl);
      return;
    }
    reply.type(resolved.contentType ?? 'application/octet-stream');
    return new StreamableFile(createReadStream(resolved.path!));
  }

  @Get('covers/:name')
  cover(
    @Param('name') name: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): StreamableFile | void {
    const resolved = this.storage.resolveCover(name);
    if (resolved.redirectUrl) {
      reply.redirect(resolved.redirectUrl);
      return;
    }

    reply.type(resolved.contentType ?? 'application/octet-stream');
    return new StreamableFile(createReadStream(resolved.path!));
  }

  @Get('avatars/:name')
  avatar(
    @Param('name') name: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): StreamableFile | void {
    const resolved = this.storage.resolveAvatar(name);
    if (resolved.redirectUrl) {
      reply.redirect(resolved.redirectUrl);
      return;
    }

    reply.type(resolved.contentType ?? 'image/jpeg');
    return new StreamableFile(createReadStream(resolved.path!));
  }
}
