import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Queue worker process: same modules as the API, no HTTP listener. It consumes
 * automation jobs when AUTOMATION_QUEUE=bullmq. Deploy it separately from the
 * API so claim throughput can scale without scaling web traffic.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('ClaimWorker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  logger.log('automation queue worker started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
