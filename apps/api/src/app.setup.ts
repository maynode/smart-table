import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import multipart from '@fastify/multipart';

/** Shared by main.ts and e2e tests so tests exercise the production pipeline. */
export async function configureApp(
  app: INestApplication | NestFastifyApplication,
): Promise<void> {
  // Collab gateway uses native ws; e2e must register the same adapter as main.ts
  // or Nest exits looking for socket.io.
  app.useWebSocketAdapter(new WsAdapter(app));
  // @fastify/multipart bundles its own fastify type augmentation; pnpm can
  // resolve a second fastify type identity, so cast through never here.
  await (app as NestFastifyApplication).register(
    multipart as unknown as never,
    {
      // 分析报告 / 附件上传：单文件上限 100MB（与业务校验一致）
      limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: true, credentials: true });
}
