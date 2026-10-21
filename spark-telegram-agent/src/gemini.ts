/**
 * Gemini REST API integration for spark-telegram-agent
 * Converts MCP tool schemas to Gemini function declarations and manages generateContent requests.
 */

import {
  Env,
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
  McpToolDefinition,
} from "./types";

/**
 * Maps standard JSON Schema type to uppercase Gemini OpenAPI type.
 */
function mapJsonSchemaType(type: any): string {
  if (Array.isArray(type)) {
    // e.g. ["string", "number"] -> choose the first primitive
    const valid = type.find((t) => t !== "null");
    return mapJsonSchemaType(valid || "string");
  }

  const str = String(type || "string").toLowerCase();
  switch (str) {
    case "string":
      return "STRING";
    case "number":
      return "NUMBER";
    case "integer":
      return "INTEGER";
    case "boolean":
      return "BOOLEAN";
    case "array":
      return "ARRAY";
    case "object":
      return "OBJECT";
    default:
      return "STRING";
  }
}

/**
 * Recursively cleans and maps JSON Schema to Gemini parameter declaration format.
 */
export function sanitizeSchemaForGemini(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return { type: "OBJECT", properties: {} };
  }

  const geminiType = mapJsonSchemaType(schema.type);
  const result: Record<string, any> = { type: geminiType };

  if (schema.description) {
    result.description = String(schema.description).slice(0, 1024);
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    result.enum = schema.enum.map(String);
  }

  if (geminiType === "OBJECT") {
    result.properties = {};
    if (schema.properties && typeof schema.properties === "object") {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        result.properties[key] = sanitizeSchemaForGemini(propSchema);
      }
    }
    if (Array.isArray(schema.required) && schema.required.length > 0) {
      result.required = schema.required.filter((k: any) => typeof k === "string");
    }
  } else if (geminiType === "ARRAY") {
    if (schema.items) {
      result.items = sanitizeSchemaForGemini(schema.items);
    } else {
      result.items = { type: "STRING" };
    }
  }

  return result;
}

/**
 * Converts an MCP tool definition to a Gemini FunctionDeclaration.
 */
export function mcpToolToGeminiFunction(
  tool: McpToolDefinition,
  customName?: string
): GeminiFunctionDeclaration {
  const sanitizedParams = sanitizeSchemaForGemini(tool.inputSchema);
  return {
    name: customName || tool.name,
    description: (tool.description || `Tool ${tool.name}`).slice(0, 1024),
    parameters: sanitizedParams,
  };
}

/**
 * Sends a generateContent call to Google Gemini REST API.
 */
export async function callGemini(
  env: Env,
  request: GeminiGenerateContentRequest
): Promise<GeminiGenerateContentResponse> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in environment.");
  }

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    // If model is gemini-2.5-flash and fails with 404, attempt fallback to gemini-2.0-flash
    if (res.status === 404 && model === "gemini-2.5-flash") {
      console.warn("[Gemini] gemini-2.5-flash returned 404, retrying with gemini-2.0-flash...");
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const fbRes = await fetch(fallbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (fbRes.ok) {
        return (await fbRes.json()) as GeminiGenerateContentResponse;
      }
    }

    throw new Error(`Gemini API HTTP ${res.status}: ${errorText.slice(0, 300)}`);
  }

  const data = (await res.json()) as GeminiGenerateContentResponse;
  if (data.error) {
    throw new Error(`Gemini API Error [${data.error.code}]: ${data.error.message}`);
  }

  return data;
}
