/**
 * Meta-Tools for Spark
 * Self-management capabilities allowing Spark to manage its own MCP servers dynamically.
 */

import { Env, GeminiFunctionDeclaration } from "./types";
import {
  getRegisteredServers,
  registerServer,
  removeServer,
  getAllRegisteredTools,
  invalidateToolsCache,
} from "./mcp_registry";
import { fetchServerTools } from "./mcp_client";

export const META_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: "register_mcp_server",
    description: "Register and connect a new remote MCP server dynamically into Spark's active toolset.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "Unique identifier name for this MCP server (e.g. 'github_mcp', 'brave_search').",
        },
        url: {
          type: "STRING",
          description: "The HTTP/SSE URL of the MCP server (e.g. 'https://example-mcp.workers.dev/sse').",
        },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "list_mcp_servers",
    description: "List all currently connected MCP servers, their endpoints, and active tool counts.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "remove_mcp_server",
    description: "Disconnect and remove an MCP server from Spark's active registry.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "The identifier name of the MCP server to disconnect.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "reload_tools",
    description: "Force reload and update the tool schemas from all registered MCP servers.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

export const META_TOOL_NAMES = new Set(META_TOOL_DECLARATIONS.map((t) => t.name));

/**
 * Dispatches execution of a meta-tool.
 */
export async function executeMetaTool(
  toolName: string,
  args: Record<string, any>,
  env: Env
): Promise<{ result: any; isError: boolean }> {
  try {
    switch (toolName) {
      case "register_mcp_server": {
        const name = String(args.name || "").trim();
        const url = String(args.url || "").trim();

        if (!name || !url) {
          return {
            result: { error: "Both 'name' and 'url' are required to register an MCP server." },
            isError: true,
          };
        }

        // Test connectivity first
        let toolsDiscovered = 0;
        try {
          const tools = await fetchServerTools(url);
          toolsDiscovered = tools.length;
        } catch (testErr: any) {
          return {
            result: {
              error: `Failed to verify MCP server at '${url}': ${testErr?.message}`,
              status: "unreachable",
            },
            isError: true,
          };
        }

        const record = await registerServer(env, name, url);
        // Force reload all tools
        const allTools = await getAllRegisteredTools(env, true);

        return {
          result: {
            status: "success",
            message: `MCP server '${record.name}' registered successfully.`,
            server: record,
            tools_imported: toolsDiscovered,
            total_active_tools: allTools.length,
          },
          isError: false,
        };
      }

      case "list_mcp_servers": {
        const servers = await getRegisteredServers(env);
        const tools = await getAllRegisteredTools(env, false);

        const serverSummary = servers.map((s) => {
          const serverTools = tools.filter((t) => t.serverName === s.name);
          return {
            name: s.name,
            url: s.url,
            isDefault: Boolean(s.isDefault),
            addedAt: new Date(s.addedAt).toISOString(),
            toolsCount: serverTools.length,
          };
        });

        return {
          result: {
            total_servers: servers.length,
            total_tools: tools.length,
            servers: serverSummary,
          },
          isError: false,
        };
      }

      case "remove_mcp_server": {
        const name = String(args.name || "").trim();
        if (!name) {
          return {
            result: { error: "Server 'name' is required to remove an MCP server." },
            isError: true,
          };
        }

        const removed = await removeServer(env, name);
        if (!removed) {
          return {
            result: { error: `Server '${name}' was not found in the registry.` },
            isError: true,
          };
        }

        const allTools = await getAllRegisteredTools(env, true);
        return {
          result: {
            status: "success",
            message: `MCP server '${name}' removed successfully.`,
            remaining_tools_count: allTools.length,
          },
          isError: false,
        };
      }

      case "reload_tools": {
        invalidateToolsCache();
        const allTools = await getAllRegisteredTools(env, true);
        const servers = await getRegisteredServers(env);

        return {
          result: {
            status: "reloaded",
            message: "All MCP tools reloaded and cache refreshed.",
            total_tools: allTools.length,
            servers_checked: servers.map((s) => s.name),
          },
          isError: false,
        };
      }

      default:
        return {
          result: { error: `Unknown meta-tool: ${toolName}` },
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      result: { error: `Meta-tool execution error: ${err?.message || String(err)}` },
      isError: true,
    };
  }
}
