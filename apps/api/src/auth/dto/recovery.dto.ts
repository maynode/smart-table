import {
  IsString,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import { AccountPasswordConstraint } from './register.dto';

export class RecoveryQuestionDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  account!: string;
}

export class RecoveryResetDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  account!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  securityAnswer!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Validate(AccountPasswordConstraint)
  password!: string;
}
