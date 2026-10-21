import { ConfigService } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LocalNotifyAdapter,
  type AddGroupMembersInput,
  type NotifyAdapter,
  type StartGroupChatInput,
} from '../automations/notify.adapter';

/**
 * WeCom application-message adapter. Uses a mock HTTP endpoint when configured
 * for integration tests, otherwise the real WeCom message/send API.
 */
@Injectable()
export class WecomNotifyAdapter implements NotifyAdapter {
  private readonly logger = new Logger(WecomNotifyAdapter.name);
  private readonly local: LocalNotifyAdapter;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.local = new LocalNotifyAdapter(prisma);
  }

  async sendMessage(input: {
    userIds: string[];
    title: string;
    text: string;
  }): Promise<{ delivered: number }> {
    if (!input.userIds.length) return { delivered: 0 };
    const users = await this.prisma.user.findMany({
      where: { id: { in: input.userIds }, wecomUserId: { not: null } },
      select: { wecomUserId: true },
    });
    const recipients = users
      .map((user) => user.wecomUserId)
      .filter((id): id is string => Boolean(id));
    if (!recipients.length) return { delivered: 0 };

    const mockUrl = (
      this.config.get<string>('WECOM_MOCK_NOTIFY_URL') ?? ''
    ).replace(/\/$/, '');
    if (mockUrl) {
      const response = await fetch(`${mockUrl}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: recipients.join('|'),
          title: input.title,
          text: input.text,
          agentid: this.config.get<string>('WECOM_AGENT_ID') ?? '',
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`WeCom mock notify failed: ${response.status}`);
      }
      return { delivered: recipients.length };
    }

    const corpId = this.config.get<string>('WECOM_CORP_ID') ?? '';
    const secret = this.config.get<string>('WECOM_SECRET') ?? '';
    const agentId = this.config.get<string>('WECOM_AGENT_ID') ?? '';
    if (!corpId || !secret || !agentId) {
      this.logger.warn('WeCom credentials missing, message persisted only');
      return { delivered: 0 };
    }
    const token = await this.accessToken(corpId, secret);
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(
        token,
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: recipients.join('|'),
          msgtype: 'text',
          agentid: Number(agentId),
          text: { content: `${input.title}\n${input.text}` },
        }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const body = (await response.json()) as {
      errcode?: number;
      errmsg?: string;
    };
    if (body.errcode) {
      throw new Error(`WeCom message failed: ${body.errmsg ?? body.errcode}`);
    }
    return { delivered: recipients.length };
  }

  startGroupChat(
    input: StartGroupChatInput,
  ): Promise<{ groupChatId: string }> {
    return this.local.startGroupChat(input);
  }

  addGroupMembers(
    input: AddGroupMembersInput,
  ): Promise<{ groupChatId: string; memberIds: string[] }> {
    return this.local.addGroupMembers(input);
  }

  private async accessToken(corpId: string, secret: string): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(
        corpId,
      )}&corpsecret=${encodeURIComponent(secret)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) throw new Error('WeCom access_token unavailable');
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000,
    };
    return body.access_token;
  }
}
