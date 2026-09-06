import 'reflect-metadata';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { config as loadDotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@paymesh/config';
import { AppModule } from './app.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { RoutingMetricsService } from './metrics/routing-metrics.service';

// Load the repo-root .env so `cp .env.example .env` works from the monorepo root.
loadDotenv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('v1');
  app.use(RequestIdMiddleware);
  // Per-response HTTP status counter backing the 5xx-rate alert (PRD §13).
  const routingMetrics = app.get(RoutingMetricsService);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => routingMetrics.recordHttpRequest(res.statusCode));
    next();
  });
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`PayMesh API listening on http://localhost:${env.PORT} (env=${env.APP_ENV})`);
}

void bootstrap();