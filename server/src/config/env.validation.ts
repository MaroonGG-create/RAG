import { plainToInstance, Type } from 'class-transformer';
import {
  IsDefined,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SERVER_PORT!: number;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  CORS_ORIGIN!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT!: number;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  DB_USER!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsDefined()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  QDRANT_URL!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  QDRANT_COLLECTION!: string;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  QDRANT_UPSERT_BATCH_SIZE!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  QDRANT_MOCK?: boolean;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  TOP_K!: number;

  @IsDefined()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  SCORE_THRESHOLD!: number;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  UPLOAD_DIR!: string;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1024)
  MAX_FILE_SIZE_MB!: number;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(10000)
  CHUNK_SIZE!: number;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  CHUNK_OVERLAP!: number;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_BASE_URL!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_API_KEY!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  EMBEDDING_MODEL!: string;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8192)
  EMBEDDING_DIMENSION!: number;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  EMBEDDING_BATCH_SIZE!: number;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(300000)
  EMBEDDING_TIMEOUT_MS!: number;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  EMBEDDING_MAX_RETRIES!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  EMBEDDING_MOCK?: boolean;

  @IsDefined()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  LLM_BASE_URL!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  LLM_API_KEY!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  LLM_MODEL!: string;

  @IsDefined()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  LLM_TEMPERATURE!: number;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8192)
  LLM_MAX_TOKENS!: number;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(5000)
  @Max(300000)
  LLM_TIMEOUT_MS!: number;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  LLM_MAX_RETRIES!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  LLM_MOCK?: boolean;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(500)
  @Max(20000)
  CONTEXT_MAX_CHARS!: number;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    whitelist: true,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const reasons = error.constraints
          ? Object.values(error.constraints).join(', ')
          : '配置无效';

        return `${error.property}: ${reasons}`;
      })
      .join('; ');

    throw new Error(`环境变量校验失败：${details}`);
  }

  return {
    ...config,
    ...validatedConfig,
  };
}
