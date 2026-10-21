/**
 * spark-telegram-agent Worker Entrypoint
 * Handles Telegram Webhook, Health check, Tools discovery, and CORS.
 */

import { Env, TelegramUpdate } from "./types";
import { handleTelegramMessage } from "./agent";
import { getRegisteredServers, getAllRegisteredTools } from "./mcp_registry";
import { META_TOOL_DECLARATIONS } from "./meta_tools";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 2. Health check route
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      const servers = await getRegisteredServers(env);
      return new Response(
        JSON.stringify(
          {
            status: "ok",
            service: "spark-telegram-agent",
            version: "1.0.0",
            registeredServersCount: servers.length,
            servers: servers.map((s) => ({ name: s.name, url: s.url, isDefault: s.isDefault })),
            configured: {
              telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
              allowedUserId: Boolean(env.ALLOWED_USER_ID),
              gemini: Boolean(env.GEMINI_API_KEY),
              model: env.GEMINI_MODEL || "gemini-2.5-flash",
              kvStorage: Boolean(env.MCP_SERVERS_KV),
            },
          },
          null,
          2
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    // 3. Tools discovery endpoint
    if (request.method === "GET" && url.pathname === "/tools") {
      const registeredTools = await getAllRegisteredTools(env);
      return new Response(
        JSON.stringify(
          {
            metaTools: META_TOOL_DECLARATIONS,
            mcpTools: registeredTools.map((t) => ({
              server: t.serverName,
              name: t.geminiName,
              originalName: t.originalName,
              description: t.definition.description,
              parameters: t.definition.inputSchema,
            })),
            totalTools: META_TOOL_DECLARATIONS.length + registeredTools.length,
          },
          null,
          2
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    // 4. Telegram Webhook handler
    if (request.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/")) {
      // Optional Secret Token verification
      if (env.TELEGRAM_SECRET_TOKEN) {
        const tokenHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (tokenHeader !== env.TELEGRAM_SECRET_TOKEN) {
          console.warn("[Security] Webhook secret token mismatch.");
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      let update: TelegramUpdate;
      try {
        update = (await request.json()) as TelegramUpdate;
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Process message safely without letting errors cause Telegram webhook retry storms
      try {
        await handleTelegramMessage(update, env, ctx);
      } catch (agentErr: any) {
        console.error("[Agent] Top-level handler error:", agentErr);
      }

      // Always return 200 OK to Telegram
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // 5. Fallback 404
    return new Response(
      JSON.stringify({
        error: "Not Found",
        message: "Endpoint not found. Valid endpoints are /health, /tools, and POST /webhook.",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  },
};
