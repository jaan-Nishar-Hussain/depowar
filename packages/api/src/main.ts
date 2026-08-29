import 'reflect-metadata';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@paymesh/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/exception.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';

// Load the repo-root .env so `cp .env.example .env` works from the monorepo root.
loadDotenv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('v1');
  app.use(RequestIdMiddleware);
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`PayMesh API listening on http://localhost:${env.PORT} (env=${env.APP_ENV})`);
}

void bootstrap();