import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../../database/database.service';

export interface HealthResult {
  status: 'ok';
  db: 'up' | 'down';
  uptime: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async getHealth(): Promise<HealthResult> {
    try {
      const dataSource = await this.databaseService.ensureReady();
      await dataSource.query('SELECT 1');

      return {
        status: 'ok',
        db: 'up',
        uptime: process.uptime(),
      };
    } catch (error: unknown) {
      // 连接恢复后需重新确认 migration 已就绪，不能只依赖连接池自动重连。
      this.databaseService.invalidateReadiness();
      this.logger.error(
        `数据库健康检查失败：${this.getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        status: 'ok',
        db: 'down',
        uptime: process.uptime(),
      };
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '未知错误';
  }
}
