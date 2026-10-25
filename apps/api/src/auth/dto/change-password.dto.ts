import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: '请输入当前密码' })
  currentPassword!: string;

  @IsString()
  @MinLength(1, { message: '请输入新密码' })
  newPassword!: string;
}
