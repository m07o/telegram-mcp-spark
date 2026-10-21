/**
 * Type definitions for spark-telegram-agent
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_USER_ID: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  MCP_SERVERS_KV?: KVNamespace;
  SYSTEM_INSTRUCTION?: string;
  TELEGRAM_SECRET_TOKEN?: string;
}

// Telegram Update structures
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

// MCP (Model Context Protocol) types
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    description?: string;
    [key: string]: any;
  };
}

export interface McpServerRecord {
  name: string;
  url: string;
  addedAt: number;
  isDefault?: boolean;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// Gemini API types
export interface GeminiFunctionCall {
  name: string;
  args: Record<string, any>;
}

export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, any>;
}

export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

export interface GeminiContent {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    description?: string;
  };
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  tools?: GeminiTool[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
  };
}

export interface GeminiCandidate {
  content: {
    role: "model";
    parts: GeminiPart[];
  };
  finishReason?: string;
}

export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: any;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}
