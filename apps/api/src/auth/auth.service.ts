import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import {
  normalizeAccount,
  normalizeSecurityAnswer,
  validateAccount,
  validatePassword,
  validateSecurityAnswer,
  validateSecurityQuestion,
} from 'shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password';

export interface PublicUser {
  id: string;
  account: string;
  name: string;
  createdAt: Date;
}

export interface AuthResult {
  accessToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(
    accountRaw: string,
    password: string,
    securityQuestionRaw: string,
    securityAnswerRaw: string,
  ): Promise<AuthResult> {
    const accountError = validateAccount(accountRaw);
    if (accountError) throw new BadRequestException(accountError);
    const passwordError = validatePassword(password);
    if (passwordError) throw new BadRequestException(passwordError);
    const questionError = validateSecurityQuestion(securityQuestionRaw);
    if (questionError) throw new BadRequestException(questionError);
    const answerError = validateSecurityAnswer(securityAnswerRaw);
    if (answerError) throw new BadRequestException(answerError);

    const account = normalizeAccount(accountRaw);
    const securityQuestion = securityQuestionRaw.trim();
    const passwordHash = await hashPassword(password);
    const securityAnswerHash = await hashPassword(
      normalizeSecurityAnswer(securityAnswerRaw),
    );

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          account,
          passwordHash,
          // 展示名直接用账号，不再单独收集姓名
          name: account,
          securityQuestion,
          securityAnswerHash,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该账号已注册');
      }
      throw error;
    }

    return this.issueToken(user);
  }

  async login(accountRaw: string, password: string): Promise<AuthResult> {
    const account = normalizeAccount(accountRaw);
    if (!account) {
      throw new BadRequestException('请输入账号');
    }
    const user = await this.prisma.user.findUnique({
      where: { account },
    });

    if (!user) {
      throw new NotFoundException('该账号尚未注册');
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedException('密码错误');
    }

    return this.issueToken(user);
  }

  async getRecoveryQuestion(accountRaw: string): Promise<{ question: string }> {
    const account = normalizeAccount(accountRaw);
    if (!account) {
      throw new BadRequestException('请输入账号');
    }
    const user = await this.prisma.user.findUnique({
      where: { account },
      select: { securityQuestion: true },
    });
    if (!user) {
      throw new NotFoundException('该账号尚未注册');
    }
    return { question: user.securityQuestion };
  }

  async resetPasswordWithSecurityAnswer(
    accountRaw: string,
    securityAnswerRaw: string,
    password: string,
  ): Promise<{ ok: true }> {
    const account = normalizeAccount(accountRaw);
    if (!account) {
      throw new BadRequestException('请输入账号');
    }
    const answerError = validateSecurityAnswer(securityAnswerRaw);
    if (answerError) throw new BadRequestException(answerError);
    const passwordError = validatePassword(password);
    if (passwordError) throw new BadRequestException(passwordError);

    const user = await this.prisma.user.findUnique({ where: { account } });
    if (!user) {
      throw new NotFoundException('该账号尚未注册');
    }

    const answerOk = await verifyPassword(
      user.securityAnswerHash,
      normalizeSecurityAnswer(securityAnswerRaw),
    );
    if (!answerOk) {
      throw new UnauthorizedException('密保答案错误');
    }

    const passwordHash = await hashPassword(password);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    return { ok: true };
  }

  async getUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('登录状态已失效');
    }
    return toPublicUser(user);
  }

  async issueForUser(user: User): Promise<AuthResult> {
    return this.issueToken(user);
  }

  private async issueToken(user: User): Promise<AuthResult> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      account: user.account,
    });
    return { accessToken, user: toPublicUser(user) };
  }
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    account: user.account,
    name: user.name,
    createdAt: user.createdAt,
  };
}
