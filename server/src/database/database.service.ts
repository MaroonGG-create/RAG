import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseService implements OnApplicationBootstrap {
  private readinessPromise?: Promise<DataSource>;

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureReady();
    } catch (error: unknown) {
      // 数据库暂不可用时保留应用进程，由后续健康检查继续触发重试。
      console.error('数据库初始化失败：', error);
    }
  }

  ensureReady(): Promise<DataSource> {
    if (!this.readinessPromise) {
      this.readinessPromise = this.initializeAndRunMigrations().catch(
        (error: unknown) => {
          this.readinessPromise = undefined;
          throw error;
        },
      );
    }

    return this.readinessPromise;
  }

  invalidateReadiness(): void {
    this.readinessPromise = undefined;
  }

  private async initializeAndRunMigrations(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) {
      await this.dataSource.initialize();
    }

    // 初始化成功但迁移失败时，下次重试仍需再次执行迁移。
    await this.dataSource.runMigrations();

    return this.dataSource;
  }
}
