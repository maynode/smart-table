import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, AuthResult } from './auth.service';
import { hashPassword } from './password';

interface WecomProfile {
  userid: string;
  name?: string;
  email?: string;
}

@Injectable()
export class WecomAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private get mockIdp(): string {
    return (this.config.get<string>('WECOM_MOCK_IDP_URL') ?? '').replace(
      /\/$/,
      '',
    );
  }

  get enabled(): boolean {
    return (
      this.config.get<string>('WECOM_ENABLED') === 'true' ||
      Boolean(this.mockIdp)
    );
  }

  configView() {
    const redirectUri =
      this.config.get<string>('WECOM_REDIRECT_URI') ??
      'http://localhost:5173/login';
    const corpId = this.config.get<string>('WECOM_CORP_ID') ?? '';
    const authorizeUrl = this.mockIdp
      ? `${this.mockIdp}/authorize?redirect_uri=${encodeURIComponent(
          redirectUri,
        )}&state=wecom`
      : `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(
          corpId,
        )}&redirect_uri=${encodeURIComponent(
          redirectUri,
        )}&response_type=code&scope=snsapi_base&state=wecom#wechat_redirect`;
    return { enabled: this.enabled, authorizeUrl, redirectUri };
  }

  async callback(code: string): Promise<AuthResult> {
    if (!this.enabled) {
      throw new UnauthorizedException('企业微信登录未启用');
    }
    if (!code?.trim()) {
      throw new UnauthorizedException('缺少企业微信授权 code');
    }
    const profile = this.mockIdp
      ? await this.exchangeMock(code.trim())
      : await this.exchangeWecom(code.trim());
    return this.login(profile);
  }

  private async exchangeMock(code: string): Promise<WecomProfile> {
    const response = await fetch(`${this.mockIdp}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new UnauthorizedException('企业微信 mock IdP 校验失败');
    }
    const profile = (await response.json()) as Partial<WecomProfile>;
    if (!profile.userid) {
      throw new UnauthorizedException('企业微信未返回 userid');
    }
    return {
      userid: String(profile.userid),
      name: profile.name,
      email: profile.email,
    };
  }

  private async exchangeWecom(code: string): Promise<WecomProfile> {
    const corpId = this.config.get<string>('WECOM_CORP_ID') ?? '';
    const secret = this.config.get<string>('WECOM_SECRET') ?? '';
    if (!corpId || !secret) {
      throw new UnauthorizedException('企业微信凭证未配置');
    }
    const tokenResponse = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(
        corpId,
      )}&corpsecret=${encodeURIComponent(secret)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const tokenBody = (await tokenResponse.json()) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
    };
    if (!tokenBody.access_token) {
      throw new UnauthorizedException(
        `企业微信 access_token 获取失败: ${tokenBody.errmsg ?? ''}`,
      );
    }
    const infoResponse = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(
        tokenBody.access_token,
      )}&code=${encodeURIComponent(code)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const info = (await infoResponse.json()) as {
      errcode?: number;
      errmsg?: string;
      userid?: string;
    };
    if (!info.userid) {
      throw new UnauthorizedException(
        `企业微信用户解析失败: ${info.errmsg ?? ''}`,
      );
    }
    const detailResponse = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(
        tokenBody.access_token,
      )}&userid=${encodeURIComponent(info.userid)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const detail = (await detailResponse.json()) as {
      name?: string;
      email?: string;
      biz_mail?: string;
    };
    return {
      userid: info.userid,
      name: detail.name,
      email: detail.email || detail.biz_mail,
    };
  }

  private async login(profile: WecomProfile): Promise<AuthResult> {
    let user: User | null = await this.prisma.user.findUnique({
      where: { wecomUserId: profile.userid },
    });
    if (!user && profile.email) {
      user = await this.prisma.user.findUnique({
        where: { email: profile.email.toLowerCase() },
      });
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { wecomUserId: profile.userid },
        });
      }
    }
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email:
            profile.email?.toLowerCase() ??
            `${profile.userid}@wecom.local`,
          name: profile.name?.trim() || profile.userid,
          passwordHash: await hashPassword(
            randomBytes(24).toString('base64url'),
          ),
          wecomUserId: profile.userid,
        },
      });
    }
    return this.auth.issueForUser(user);
  }
}
