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
}

export default function configuration(): AppConfiguration {
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
  };
}
