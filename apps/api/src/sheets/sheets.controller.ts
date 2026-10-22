import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { CreateFieldDto } from './dto/create-field.dto';
import { CreateRecordDto } from './dto/create-record.dto';
import { CreateSheetDto } from './dto/create-sheet.dto';
import { ListRecordsQueryDto } from './dto/list-records.query';
import { UpdateFieldDto } from './dto/update-field.dto';
import { UpdateRecordDto } from './dto/update-record.dto';
import { UpdateSheetDto } from './dto/update-sheet.dto';
import { SheetsService } from './sheets.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class SheetsController {
  constructor(private readonly sheetsService: SheetsService) {}

  @Post('bases/:baseId/sheets')
  createSheet(
    @CurrentUser() user: JwtPayload,
    @Param('baseId') baseId: string,
    @Body() dto: CreateSheetDto,
  ) {
    return this.sheetsService.createSheet(baseId, user.sub, dto.name);
  }

  @Get('bases/:baseId/sheets')
  listSheets(
    @CurrentUser() user: JwtPayload,
    @Param('baseId') baseId: string,
  ) {
    return this.sheetsService.listByBase(baseId, user.sub);
  }

  @Get('sheets/:sheetId')
  getSheet(@CurrentUser() user: JwtPayload, @Param('sheetId') sheetId: string) {
    return this.sheetsService.getSheet(sheetId, user.sub);
  }

  @Patch('sheets/:sheetId')
  renameSheet(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
    @Body() dto: UpdateSheetDto,
  ) {
    return this.sheetsService.renameSheet(sheetId, user.sub, dto.name);
  }

  @Delete('sheets/:sheetId')
  deleteSheet(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
  ) {
    return this.sheetsService.deleteSheet(sheetId, user.sub);
  }

  @Post('sheets/:sheetId/fields')
  createField(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
    @Body() dto: CreateFieldDto,
  ) {
    return this.sheetsService.createField(sheetId, user.sub, dto);
  }

  @Patch('fields/:fieldId')
  updateField(
    @CurrentUser() user: JwtPayload,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateFieldDto,
  ) {
    return this.sheetsService.updateField(fieldId, user.sub, dto);
  }

  @Post('sheets/:sheetId/attachments')
  @HttpCode(HttpStatus.CREATED)
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
    @Req() request: FastifyRequest,
  ) {
    const file = await (
      request as FastifyRequest & {
        file(): Promise<MultipartFile | undefined>;
      }
    ).file();
    if (!file) throw new BadRequestException('未选择文件');
    const buffer = await file.toBuffer();
    return this.sheetsService.uploadAttachment(
      sheetId,
      user.sub,
      buffer,
      file.mimetype,
      file.filename,
    );
  }

  @Delete('fields/:fieldId')
  deleteField(
    @CurrentUser() user: JwtPayload,
    @Param('fieldId') fieldId: string,
  ) {
    return this.sheetsService.deleteField(fieldId, user.sub);
  }

  @Get('sheets/:sheetId/records')
  listRecords(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
    @Query() query: ListRecordsQueryDto,
  ) {
    return this.sheetsService.listRecords(sheetId, user.sub, query);
  }

  @Post('sheets/:sheetId/records')
  createRecord(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
    @Body() dto: CreateRecordDto,
  ) {
    return this.sheetsService.createRecord(sheetId, user.sub, dto.cells);
  }

  @Patch('records/:id')
  updateRecord(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRecordDto,
  ) {
    return this.sheetsService.updateRecord(
      id,
      user.sub,
      dto.cells,
      dto.expectedVersion,
    );
  }

  @Delete('records/:id')
  deleteRecord(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.sheetsService.deleteRecord(id, user.sub);
  }
}
