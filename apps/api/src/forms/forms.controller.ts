import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import {
  PreviewSuccessDto,
  UpsertFormDto,
} from './dto/form-config.dto';
import { FormsService } from './forms.service';

@Controller('forms')
@UseGuards(JwtAuthGuard)
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('baseId', new ParseUUIDPipe()) baseId: string,
  ) {
    return this.formsService.listByBase(baseId, user.sub);
  }

  @Post(':id')
  upsert(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertFormDto,
  ) {
    return this.formsService.upsert(id, user.sub, dto);
  }

  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.formsService.getForOwner(id, user.sub);
  }

  @Post(':id/cover')
  @HttpCode(HttpStatus.CREATED)
  async uploadCover(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
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
    return this.formsService.uploadCover(
      id,
      user.sub,
      buffer,
      file.mimetype,
    );
  }

  @Post(':id/success-preview')
  @HttpCode(HttpStatus.OK)
  previewSuccess(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PreviewSuccessDto,
  ) {
    return this.formsService.previewSuccess(id, user.sub, dto);
  }
}
