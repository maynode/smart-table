import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService, PublicUser } from './auth.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { LoginDto } from './dto/login.dto';
import { RecoveryQuestionDto, RecoveryResetDto } from './dto/recovery.dto';
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
    return this.authService.register(
      dto.account,
      dto.password,
      dto.securityQuestion,
      dto.securityAnswer,
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<{
    accessToken: string;
    user: PublicUser;
  }> {
    return this.authService.login(dto.account, dto.password);
  }

  @Post('recovery/question')
  @HttpCode(HttpStatus.OK)
  recoveryQuestion(@Body() dto: RecoveryQuestionDto) {
    return this.authService.getRecoveryQuestion(dto.account);
  }

  @Post('recovery/reset')
  @HttpCode(HttpStatus.OK)
  recoveryReset(@Body() dto: RecoveryResetDto) {
    return this.authService.resetPasswordWithSecurityAnswer(
      dto.account,
      dto.securityAnswer,
      dto.password,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload): Promise<PublicUser> {
    return this.authService.getUser(user.sub);
  }

  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  deleteAccount(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DeleteAccountDto,
  ): Promise<{ ok: true }> {
    return this.authService.deleteAccount(user.sub, dto.password);
  }
}
