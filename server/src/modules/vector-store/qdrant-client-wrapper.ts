import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';

import {
  QdrantDistance,
  QdrantFieldSchema,
  QdrantFilter,
  QdrantPayload,
  QdrantPoint,
  QdrantVectorConfig,
  VectorStoreFailure,
} from './vector-store.types';

interface StoredQdrantPoint {
  vector: number[];
  payload: QdrantPayload;
}

@Injectable()
export class QdrantClientWrapper implements OnModuleInit {
  private client: QdrantClient | null = null;
  private readonly mockStore = new Map<string, StoredQdrantPoint>();
  private readonly mockIndexes = new Set<string>();
  private mockCollection: QdrantVectorConfig | null = null;
  private readonly url: string;
  private readonly collection: string;
  private readonly mock: boolean;

  constructor(configService: ConfigService) {
    this.url = configService.getOrThrow<string>('qdrant.url');
    this.collection =
      configService.getOrThrow<string>('qdrant.collection');
    this.mock = configService.getOrThrow<boolean>('qdrant.mock');
  }

  onModuleInit(): void {
    if (!this.mock) {
      this.client = new QdrantClient({ url: this.url });
    }
  }

  isMockEnabled(): boolean {
    return this.mock;
  }

  async collectionExists(): Promise<boolean> {
    if (this.mock) {
      return this.mockCollection !== null;
    }

    const result = await this.getClient().collectionExists(
      this.collection,
    );
    return result.exists;
  }

  async getCollection(): Promise<QdrantVectorConfig> {
    if (this.mock) {
      if (this.mockCollection === null) {
        throw new VectorStoreFailure('Qdrant Collection 不存在');
      }

      return this.mockCollection;
    }

    const collection = await this.getClient().getCollection(
      this.collection,
    );
    const vectors = collection.config.params.vectors;

    if (!this.isSingleVectorConfig(vectors)) {
      throw new VectorStoreFailure(
        'Qdrant Collection 向量配置不兼容',
      );
    }

    return {
      size: vectors.size,
      distance: vectors.distance,
    };
  }

  async createCollection(
    size: number,
    distance: QdrantDistance,
  ): Promise<void> {
    if (this.mock) {
      this.mockCollection = { size, distance };
      return;
    }

    await this.getClient().createCollection(this.collection, {
      vectors: { size, distance },
    });
  }

  async createFieldIndex(
    fieldName: string,
    fieldSchema: QdrantFieldSchema,
  ): Promise<void> {
    if (this.mock) {
      this.mockIndexes.add(`${fieldName}:${fieldSchema}`);
      return;
    }

    try {
      await this.getClient().createPayloadIndex(this.collection, {
        wait: true,
        field_name: fieldName,
        field_schema: fieldSchema,
      });
    } catch (error: unknown) {
      if (this.isAlreadyExistsError(error)) {
        return;
      }

      throw error;
    }
  }

  async upsertPoints(points: QdrantPoint[]): Promise<void> {
    if (this.mock) {
      points.forEach((point) => {
        this.mockStore.set(point.id, {
          vector: point.vector,
          payload: point.payload,
        });
      });
      return;
    }

    const request: Parameters<QdrantClient['upsert']>[1] = {
      wait: true,
      points,
    };
    await this.getClient().upsert(this.collection, request);
  }

  async deleteByFilter(filter: QdrantFilter): Promise<void> {
    if (this.mock) {
      for (const [id, point] of this.mockStore.entries()) {
        if (this.matchesFilter(point.payload, filter)) {
          this.mockStore.delete(id);
        }
      }
      return;
    }

    const request: Parameters<QdrantClient['delete']>[1] = {
      wait: true,
      filter,
    };
    await this.getClient().delete(this.collection, request);
  }

  async countPoints(filter?: QdrantFilter): Promise<number> {
    if (this.mock) {
      let count = 0;

      for (const point of this.mockStore.values()) {
        if (
          filter === undefined ||
          this.matchesFilter(point.payload, filter)
        ) {
          count += 1;
        }
      }

      return count;
    }

    const request: Parameters<QdrantClient['count']>[1] = {
      exact: true,
      filter,
    };
    const result = await this.getClient().count(
      this.collection,
      request,
    );

    return result.count;
  }

  private getClient(): QdrantClient {
    if (this.client === null) {
      throw new VectorStoreFailure('Qdrant client 尚未初始化');
    }

    return this.client;
  }

  private matchesFilter(
    payload: QdrantPayload,
    filter: QdrantFilter,
  ): boolean {
    return filter.must.every(
      (condition) =>
        payload[condition.key] === condition.match.value,
    );
  }

  private isSingleVectorConfig(
    value: unknown,
  ): value is QdrantVectorConfig {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<QdrantVectorConfig>;

    return (
      typeof candidate.size === 'number' &&
      typeof candidate.distance === 'string'
    );
  }

  private isAlreadyExistsError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes('409') ||
        error.message.toLowerCase().includes('already exists'))
    );
  }
}
