import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';
import { QueryFailedError } from 'typeorm';

const TRANSFORMED_MULTER_BAD_REQUEST_MESSAGES = new Set([
  'Too many parts',
  'Too many files',
  'Field name too long',
  'Field value too long',
  'Too many fields',
  'Unexpected field',
  'Field name missing',
  'Multipart: Boundary not found',
  'Multipart: Malformed part header',
  'Multipart: Unexpected end of form',
  'Multipart: Unexpected end of file',
]);

interface ErrorResponse {
  code: number;
  message: string;
  details?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter<unknown> {
  private static readonly logger = new Logger(HttpExceptionFilter.name);

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

      const errorResponse: ErrorResponse = {
        code: status,
        message: this.normalizeTransformedMulterMessage(
          status,
          this.getHttpExceptionMessage(exception, exceptionResponse),
        ),
      };
      const details = this.getHttpExceptionDetails(exceptionResponse);

      if (details !== undefined) {
        errorResponse.details = details;
      }

      response.status(status).json(errorResponse);
      return;
    }

    if (exception instanceof MulterError) {
      const status =
        exception.code === 'LIMIT_FILE_SIZE'
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.BAD_REQUEST;

      HttpExceptionFilter.logger.error(
        `文件上传失败：${exception.code}`,
        exception.stack,
      );
      response.status(status).json({
        code: status,
        message:
          status === HttpStatus.PAYLOAD_TOO_LARGE
            ? '文件大小超出限制'
            : '文件上传失败',
      } satisfies ErrorResponse);
      return;
    }

    if (exception instanceof QueryFailedError) {
      HttpExceptionFilter.logger.error(
        `数据库操作失败：${exception.message}`,
        exception.stack,
      );
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: '数据库操作失败',
      } satisfies ErrorResponse);
      return;
    }

    HttpExceptionFilter.logger.error(
      `服务器内部错误：${this.getUnknownExceptionMessage(exception)}`,
      this.getUnknownExceptionStack(exception),
    );
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

  private getHttpExceptionDetails(
    exceptionResponse: string | object,
  ): unknown | undefined {
    if (
      !this.isRecord(exceptionResponse) ||
      !Object.prototype.hasOwnProperty.call(exceptionResponse, 'details')
    ) {
      return undefined;
    }

    return exceptionResponse.details;
  }

  private normalizeTransformedMulterMessage(
    status: number,
    message: string,
  ): string {
    // Nest FileInterceptor 会先把常见 MulterError 转成 HttpException。
    if (
      status === HttpStatus.PAYLOAD_TOO_LARGE &&
      message === 'File too large'
    ) {
      return '文件大小超出限制';
    }

    if (
      status === HttpStatus.BAD_REQUEST &&
      TRANSFORMED_MULTER_BAD_REQUEST_MESSAGES.has(message)
    ) {
      return '文件上传失败';
    }

    return message;
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

  private getUnknownExceptionMessage(exception: unknown): string {
    return exception instanceof Error ? exception.message : '未知错误';
  }

  private getUnknownExceptionStack(exception: unknown): string | undefined {
    return exception instanceof Error ? exception.stack : undefined;
  }
}
