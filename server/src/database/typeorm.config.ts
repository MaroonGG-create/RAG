import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TypeOrmModuleOptions,
  TypeOrmOptionsFactory,
} from '@nestjs/typeorm';

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
      entities: [],
      // T01 尚无实体；synchronize 仅用于开发阶段，T02 注册实体后继续评估。
      synchronize: true,
      // 延迟到健康检查时连接，避免数据库暂不可用导致 Nest 进程无法启动。
      manualInitialization: true,
    };
  }
}
