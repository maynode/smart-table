import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import {
  ACCOUNT_TAKEN_MESSAGE,
  createAvatarSeed,
  normalizeAccount,
  normalizeSecurityAnswer,
  validateAccount,
  validatePassword,
  validateSecurityAnswer,
  validateSecurityQuestion,
} from 'shared';
import { CollabRoomService } from '../collab/collab-room.service';
import { LiveBusService } from '../live/live-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { hashPassword, verifyPassword } from './password';

/** 自定义头像上传上限（前端裁剪后约几十 KB） */
const AVATAR_MAX_BYTES = 64 * 1024;
const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface PublicUser {
  id: string;
  account: string;
  name: string;
  avatarSeed: string;
  avatarUrl: string | null;
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
    private readonly storage: StorageService,
    private readonly moduleRef: ModuleRef,
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

    const avatarSeed = createAvatarSeed(account);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          account,
          passwordHash,
          // 展示名直接用用户名，不再单独收集姓名
          name: account,
          avatarSeed,
          securityQuestion,
          securityAnswerHash,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(ACCOUNT_TAKEN_MESSAGE);
      }
      throw error;
    }

    await this.claimWorkspaceInvites(user.id, account);
    return this.issueToken(user);
  }

  /** 注册后认领「待加入」邀请，转为正式工作区成员 */
  private async claimWorkspaceInvites(
    userId: string,
    account: string,
  ): Promise<void> {
    const invites = await this.prisma.workspaceInvite.findMany({
      where: { account },
    });
    if (invites.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const invite of invites) {
        try {
          await tx.workspaceMember.create({
            data: {
              workspaceId: invite.workspaceId,
              userId,
              role: invite.role,
            },
          });
        } catch (error) {
          if (
            !(
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            )
          ) {
            throw error;
          }
        }
        await tx.workspaceInvite.delete({ where: { id: invite.id } });
      }
    });
  }

  async login(accountRaw: string, password: string): Promise<AuthResult> {
    const account = normalizeAccount(accountRaw);
    if (!account) {
      throw new BadRequestException('请输入用户名');
    }
    const user = await this.prisma.user.findUnique({
      where: { account },
    });

    if (!user) {
      throw new NotFoundException('该用户名尚未注册');
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
      throw new BadRequestException('请输入用户名');
    }
    const user = await this.prisma.user.findUnique({
      where: { account },
      select: { securityQuestion: true },
    });
    if (!user) {
      throw new NotFoundException('该用户名尚未注册');
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
      throw new BadRequestException('请输入用户名');
    }
    const answerError = validateSecurityAnswer(securityAnswerRaw);
    if (answerError) throw new BadRequestException(answerError);
    const passwordError = validatePassword(password);
    if (passwordError) throw new BadRequestException(passwordError);

    const user = await this.prisma.user.findUnique({ where: { account } });
    if (!user) {
      throw new NotFoundException('该用户名尚未注册');
    }

    const answerOk = await verifyPassword(
      user.securityAnswerHash,
      normalizeSecurityAnswer(securityAnswerRaw),
    );
    if (!answerOk) {
      throw new UnauthorizedException('密保答案错误');
    }

    const sameAsOld = await verifyPassword(user.passwordHash, password);
    if (sameAsOld) {
      throw new BadRequestException('新密码不能与当前密码相同');
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

  /** 登录态修改用户名（全局唯一；同步展示名） */
  async updateUsername(
    userId: string,
    accountRaw: string,
  ): Promise<PublicUser> {
    const accountError = validateAccount(accountRaw);
    if (accountError) throw new BadRequestException(accountError);
    const account = normalizeAccount(accountRaw);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('登录状态已失效');
    }
    if (user.account === account) {
      return toPublicUser(user);
    }

    const taken = await this.prisma.user.findUnique({ where: { account } });
    if (taken) {
      throw new ConflictException(ACCOUNT_TAKEN_MESSAGE);
    }

    let updated: User;
    try {
      updated = await this.prisma.user.update({
        where: { id: userId },
        data: { account, name: account },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(ACCOUNT_TAKEN_MESSAGE);
      }
      throw error;
    }

    await this.claimWorkspaceInvites(updated.id, account);
    const publicUser = toPublicUser(updated);
    await this.notifyProfileChanged(publicUser, 'username');
    return publicUser;
  }

  /** 登录态更换卡通头像种子（清除自定义上传） */
  async updateAvatar(
    userId: string,
    avatarSeedRaw: string,
  ): Promise<PublicUser> {
    const avatarSeed = avatarSeedRaw.trim();
    if (
      !avatarSeed ||
      avatarSeed.length > 64 ||
      !/^[a-zA-Z0-9_-]+$/.test(avatarSeed)
    ) {
      throw new BadRequestException('头像种子无效');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('登录状态已失效');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarSeed, avatarUrl: null },
    });
    const publicUser = toPublicUser(updated);
    await this.notifyProfileChanged(publicUser, 'avatar');
    return publicUser;
  }

  /** 登录态上传自定义方图头像（裁剪后） */
  async uploadAvatar(
    userId: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<PublicUser> {
    if (!AVATAR_MIME.has(mimetype)) {
      throw new BadRequestException('仅支持 JPG / PNG / WebP');
    }
    if (!buffer.length) {
      throw new BadRequestException('未上传文件');
    }
    if (buffer.byteLength > AVATAR_MAX_BYTES) {
      throw new BadRequestException('头像过大，请压缩后再传（不超过 64KB）');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('登录状态已失效');
    }
    const avatarUrl = await this.storage.saveAvatar(buffer, mimetype);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    const publicUser = toPublicUser(updated);
    await this.notifyProfileChanged(publicUser, 'avatar');
    return publicUser;
  }

  /** 资料变更：成员列表 Live + 在线协同 presence（ModuleRef 避开 Auth↔Live/Collab 环） */
  private async notifyProfileChanged(
    user: PublicUser,
    action: 'avatar' | 'username',
  ): Promise<void> {
    try {
      const live = this.moduleRef.get(LiveBusService, { strict: false });
      const memberships = await this.prisma.workspaceMember.findMany({
        where: { userId: user.id },
        select: { workspaceId: true },
      });
      for (const m of memberships) {
        await live.emit({
          baseId: null,
          workspaceId: m.workspaceId,
          actorId: user.id,
          kind: 'member.changed',
          entityId: user.id,
          userId: user.id,
          meta: {
            workspaceId: m.workspaceId,
            action,
            account: user.account,
            name: user.name,
            avatarSeed: user.avatarSeed,
            avatarUrl: user.avatarUrl,
          },
        });
      }
    } catch {
      /* Live 失败不回滚资料写入 */
    }
    try {
      const collab = this.moduleRef.get(CollabRoomService, { strict: false });
      collab.updateUserProfile(user.id, {
        account: user.account,
        name: user.name,
        avatarSeed: user.avatarSeed,
        avatarUrl: user.avatarUrl,
      });
    } catch {
      /* presence 刷新失败可忽略；客户端仍会靠 live 补 */
    }
  }

  /** 登录态修改密码：校验当前密码后写入新密码。 */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    if (typeof currentPassword !== 'string' || !currentPassword) {
      throw new BadRequestException('请输入当前密码');
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) throw new BadRequestException(passwordError);
    if (currentPassword === newPassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('登录状态已失效');
    }
    const valid = await verifyPassword(user.passwordHash, currentPassword);
    if (!valid) {
      throw new BadRequestException('当前密码错误');
    }

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    return { ok: true };
  }

  /** 校验密码后注销账号；其作为所有者的工作区一并删除。 */
  async deleteAccount(
    userId: string,
    password: string,
  ): Promise<{ ok: true }> {
    if (typeof password !== 'string' || !password) {
      throw new BadRequestException('请输入密码');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('登录状态已失效');
    }
    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      // 用 400 而非 401，避免前端把「密码错误」当成登录失效清会话
      throw new BadRequestException('密码错误');
    }

    const owned = await this.prisma.workspaceMember.findMany({
      where: { userId, role: 'owner' },
      select: { workspaceId: true },
    });
    const ownedIds = owned.map((item) => item.workspaceId);

    await this.prisma.$transaction(async (tx) => {
      if (ownedIds.length > 0) {
        await tx.workspace.deleteMany({ where: { id: { in: ownedIds } } });
      }
      await tx.user.delete({ where: { id: userId } });
    });

    return { ok: true };
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
    avatarSeed: user.avatarSeed || user.account,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
  };
}
