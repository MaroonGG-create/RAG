import { Response } from 'express';

export class SseWriter {
  constructor(private readonly response: Response) {}

  setHeaders(): void {
    this.response.setHeader('Content-Type', 'text/event-stream');
    this.response.setHeader('Cache-Control', 'no-cache');
    this.response.setHeader('Connection', 'keep-alive');
    this.response.setHeader('X-Accel-Buffering', 'no');
    this.response.flushHeaders();
  }

  writeEvent(event: string, data: unknown): void {
    if (this.isClosed()) {
      return;
    }

    this.response.write(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  }

  end(): void {
    if (!this.isClosed()) {
      this.response.end();
    }
  }

  isClosed(): boolean {
    return this.response.writableEnded || this.response.destroyed;
  }
}
