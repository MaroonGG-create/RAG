import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface HealthResult {
  status: 'ok';
  db: 'up' | 'down';
  uptime: number;
}

@Injectable()
export class HealthService {
  private initializationPromise?: Promise<DataSource>;

  constructor(private readonly dataSource: DataSource) {}

  async getHealth(): Promise<HealthResult> {
    try {
      await this.ensureDataSourceInitialized();
      await this.dataSource.query('SELECT 1');

      return {
        status: 'ok',
        db: 'up',
        uptime: process.uptime(),
      };
    } catch (error: unknown) {
      console.error('数据库健康检查失败：', error);

      return {
        status: 'ok',
        db: 'down',
        uptime: process.uptime(),
      };
    }
  }

  private async ensureDataSourceInitialized(): Promise<void> {
    if (this.dataSource.isInitialized) {
      return;
    }

    // 并发健康检查共享同一次初始化，失败后清空以便下次请求重试。
    if (!this.initializationPromise) {
      this.initializationPromise = this.dataSource
        .initialize()
        .catch((error: unknown) => {
          this.initializationPromise = undefined;
          throw error;
        });
    }

    await this.initializationPromise;
  }
}
