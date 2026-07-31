export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionApiRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_tokens: number;
  stream: false;
}

export interface ChatStreamApiRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_tokens: number;
  stream: true;
}

export interface ChatCompletionApiChoice {
  index?: number;
  message?: {
    role?: string;
    content?: string | null;
  };
  finish_reason?: string | null;
}

export interface ChatStreamApiChoice {
  index?: number;
  delta?: {
    role?: string;
    content?: string | null;
  };
  finish_reason?: string | null;
}

export interface ChatStreamApiResponse {
  choices: ChatStreamApiChoice[];
  model?: string;
}

export interface ChatStreamDelta {
  delta: string;
  finishReason: string | null;
}

export interface ChatCompletionApiResponse {
  choices: ChatCompletionApiChoice[];
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class LlmFailure extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'LlmFailure';
  }
}
