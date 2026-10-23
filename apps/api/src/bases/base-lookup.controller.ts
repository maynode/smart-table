import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { BasesService } from './bases.service';
import { MoveBaseDto } from './dto/move-base.dto';
import { UpdateBaseDto } from './dto/update-base.dto';

@Controller('bases')
@UseGuards(JwtAuthGuard)
export class BaseLookupController {
  constructor(private readonly basesService: BasesService) {}

  @Get(':baseId')
  detail(@CurrentUser() user: JwtPayload, @Param('baseId') baseId: string) {
    return this.basesService.getDetail(baseId, user.sub);
  }

  @Patch(':baseId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('baseId') baseId: string,
    @Body() dto: UpdateBaseDto,
  ) {
    return this.basesService.update(baseId, user.sub, {
      name: dto.name,
      description: dto.description,
    });
  }

  @Delete(':baseId')
  remove(@CurrentUser() user: JwtPayload, @Param('baseId') baseId: string) {
    return this.basesService.remove(baseId, user.sub);
  }

  @Post(':baseId/move')
  move(
    @CurrentUser() user: JwtPayload,
    @Param('baseId') baseId: string,
    @Body() dto: MoveBaseDto,
  ) {
    return this.basesService.moveToWorkspace(
      baseId,
      user.sub,
      dto.workspaceId,
    );
  }
}
