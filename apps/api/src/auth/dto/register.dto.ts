import {
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import {
  ACCOUNT_MAX_LENGTH,
  ACCOUNT_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateAccount,
  validatePassword,
} from 'shared';

@ValidatorConstraint({ name: 'accountPassword', async: false })
class AccountPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && validatePassword(value) === null;
  }

  defaultMessage(args?: ValidationArguments): string {
    const value = args?.value;
    if (typeof value === 'string') {
      return validatePassword(value) ?? '密码不符合要求';
    }
    return '密码不符合要求';
  }
}

@ValidatorConstraint({ name: 'loginAccount', async: false })
class LoginAccountConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && validateAccount(value) === null;
  }

  defaultMessage(args?: ValidationArguments): string {
    const value = args?.value;
    if (typeof value === 'string') {
      return validateAccount(value) ?? '账号不符合要求';
    }
    return '账号不符合要求';
  }
}

export { AccountPasswordConstraint };

export class RegisterDto {
  @IsString()
  @MinLength(ACCOUNT_MIN_LENGTH)
  @MaxLength(ACCOUNT_MAX_LENGTH)
  @Validate(LoginAccountConstraint)
  account!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Validate(AccountPasswordConstraint)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  securityQuestion!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  securityAnswer!: string;
}
