import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitFormDto,
    @Req() request: FastifyRequest,
  ) {
    return this.formsService.submit(token, dto.cells, request.ip);
  }
}
