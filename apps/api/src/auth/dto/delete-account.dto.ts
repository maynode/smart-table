import { IsString, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @MinLength(1, { message: '请输入密码' })
  password!: string;
}
