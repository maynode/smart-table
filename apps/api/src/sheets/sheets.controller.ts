import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { CreateFieldDto } from './dto/create-field.dto';
import { CreateRecordDto } from './dto/create-record.dto';
import { CreateSheetDto } from './dto/create-sheet.dto';
import { ListRecordsQueryDto } from './dto/list-records.query';
import { UpdateFieldDto } from './dto/update-field.dto';
import { UpdateRecordDto } from './dto/update-record.dto';
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
}
