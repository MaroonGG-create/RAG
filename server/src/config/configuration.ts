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
}

export default function configuration(): AppConfiguration {
  const configuredUploadDir = process.env.UPLOAD_DIR ?? '';

  return {
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
  };
}
