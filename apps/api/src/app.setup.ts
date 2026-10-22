import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';

/** Shared by main.ts and e2e tests so tests exercise the production pipeline. */
export async function configureApp(
  app: INestApplication | NestFastifyApplication,
): Promise<void> {
  // @fastify/multipart bundles its own fastify type augmentation; pnpm can
  // resolve a second fastify type identity, so cast through never here.
  await (app as NestFastifyApplication).register(
    multipart as unknown as never,
    {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
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
