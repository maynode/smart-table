import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { WecomAuthService } from './wecom-auth.service';

@Controller('auth/wecom')
export class WecomAuthController {
  constructor(private readonly wecom: WecomAuthService) {}

  @Get('config')
  config() {
    return this.wecom.configView();
  }

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  callback(@Body() body: { code: string }) {
    return this.wecom.callback(body.code);
  }
}
