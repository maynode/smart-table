import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthService, PublicUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard, JwtPayload } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<{
    accessToken: string;
    user: PublicUser;
  }> {
    return this.authService.register(dto.email, dto.password, dto.name);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<{
    accessToken: string;
    user: PublicUser;
  }> {
    return this.authService.login(dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload): Promise<PublicUser> {
    return this.authService.getUser(user.sub);
  }
}
