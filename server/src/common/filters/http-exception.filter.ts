import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface ErrorResponse {
  code: number;
  message: string;
  details?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter<unknown> {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const validationDetails = this.getValidationDetails(
        status,
        exceptionResponse,
      );

      if (validationDetails !== undefined) {
        response.status(status).json({
          code: status,
          message: '参数校验失败',
          details: validationDetails,
        } satisfies ErrorResponse);
        return;
      }

      response.status(status).json({
        code: status,
        message: this.getHttpExceptionMessage(exception, exceptionResponse),
      } satisfies ErrorResponse);
      return;
    }

    if (exception instanceof QueryFailedError) {
      console.error('数据库操作失败：', exception);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: '数据库操作失败',
      } satisfies ErrorResponse);
      return;
    }

    console.error('服务器内部错误：', exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '服务器内部错误',
    } satisfies ErrorResponse);
  }

  private getValidationDetails(
    status: number,
    exceptionResponse: string | object,
  ): string[] | undefined {
    if (
      status !== HttpStatus.BAD_REQUEST ||
      !this.isRecord(exceptionResponse)
    ) {
      return undefined;
    }

    const message = exceptionResponse.message;
    return this.isStringArray(message) ? message : undefined;
  }

  private getHttpExceptionMessage(
    exception: HttpException,
    exceptionResponse: string | object,
  ): string {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (this.isRecord(exceptionResponse)) {
      const message = exceptionResponse.message;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        return message.map((item: unknown) => String(item)).join(', ');
      }
    }

    return exception.message;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isStringArray(value: unknown): value is string[] {
    return (
      Array.isArray(value) &&
      value.every((item: unknown) => typeof item === 'string')
    );
  }
}
