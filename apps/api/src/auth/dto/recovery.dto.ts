import {
  IsString,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import {
  ACCOUNT_MAX_LENGTH,
  ACCOUNT_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from 'shared';
import { AccountPasswordConstraint } from './register.dto';

export class RecoveryQuestionDto {
  @IsString()
  @MinLength(ACCOUNT_MIN_LENGTH)
  @MaxLength(ACCOUNT_MAX_LENGTH)
  account!: string;
}

export class RecoveryResetDto {
  @IsString()
  @MinLength(ACCOUNT_MIN_LENGTH)
  @MaxLength(ACCOUNT_MAX_LENGTH)
  account!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  securityAnswer!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Validate(AccountPasswordConstraint)
  password!: string;
}
