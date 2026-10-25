import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { AuthService, PublicUser } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { LoginDto } from './dto/login.dto';
import { RecoveryQuestionDto, RecoveryResetDto } from './dto/recovery.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateUsernameDto } from './dto/update-username.dto';
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

  @Post('username')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  updateUsername(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateUsernameDto,
  ): Promise<PublicUser> {
    return this.authService.updateUsername(user.sub, dto.account);
  }

  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  updateAvatar(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAvatarDto,
  ): Promise<PublicUser> {
    return this.authService.updateAvatar(user.sub, dto.avatarSeed);
  }

  @Post('avatar/upload')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @Req() request: FastifyRequest,
  ): Promise<PublicUser> {
    const file = await (
      request as FastifyRequest & {
        file(): Promise<MultipartFile | undefined>;
      }
    ).file();
    if (!file) {
      throw new BadRequestException('未上传文件');
    }
    const buffer = await file.toBuffer();
    return this.authService.uploadAvatar(user.sub, buffer, file.mimetype);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    return this.authService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
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
