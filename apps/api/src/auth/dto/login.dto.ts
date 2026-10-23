import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  ACCOUNT_MAX_LENGTH,
  ACCOUNT_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from 'shared';

export class LoginDto {
  @IsString()
  @MinLength(ACCOUNT_MIN_LENGTH)
  @MaxLength(ACCOUNT_MAX_LENGTH)
  account!: string;

  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
