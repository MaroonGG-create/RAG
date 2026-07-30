import { isAbsolute, resolve } from 'node:path';

export interface AppConfiguration {
  server: {
    port: number;
    corsOrigin: string;
  };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  };
  upload: {
    dir: string;
    maxFileSizeMb: number;
  };
  chunk: {
    size: number;
    overlap: number;
  };
  embedding: {
    baseUrl: string;
    apiKey: string;
    model: string;
    dimension: number;
    batchSize: number;
    timeoutMs: number;
    maxRetries: number;
    mock: boolean;
  };
}

export default function configuration(): AppConfiguration {
  const configuredUploadDir = process.env.UPLOAD_DIR ?? '';
  const config: AppConfiguration = {
    server: {
      port: Number(process.env.SERVER_PORT),
      corsOrigin: process.env.CORS_ORIGIN ?? '',
    },
    database: {
      host: process.env.DB_HOST ?? '',
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USER ?? '',
      password: process.env.DB_PASSWORD ?? '',
      name: process.env.DB_NAME ?? '',
    },
    upload: {
      // src/config 与 dist/config 向上两级均为 server 根目录，避免路径依赖 cwd。
      dir: isAbsolute(configuredUploadDir)
        ? configuredUploadDir
        : resolve(__dirname, '../..', configuredUploadDir),
      maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB),
    },
    chunk: {
      size: Number(process.env.CHUNK_SIZE ?? 500),
      overlap: Number(process.env.CHUNK_OVERLAP ?? 100),
    },
    embedding: {
      baseUrl: process.env.EMBEDDING_BASE_URL ?? '',
      apiKey: process.env.EMBEDDING_API_KEY ?? '',
      model: process.env.EMBEDDING_MODEL ?? '',
      dimension: Number(process.env.EMBEDDING_DIMENSION ?? 1024),
      batchSize: Number(process.env.EMBEDDING_BATCH_SIZE ?? 20),
      timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? 30000),
      maxRetries: Number(process.env.EMBEDDING_MAX_RETRIES ?? 3),
      mock: process.env.EMBEDDING_MOCK === 'true',
    },
  };

  if (config.chunk.overlap >= config.chunk.size) {
    throw new Error('CHUNK_OVERLAP 必须小于 CHUNK_SIZE');
  }

  return config;
}
