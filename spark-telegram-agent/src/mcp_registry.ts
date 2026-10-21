/**
 * Dynamic MCP Server Registry
 * Manages MCP servers in Cloudflare KV with in-memory fallback and caching.
 */

import { Env, McpServerRecord, McpToolDefinition } from "./types";
import { fetchServerTools } from "./mcp_client";

export const DEFAULT_MCP_SERVERS: McpServerRecord[] = [
  {
    name: "mem0",
    url: "https://mem0-mcp-worker.mohamed225114551.workers.dev/sse",
    addedAt: 1725600000000,
    isDefault: true,
  },
  {
    name: "telegram_userbot",
    url: "https://telegram-userbot-mcp.mohamed225114551.workers.dev/sse",
    addedAt: 1725600000000,
    isDefault: true,
  },
];

const KV_SERVERS_KEY = "spark_mcp_servers_list";

// In-memory fallback for local dev / unconfigured KV
let memoryServers: McpServerRecord[] = [...DEFAULT_MCP_SERVERS];

export interface BoundTool {
  serverName: string;
  serverUrl: string;
  originalName: string;
  geminiName: string;
  definition: McpToolDefinition;
}

// In-memory cached tools to prevent repeated fetching on every webhook
let cachedTools: BoundTool[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Retrieves the list of all registered MCP servers.
 */
export async function getRegisteredServers(env: Env): Promise<McpServerRecord[]> {
  if (!env.MCP_SERVERS_KV) {
    return memoryServers;
  }

  try {
    const raw = await env.MCP_SERVERS_KV.get(KV_SERVERS_KEY, "json");
    if (Array.isArray(raw) && raw.length > 0) {
      return raw as McpServerRecord[];
    }

    // Initialize with defaults if KV is empty
    await env.MCP_SERVERS_KV.put(KV_SERVERS_KEY, JSON.stringify(DEFAULT_MCP_SERVERS));
    return [...DEFAULT_MCP_SERVERS];
  } catch (err) {
    console.warn("[Registry] KV read failed, falling back to in-memory:", err);
    return memoryServers;
  }
}

/**
 * Saves a new MCP server into the registry.
 */
export async function registerServer(
  env: Env,
  name: string,
  url: string
): Promise<McpServerRecord> {
  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const cleanUrl = url.trim();

  if (!cleanName || !cleanUrl.startsWith("http")) {
    throw new Error("Invalid server name or URL format.");
  }

  const current = await getRegisteredServers(env);
  const existingIdx = current.findIndex((s) => s.name === cleanName);

  const newRecord: McpServerRecord = {
    name: cleanName,
    url: cleanUrl,
    addedAt: Date.now(),
    isDefault: false,
  };

  if (existingIdx >= 0) {
    current[existingIdx] = newRecord;
  } else {
    current.push(newRecord);
  }

  if (env.MCP_SERVERS_KV) {
    await env.MCP_SERVERS_KV.put(KV_SERVERS_KEY, JSON.stringify(current));
  } else {
    memoryServers = [...current];
  }

  // Invalidate cache immediately
  invalidateToolsCache();
  return newRecord;
}

/**
 * Removes an MCP server from the registry.
 */
export async function removeServer(env: Env, name: string): Promise<boolean> {
  const cleanName = name.trim().toLowerCase();
  const current = await getRegisteredServers(env);
  const filtered = current.filter((s) => s.name !== cleanName);

  if (filtered.length === current.length) {
    return false; // Not found
  }

  if (env.MCP_SERVERS_KV) {
    await env.MCP_SERVERS_KV.put(KV_SERVERS_KEY, JSON.stringify(filtered));
  } else {
    memoryServers = [...filtered];
  }

  invalidateToolsCache();
  return true;
}

/**
 * Invalidates the in-memory tools cache.
 */
export function invalidateToolsCache(): void {
  cachedTools = null;
  lastCacheTime = 0;
}

/**
 * Sanitizes tool name to comply with Gemini's regex requirement: ^[a-zA-Z_][a-zA-Z0-9_]*$ (max 63 chars)
 */
export function sanitizeGeminiFunctionName(name: string): string {
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `fn_${sanitized}`;
  }
  return sanitized.slice(0, 63);
}

/**
 * Fetches and resolves tools across all registered MCP servers.
 * Resolves naming collisions and caches results in memory.
 */
export async function getAllRegisteredTools(
  env: Env,
  forceRefresh: boolean = false
): Promise<BoundTool[]> {
  const now = Date.now();
  if (!forceRefresh && cachedTools && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedTools;
  }

  const servers = await getRegisteredServers(env);
  const allBound: BoundTool[] = [];
  const usedGeminiNames = new Set<string>();

  // Parallel fetch with individual error isolation
  const fetchPromises = servers.map(async (server) => {
    try {
      const tools = await fetchServerTools(server.url);
      return { server, tools, error: null };
    } catch (err: any) {
      console.warn(`[Registry] Failed to fetch tools from '${server.name}' (${server.url}):`, err.message);
      return { server, tools: [], error: err.message };
    }
  });

  const results = await Promise.all(fetchPromises);

  for (const { server, tools } of results) {
    for (const tool of tools) {
      let baseGeminiName = sanitizeGeminiFunctionName(tool.name);

      // If there's a collision across servers, namespace by server name
      if (usedGeminiNames.has(baseGeminiName)) {
        baseGeminiName = sanitizeGeminiFunctionName(`${server.name}_${tool.name}`);
      }

      usedGeminiNames.add(baseGeminiName);

      allBound.push({
        serverName: server.name,
        serverUrl: server.url,
        originalName: tool.name,
        geminiName: baseGeminiName,
        definition: tool,
      });
    }
  }

  cachedTools = allBound;
  lastCacheTime = now;
  return allBound;
}
