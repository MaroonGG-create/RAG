import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
  app.enableCors({
    origin: configService.getOrThrow<string>('server.corsOrigin'),
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Mini RAG API')
    .setDescription(
      '所有非 SSE 接口的成功响应统一包装为 { code: 0, message: "success", data }；本文档中的 Schema 描述 data 部分。',
    )
    .setVersion('0.1.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    useGlobalPrefix: true,
  });

  await app.listen(configService.getOrThrow<number>('server.port'));
}

bootstrap().catch((error: unknown) => {
  console.error('服务启动失败：', error);
  process.exit(1);
});
