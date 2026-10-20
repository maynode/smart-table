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
    return this.basesService.create(workspaceId, user.sub, dto.name);
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.basesService.list(workspaceId, user.sub);
  }
}
