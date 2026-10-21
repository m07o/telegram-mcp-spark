/**
 * Telegram Userbot MCP Server for Cloudflare Workers
 * Integrates GramJS (telegram) via MTProto over Telegram Web Gateways (FQDN / WSS).
 * Full compatibility with Google Gemini SSE streaming, probing (HEAD), Edge cache flush, and Fallback response.
 * Completely eliminates raw IP connection errors, 405 Method Not Allowed, and Worker hung requests.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { ConnectionTCPObfuscated } from "telegram/network";
import { PromisedWebSockets } from "telegram/extensions";
import { MCP_TOOLS, McpToolDefinition } from "./tools_registry";
import { dispatchUserbotTool } from "./tool_dispatcher";

export interface Env {
  TELEGRAM_API_ID: string;
  TELEGRAM_API_HASH: string;
  TELEGRAM_SESSION_STRING: string;
}

interface SseSession {
  controller: ReadableStreamDefaultController<Uint8Array>;
  close: () => void;
}

// In-memory active session tracker for SSE streaming
const sseSessions = new Map<string, SseSession>();

// Cached TelegramClient singleton across requests in the worker instance
let cachedClient: TelegramClient | null = null;
let clientConnectingPromise: Promise<TelegramClient> | null = null;

// Official Telegram Web Gateway FQDN domains for WebSockets (replaces raw IPs)
const DC_GATEWAY_MAP: Record<number, string> = {
  1: "pluto.web.telegram.org",
  2: "venus.web.telegram.org",
  3: "aurora.web.telegram.org",
  4: "vesta.web.telegram.org",
  5: "flora.web.telegram.org",
};

// Known DC IP mappings to ensure no raw IP is ever contacted
const IP_TO_DC: Record<string, number> = {
  "149.154.175.50": 1,
  "149.154.167.50": 2,
  "149.154.175.100": 3,
  "149.154.167.92": 4,
  "91.108.56.165": 5,
  "91.108.56.100": 5,
};

/**
 * Custom WebSocket class that forces GramJS to always use official Telegram Web FQDNs
 * completely avoiding raw IP addresses which Cloudflare Workers reject.
 */
class TelegramCloudflareWebSockets extends PromisedWebSockets {
  dcId: number = 4;

  getWebSocketLink(ip: string, port: number, testServers?: boolean): string {
    let host = DC_GATEWAY_MAP[this.dcId] || "vesta.web.telegram.org";

    if (IP_TO_DC[ip]) {
      host = DC_GATEWAY_MAP[IP_TO_DC[ip]] || host;
    } else if (ip.includes("149.154.175.50") || ip === "1") {
      host = "pluto.web.telegram.org";
    } else if (ip.includes("149.154.167.50") || ip === "2") {
      host = "venus.web.telegram.org";
    } else if (ip.includes("149.154.175.100") || ip === "3") {
      host = "aurora.web.telegram.org";
    } else if (ip.includes("149.154.167.92") || ip === "4") {
      host = "vesta.web.telegram.org";
    } else if (ip.includes("91.108.56.") || ip === "5") {
      host = "flora.web.telegram.org";
    } else if (ip.includes(".web.telegram.org")) {
      host = ip;
    }

    const testSuffix = testServers ? "_test" : "";
    return `wss://${host}/apiws${testSuffix}`;
  }
}

// Timeout helper using Promise.race to guarantee the Worker never hangs (increased to 120s for bulk topics and media)
const MAX_TIMEOUT_MS = 120000;

async function runWithTimeout<T>(
  promise: Promise<T>,
  ms: number = MAX_TIMEOUT_MS,
  label: string = "Operation"
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`TimeoutError: ${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

// CORS headers for cross-origin LLM clients
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-session-id, mcp-session-id, baggage, traceparent",
  "Access-Control-Max-Age": "86400",
};

// SSE streaming response headers
const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
  ...CORS_HEADERS,
};

const encoder = new TextEncoder();

// Combine all 167 tools with friendly Userbot aliases
const ALL_TOOLS: McpToolDefinition[] = [
  ...MCP_TOOLS,
  // Include explicit aliases requested if not already existing
  {
    name: "read_chat_history",
    description: "Fetch message history from any private chat (DM), group, or channel using your personal Telegram account.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: ["string", "number"], description: "Target username, phone number, or chat ID" },
        limit: { type: "number", description: "Number of messages to retrieve (1-100). Default is 20.", default: 20 },
      },
      required: ["chat_id"],
    },
  },
  {
    name: "send_user_message",
    description: "Send a message from your personal Telegram account to any user, chat, or channel.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: ["string", "number"], description: "Target username, phone number, or chat ID" },
        text: { type: "string", description: "Text of the message to send" },
      },
      required: ["chat_id", "text"],
    },
  },
  {
    name: "list_dialogs",
    description: "Retrieve a list of recent active conversations/dialogs from your personal Telegram account.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of dialogs to retrieve (1-100). Default is 20.", default: 20 },
      },
    },
  },
  {
    name: "search_messages",
    description: "Search for messages containing a query across the entire account or within a specific chat.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword or phrase" },
        limit: { type: "number", description: "Maximum number of messages to return (1-100). Default is 20.", default: 20 },
        chat_id: { type: ["string", "number"], description: "Optional chat username or ID to restrict search" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_topics",
    description: "Retrieve forum topics from a supergroup with enriched compact output mode by default, server-side sorting, and reliable 3-offset pagination.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: ["string", "number"], description: "The ID or username of the forum supergroup (e.g. -1002191043427 or 2191043427)" },
        limit: { type: "number", description: "Maximum topics to retrieve per request (1-100). Default is 100.", default: 100 },
        offset_topic: { type: "number", description: "Topic ID offset from previous next_page.offset_topic", default: 0 },
        offset_id: { type: "number", description: "Message ID offset from previous next_page.offset_id", default: 0 },
        offset_date: { type: "number", description: "Date offset from previous next_page.offset_date", default: 0 },
        fetch_all: { type: "boolean", description: "Fetch multiple pages up to 18s budget limit", default: false },
        compact: { type: "boolean", description: "Lightweight mode (id, title, date, top_message_id, unread_count, pinned, closed) reducing output size. Default is true.", default: true },
        order_by: {
          type: "string",
          enum: ["activity", "oldest", "newest"],
          description: "Sorting order: 'activity' (default, latest active topics first), 'oldest' (oldest first), or 'newest' (newest first).",
          default: "activity",
        },
        search_query: { type: "string", description: "Optional title search query" },
      },
      required: ["chat_id"],
    },
  },
  {
    name: "get_topic_message_count",
    description: "Query message counts for one or more forum topics (up to 30) without loading message bodies to save memory and tokens.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: ["string", "number"],
          description: "The ID or username of the forum supergroup (e.g. -1002191043427 or 2191043427).",
        },
        topic_ids: {
          type: ["array", "number"],
          description: "Array of topic IDs or single topic ID to query (max 30 topics).",
          items: { type: "number" },
        },
      },
      required: ["chat_id", "topic_ids"],
    },
  },
  {
    name: "create_forum_topic",
    description: "Create a Telegram forum topic in a forum-enabled supergroup with explicit access_hash resolution.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: ["string", "number"], description: "The ID or username of the forum supergroup (e.g. -1002191043427 or 2191043427)" },
        title: { type: "string", description: "Title of the new topic" },
        icon_color: { type: "number", description: "Optional icon color integer" },
        icon_emoji_id: { type: ["string", "number"], description: "Optional custom emoji document ID for the topic icon" },
      },
      required: ["chat_id", "title"],
    },
  },
  {
    name: "copy_topic",
    description: "Copy an entire forum topic (or a batch of messages) from one supergroup to another with server-side copy, automatic target topic creation, and batching report.",
    inputSchema: {
      type: "object",
      properties: {
        from_chat_id: { type: ["string", "number"], description: "Source supergroup ID or username" },
        topic_id: { type: "number", description: "Source topic ID" },
        to_chat_id: { type: ["string", "number"], description: "Destination supergroup ID or username" },
        topic_title: { type: "string", description: "Optional title for the new topic (defaults to source topic title)" },
        limit: { type: "number", description: "Maximum messages to copy (1-100, default 50)", default: 50 },
        resume_from_msg_id: { type: "number", description: "Resume copying from messages newer than this message ID", default: 0 },
      },
      required: ["from_chat_id", "topic_id", "to_chat_id"],
    },
  },
  {
    name: "migrate_topics_autonomous",
    description: "Autonomous batch migration of forum topics between supergroups.",
    inputSchema: {
      type: "object",
      properties: {
        source_chat_id: { type: ["string", "number"], description: "Source supergroup ID or username" },
        target_chat_id: { type: ["string", "number"], description: "Target supergroup ID or username" },
        limit: { type: "number", description: "Batch size of topics to migrate (default 10)", default: 10 },
        offset_topic: { type: "number", description: "Offset topic ID to continue from", default: 0 },
      },
      required: ["source_chat_id", "target_chat_id"],
    },
  },
];

// De-duplicate tools by name
const UNIQUE_TOOLS = Array.from(new Map(ALL_TOOLS.map((t) => [t.name, t])).values());

/**
 * Initializes or retrieves the connected Telegram MTProto client
 * Guaranteed to never connect to raw IPs and protected by timeout.
 */
async function getTelegramClient(env: Env): Promise<TelegramClient> {
  if (!env.TELEGRAM_API_ID || !env.TELEGRAM_API_HASH || !env.TELEGRAM_SESSION_STRING) {
    throw new Error(
      "Configuration Error: Missing TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_SESSION_STRING in environment."
    );
  }

  const apiId = parseInt(env.TELEGRAM_API_ID, 10);
  if (isNaN(apiId)) {
    throw new Error("Validation Error: TELEGRAM_API_ID must be a valid integer.");
  }

  if (cachedClient && cachedClient.connected) {
    return cachedClient;
  }

  if (clientConnectingPromise) {
    return clientConnectingPromise;
  }

  clientConnectingPromise = (async () => {
    try {
      const stringSession = new StringSession(env.TELEGRAM_SESSION_STRING);
      const dcId = stringSession.dcId || 4;
      const gatewayDomain = DC_GATEWAY_MAP[dcId] || "vesta.web.telegram.org";

      // Reconfigure session to use official FQDN domain on port 443 instead of raw IP
      stringSession.setDC(dcId, gatewayDomain, 443);

      class BoundWebSockets extends TelegramCloudflareWebSockets {
        constructor() {
          super();
          this.dcId = dcId;
        }
      }

      const client = new TelegramClient(stringSession, apiId, env.TELEGRAM_API_HASH, {
        connection: ConnectionTCPObfuscated,
        networkSocket: BoundWebSockets,
        useWSS: true,
        connectionRetries: 1,
        requestRetries: 2,
        timeout: 5,
        autoReconnect: false,
        floodSleepThreshold: 0, // Disable automatic sleeping on FloodWait to prevent worker timeouts
      });

      // Wrap connect in timeout (30s) to allow WebSocket handshake and authentication
      await runWithTimeout(
        client.connect(),
        30000,
        `MTProto connect to ${gatewayDomain} (DC ${dcId})`
      );

      cachedClient = client;
      return client;
    } catch (err) {
      cachedClient = null;
      throw err;
    } finally {
      clientConnectingPromise = null;
    }
  })();

  return clientConnectingPromise;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS Preflight (OPTIONS) -> Always 204 No Content
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const handledPaths = ["/", "/sse", "/mcp", "/messages"];

    // 2. Health check route
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          server: "telegram-userbot-mcp",
          version: "2.1.0",
          totalTools: UNIQUE_TOOLS.length,
          maxTimeoutMs: MAX_TIMEOUT_MS,
          protocol: "MTProto via Telegram Web Gateway (WSS)",
          activeSseSessions: sseSessions.size,
          clientConnected: Boolean(cachedClient?.connected),
          configured: {
            apiId: Boolean(env.TELEGRAM_API_ID),
            apiHash: Boolean(env.TELEGRAM_API_HASH),
            sessionString: Boolean(env.TELEGRAM_SESSION_STRING),
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    // 3. Probing requests (HEAD on any supported endpoint for Google Gemini verification)
    if (request.method === "HEAD" && handledPaths.includes(url.pathname)) {
      return new Response(null, {
        status: 200,
        headers: SSE_HEADERS,
      });
    }

    // 4. SSE Stream Establishment (GET on /, /sse, /mcp, or /messages)
    if (request.method === "GET" && handledPaths.includes(url.pathname)) {
      const sessionId = crypto.randomUUID();
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let isCleanedUp = false;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Flush 2KB comment (: 2048 spaces\n\n) to immediately bypass Edge/Proxy buffering
          controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`));

          // Immediately transmit endpoint event with full URL including generated sessionId
          const endpointUrl = `${url.origin}/messages?sessionId=${sessionId}`;
          controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpointUrl}\n\n`));

          const cleanup = () => {
            if (isCleanedUp) return;
            isCleanedUp = true;
            if (intervalId !== null) {
              clearInterval(intervalId);
              intervalId = null;
            }
            sseSessions.delete(sessionId);
            try {
              controller.close();
            } catch {
              // Stream already closed or cancelled
            }
          };

          // Register session
          sseSessions.set(sessionId, {
            controller,
            close: cleanup,
          });

          // Periodic Keep-Alive heartbeat every 5 seconds (: keep-alive\n\n)
          intervalId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            } catch {
              cleanup();
            }
          }, 5000);
        },
        cancel() {
          const session = sseSessions.get(sessionId);
          if (session) {
            session.close();
          }
        },
      });

      // Handle client disconnect / abort signal
      request.signal.addEventListener("abort", () => {
        const session = sseSessions.get(sessionId);
        if (session) {
          session.close();
        }
      });

      return new Response(stream, {
        status: 200,
        headers: SSE_HEADERS,
      });
    }

    // 5. JSON-RPC 2.0 Handler (POST on /, /messages, /sse, or /mcp)
    if (request.method === "POST" && handledPaths.includes(url.pathname)) {
      const sessionId =
        url.searchParams.get("sessionId") ||
        url.searchParams.get("session_id") ||
        request.headers.get("x-session-id") ||
        request.headers.get("mcp-session-id") ||
        undefined;

      let body: any;
      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error: Invalid JSON payload" },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      }

      const responsePayload = await handleJsonRpc(body, env);

      // JSON-RPC Notification (no id requested and no error): acknowledge with 202
      if (body.id === undefined && !("error" in responsePayload)) {
        return new Response(null, {
          status: 202,
          headers: CORS_HEADERS,
        });
      }

      // Stream response via active SSE session if available
      if (sessionId && sseSessions.has(sessionId)) {
        const session = sseSessions.get(sessionId)!;
        try {
          session.controller.enqueue(
            encoder.encode(`event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`)
          );
          return new Response(JSON.stringify({ status: "accepted", sessionId }), {
            status: 202,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        } catch {
          session.close();
          // Fall through to direct HTTP response fallback
        }
      }

      // Direct Fallback: return JSON-RPC response directly with HTTP 200
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // Default Fallback: informative 404
    return new Response(
      JSON.stringify({
        error: "Not Found",
        message: "Endpoint not found. Supported paths are /, /sse, /mcp, /messages.",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  },
};

/**
 * Handle JSON-RPC 2.0 requests in compliance with Model Context Protocol (MCP)
 */
async function handleJsonRpc(
  body: any,
  env: Env
): Promise<{ jsonrpc: "2.0"; id: string | number | null; result?: any; error?: any }> {
  const id = body?.id !== undefined ? body.id : null;
  const method = body?.method;

  if (body?.jsonrpc !== "2.0" || typeof method !== "string") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid Request: Must follow JSON-RPC 2.0 specification" },
    };
  }

  try {
    switch (method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: {
              name: "telegram-userbot-mcp",
              version: "2.1.0",
            },
          },
        };
      }

      case "notifications/initialized": {
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
      }

      case "ping": {
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };
      }

      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: UNIQUE_TOOLS,
          },
        };
      }

      case "tools/call": {
        const toolName = body.params?.name;
        const toolArgs = body.params?.arguments || {};
        const toolResult = await safeExecuteTool(toolName, toolArgs, env);

        return {
          jsonrpc: "2.0",
          id,
          result: toolResult,
        };
      }

      default: {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
      }
    }
  } catch (err: any) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err?.message || "Internal server error",
      },
    };
  }
}

/**
 * Executes requested Telegram tool safely wrapped with timeout protection
 * Returning immediate 200 JSON-RPC error response if connection or execution fails.
 */
async function safeExecuteTool(
  name: string,
  args: Record<string, any>,
  env: Env
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean }> {
  try {
    const client = await getTelegramClient(env);
    return await runWithTimeout(
      dispatchUserbotTool(name, args, client),
      MAX_TIMEOUT_MS,
      `Tool '${name}' execution`
    );
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `MTProto Execution/Gateway Error: ${error?.message || String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
