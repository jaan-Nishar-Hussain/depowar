import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@paymesh/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/exception.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';

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