import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { BasesService } from './bases.service';

@Controller('bases')
@UseGuards(JwtAuthGuard)
export class BaseLookupController {
  constructor(private readonly basesService: BasesService) {}

  @Get(':baseId')
  detail(@CurrentUser() user: JwtPayload, @Param('baseId') baseId: string) {
    return this.basesService.getDetail(baseId, user.sub);
  }
}
