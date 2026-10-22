import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FormsService } from './forms.service';
import { SubmitFormDto } from './dto/form-config.dto';
import type { JwtPayload } from '../auth/jwt-auth.guard';

@Controller('public/forms')
export class PublicFormsController {
  constructor(
    private readonly formsService: FormsService,
    private readonly jwt: JwtService,
  ) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.formsService.getPublic(token);
  }

  @Post(':token/attachments')
  @HttpCode(HttpStatus.CREATED)
  async uploadAttachment(
    @Param('token') token: string,
    @Req() request: FastifyRequest,
  ) {
    const file = await (
      request as FastifyRequest & {
        file(): Promise<MultipartFile | undefined>;
      }
    ).file();
    if (!file) throw new BadRequestException('未选择文件');
    const buffer = await file.toBuffer();
    return this.formsService.uploadPublicAttachment(
      token,
      buffer,
      file.mimetype,
      file.filename,
    );
  }

  @Post(':token/submit')
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Param('token') token: string,
    @Body() dto: SubmitFormDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // Optional Bearer — WeCom sends 填写者 from the logged-in filler;
    // anonymous public fill still works and falls back to workspace admins.
    const submitterUserId = await this.optionalUserId(request);
    const result = await this.formsService.submit(
      token,
      dto.cells,
      request.ip,
      submitterUserId,
    );
    if (result.status === 'queued') {
      reply.code(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Get(':token/submissions/:submissionId')
  submissionStatus(
    @Param('token') token: string,
    @Param('submissionId') submissionId: string,
  ) {
    return this.formsService.getSubmissionStatus(token, submissionId);
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
