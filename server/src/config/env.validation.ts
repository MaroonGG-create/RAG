import { plainToInstance, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
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
