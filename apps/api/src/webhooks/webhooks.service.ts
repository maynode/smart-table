import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const EVENTS = ['record.created', 'record.updated', 'record.deleted'] as const;
const MAX_ATTEMPTS = 3;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async create(
    workspaceId: string,
    userId: string,
    body: { url: string; events?: string[] },
  ) {
    await this.workspaces.requireMember(workspaceId, userId, 'admin');
    let parsed: URL;
    try {
      parsed = new URL(body.url);
    } catch {
      throw new BadRequestException('Webhook URL 无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Webhook 仅支持 http/https');
    }
    const events = body.events?.length ? body.events : [...EVENTS];
    for (const event of events) {
      if (!EVENTS.includes(event as (typeof EVENTS)[number])) {
        throw new BadRequestException(`不支持的事件：${event}`);
      }
    }
    return this.prisma.webhook.create({
      data: {
        workspaceId,
        url: body.url,
        secret: randomBytes(24).toString('hex'),
        events: events as unknown as Prisma.InputJsonValue,
        createdBy: userId,
      },
    });
  }

  async list(workspaceId: string, userId: string) {
    await this.workspaces.requireMember(workspaceId, userId, 'viewer');
    return this.prisma.webhook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(webhookId: string, userId: string) {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id: webhookId },
    });
    if (!webhook) throw new NotFoundException('Webhook 不存在');
    await this.workspaces.requireMember(
      webhook.workspaceId,
      userId,
      'admin',
    );
    await this.prisma.webhook.delete({ where: { id: webhookId } });
    return { id: webhookId, deleted: true };
  }

  async deliveries(
    webhookId: string,
    userId: string,
    status?: string,
  ) {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id: webhookId },
    });
    if (!webhook) throw new NotFoundException('Webhook 不存在');
    await this.workspaces.requireMember(
      webhook.workspaceId,
      userId,
      'viewer',
    );
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async retry(deliveryId: string, userId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
    if (!delivery) throw new NotFoundException('投递记录不存在');
    await this.workspaces.requireMember(
      delivery.webhook.workspaceId,
      userId,
      'admin',
    );
    const reset = await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'pending',
        attempts: 0,
        error: '',
        nextRetryAt: null,
      },
    });
    void this.deliver(reset.id);
    return reset;
  }

  async emitForSheet(
    sheetId: string,
    event: (typeof EVENTS)[number],
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { base: { select: { workspaceId: true } } },
    });
    if (!sheet) return;
    await this.emit(sheet.base.workspaceId, event, {
      ...payload,
      sheetId,
      baseId: sheet.baseId,
    });
  }

  async emit(
    workspaceId: string,
    event: (typeof EVENTS)[number],
    payload: Record<string, unknown>,
  ): Promise<void> {
    const hooks = await this.prisma.webhook.findMany({
      where: { workspaceId, active: true },
    });
    const matching = hooks.filter((hook) => {
      const events = Array.isArray(hook.events)
        ? hook.events.map(String)
        : [];
      return events.includes(event);
    });
    for (const hook of matching) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          event,
          payload: payload as Prisma.InputJsonValue,
          status: 'pending',
        },
      });
      void this.deliver(delivery.id);
    }
  }

  async deliver(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
    if (!delivery || !delivery.webhook.active) return;
    const attempt = delivery.attempts + 1;
    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    });
    const signature = `sha256=${createHmac('sha256', delivery.webhook.secret)
      .update(body)
      .digest('hex')}`;

    try {
      const response = await fetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SmartTable-Event': delivery.event,
          'X-SmartTable-Signature': signature,
          'X-SmartTable-Delivery': delivery.id,
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'success',
            attempts: attempt,
            responseStatus: response.status,
            deliveredAt: new Date(),
            error: '',
            nextRetryAt: null,
          },
        });
        return;
      }
      await this.fail(
        delivery.id,
        attempt,
        `HTTP ${response.status}`,
        response.status,
      );
    } catch (error) {
      this.logger.warn(
        `webhook ${delivery.webhook.id} attempt ${attempt} failed: ${String(
          error,
        )}`,
      );
      await this.fail(
        delivery.id,
        attempt,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async fail(
    deliveryId: string,
    attempt: number,
    message: string,
    responseStatus?: number,
  ): Promise<void> {
    if (attempt >= MAX_ATTEMPTS) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'failed',
          attempts: attempt,
          error: message,
          responseStatus: responseStatus ?? null,
          nextRetryAt: null,
        },
      });
      return;
    }
    const delay = 200 * 2 ** (attempt - 1);
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'pending',
        attempts: attempt,
        error: message,
        responseStatus: responseStatus ?? null,
        nextRetryAt: new Date(Date.now() + delay),
      },
    });
    const timer = setTimeout(() => {
      void this.deliver(deliveryId);
    }, delay);
    timer.unref?.();
  }
}
