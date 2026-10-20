import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { AutomationsService } from './automations.service';
import {
  CreateAutomationDto,
  ManualRunDto,
  UpdateAutomationDto,
} from './dto/automation.dto';

@Controller('automations')
@UseGuards(JwtAuthGuard)
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('baseId', new ParseUUIDPipe()) baseId: string,
  ) {
    return this.automationsService.list(user.sub, baseId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAutomationDto) {
    return this.automationsService.create(user.sub, dto);
  }

  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.automationsService.get(user.sub, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAutomationDto,
  ) {
    return this.automationsService.update(user.sub, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.automationsService.remove(user.sub, id);
  }

  @Get(':id/runs')
  runs(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.automationsService.listRuns(
      user.sub,
      id,
      limit ? Number(limit) : 50,
    );
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.CREATED)
  run(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ManualRunDto,
  ) {
    return this.automationsService.runManually(user.sub, id, {
      triggerRecordId: dto.recordId,
      triggerCells: dto.cells,
      idempotencyKey: dto.idempotencyKey,
    });
  }
}
