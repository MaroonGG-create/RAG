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
  };

  if (config.chunk.overlap >= config.chunk.size) {
    throw new Error('CHUNK_OVERLAP 必须小于 CHUNK_SIZE');
  }

  return config;
}
