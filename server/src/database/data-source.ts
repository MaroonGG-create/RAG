import 'reflect-metadata';

import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';

import { AppEntities } from './entities';

// 源码与编译产物中的 database 目录层级一致，避免 CLI 依赖执行时的 cwd。
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const dataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: AppEntities,
  migrations: [resolve(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
});

export default dataSource;
