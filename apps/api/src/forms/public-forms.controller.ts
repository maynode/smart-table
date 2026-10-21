import {
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FormsService } from './forms.service';
import { SubmitFormDto } from './dto/form-config.dto';

@Controller('public/forms')
export class PublicFormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.formsService.getPublic(token);
  }

  @Post(':token/submit')
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Param('token') token: string,
    @Body() dto: SubmitFormDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.formsService.submit(token, dto.cells, request.ip);
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
}
