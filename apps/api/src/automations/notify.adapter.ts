import { Injectable } from '@nestjs/common';

export const NOTIFY_ADAPTER = 'NOTIFY_ADAPTER';

export interface NotifyAdapter {
  sendMessage(input: {
    userIds: string[];
    title: string;
    text: string;
  }): Promise<{ delivered: number }>;
}

/** 站内通知投递计数；群聊相关能力已下线. */
@Injectable()
export class LocalNotifyAdapter implements NotifyAdapter {
  async sendMessage(input: {
    userIds: string[];
    title: string;
    text: string;
  }): Promise<{ delivered: number }> {
    return { delivered: input.userIds.length };
  }
}
