/**
 * MCP HTTP / SSE Client
 * Manages endpoint discovery, tools/list, and tools/call for remote MCP servers.
 */

import { McpToolDefinition, McpToolCallResult } from "./types";

// In-memory cache for discovered message endpoints: serverUrl -> messageEndpointUrl
const endpointCache = new Map<string, string>();

/**
 * Resolves the message endpoint URL for an MCP server.
 * If the URL is an SSE endpoint, attempts to read the initial `event: endpoint` event,
 * or gracefully falls back to the `/messages` route.
 */
export async function resolveMessageEndpoint(serverUrl: string): Promise<string> {
  const cached = endpointCache.get(serverUrl);
  if (cached) return cached;

  let resolved = serverUrl;

  if (serverUrl.includes("/sse")) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(serverUrl, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "User-Agent": "spark-telegram-agent/1.0",
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Read up to 8KB of the stream looking for `event: endpoint`
        for (let i = 0; i < 5; i++) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const match = buffer.match(/event:\s*endpoint\s*\ndata:\s*([^\n\r]+)/i);
          if (match && match[1]) {
            const rawEndpoint = match[1].trim();
            try {
              resolved = new URL(rawEndpoint, serverUrl).toString();
            } catch {
              resolved = rawEndpoint;
            }
            reader.cancel().catch(() => {});
            break;
          }
        }
      }
    } catch {
      // Fallback: if SSE read fails, standard Cloudflare MCP servers expose /messages
      resolved = serverUrl.replace(/\/sse\/?$/, "/messages");
    }
  }

  // If endpoint still ends in /sse, convert to /messages as standard fallback
  if (resolved.endsWith("/sse")) {
    resolved = resolved.replace(/\/sse$/, "/messages");
  }

  endpointCache.set(serverUrl, resolved);
  return resolved;
}

/**
 * Dispatches a JSON-RPC 2.0 payload to an MCP server's message endpoint.
 */
async function sendJsonRpc(
  endpointUrl: string,
  method: string,
  params: Record<string, any> = {}
): Promise<any> {
  const id = `spark-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const payload = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  const res = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`MCP Server HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data: any = await res.json();
  if (data.error) {
    throw new Error(`MCP RPC Error [${data.error.code}]: ${data.error.message}`);
  }

  return data.result;
}

/**
 * Fetches all tool definitions from a remote MCP server.
 */
export async function fetchServerTools(serverUrl: string): Promise<McpToolDefinition[]> {
  const endpoint = await resolveMessageEndpoint(serverUrl);

  // 1. Send initialize (best-effort)
  try {
    await sendJsonRpc(endpoint, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "spark-telegram-agent", version: "1.0.0" },
    });
  } catch {
    // Some servers allow tools/list directly without initialize
  }

  // 2. Fetch tools list
  const result = await sendJsonRpc(endpoint, "tools/list", {});
  const rawTools: any[] = result?.tools || [];

  return rawTools.map((t) => ({
    name: String(t.name),
    description: t.description || "",
    inputSchema: t.inputSchema || { type: "object", properties: {} },
  }));
}

/**
 * Executes a tool on a remote MCP server.
 */
export async function executeServerTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, any>
): Promise<McpToolCallResult> {
  try {
    const endpoint = await resolveMessageEndpoint(serverUrl);
    const result = await sendJsonRpc(endpoint, "tools/call", {
      name: toolName,
      arguments: args,
    });

    if (!result) {
      return {
        content: [{ type: "text", text: "Tool executed successfully (empty response)." }],
        isError: false,
      };
    }

    if (Array.isArray(result.content)) {
      return {
        content: result.content,
        isError: Boolean(result.isError),
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: Boolean(result.isError),
    };
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `MCP Execution Error: ${err?.message || String(err)}` }],
      isError: true,
    };
  }
}
