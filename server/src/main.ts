import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );
  app.enableCors({
    origin: configService.getOrThrow<string>('server.corsOrigin'),
  });

  await app.listen(configService.getOrThrow<number>('server.port'));
}

bootstrap().catch((error: unknown) => {
  console.error('服务启动失败：', error);
  process.exit(1);
});
