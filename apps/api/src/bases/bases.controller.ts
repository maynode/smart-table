import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { BasesService } from './bases.service';
import { CreateBaseDto } from './dto/create-base.dto';
import { ReorderBasesDto } from './dto/reorder-bases.dto';

@Controller('workspaces/:workspaceId/bases')
@UseGuards(JwtAuthGuard)
export class BasesController {
  constructor(private readonly basesService: BasesService) {}

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateBaseDto,
  ) {
    return this.basesService.create(
      workspaceId,
      user.sub,
      dto.name,
      dto.description,
    );
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.basesService.list(workspaceId, user.sub);
  }

  @Post('reorder')
  reorder(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: ReorderBasesDto,
  ) {
    return this.basesService.reorder(workspaceId, user.sub, dto.orderedIds);
  }
}
