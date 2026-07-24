import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TypeOrmModuleOptions,
  TypeOrmOptionsFactory,
} from '@nestjs/typeorm';
import { resolve } from 'node:path';

import { AppEntities } from './entities';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    return {
      type: 'mysql',
      host: this.configService.getOrThrow<string>('database.host'),
      port: this.configService.getOrThrow<number>('database.port'),
      username: this.configService.getOrThrow<string>('database.username'),
      password: this.configService.getOrThrow<string>('database.password'),
      database: this.configService.getOrThrow<string>('database.name'),
      entities: AppEntities,
      migrations: [resolve(__dirname, 'migrations/*{.ts,.js}')],
      // 禁止改为 true，表结构只能经 migration 变更。
      synchronize: false,
      // 保留手动初始化，由 DatabaseService 启动尝试，失败不阻止 Nest 进程。
      manualInitialization: true,
    };
  }
}
