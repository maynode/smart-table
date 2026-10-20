import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared by main.ts and e2e tests so tests exercise the production pipeline. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: true, credentials: true });
}
