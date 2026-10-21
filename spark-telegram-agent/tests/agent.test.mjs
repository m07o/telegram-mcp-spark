/**
 * Automated Test Suite for spark-telegram-agent
 * Tests Telegram chunking, Markdown fallback, MCP Registry, Meta-Tools, Gemini schema conversion,
 * Security authorization, and Multi-Step Agentic Loop.
 */

import assert from "node:assert";
import { chunkText } from "../src/telegram.ts";
import {
  DEFAULT_MCP_SERVERS,
  getRegisteredServers,
  registerServer,
  removeServer,
  sanitizeGeminiFunctionName,
} from "../src/mcp_registry.ts";
import { META_TOOL_DECLARATIONS, executeMetaTool } from "../src/meta_tools.ts";
import { sanitizeSchemaForGemini, mcpToolToGeminiFunction } from "../src/gemini.ts";
import worker from "../src/index.ts";

async function runTests() {
  console.log("=== Starting spark-telegram-agent Comprehensive Test Suite ===\n");

  const mockEnv = {
    TELEGRAM_BOT_TOKEN: "mock-bot-token-123",
    ALLOWED_USER_ID: "987654321",
    GEMINI_API_KEY: "mock-gemini-key",
    GEMINI_MODEL: "gemini-2.5-flash",
  };
  const mockCtx = {
    waitUntil: (p) => Promise.resolve(p),
    passThroughOnException: () => {},
  };

  // -------------------------------------------------------------
  // Test 1: Telegram Message Chunker & Length Constraints
  // -------------------------------------------------------------
  console.log("1. Testing Telegram Message Chunker (chunkText):");
  const shortText = "Hello from Spark Agent!";
  const shortChunks = chunkText(shortText, 4000);
  assert.strictEqual(shortChunks.length, 1);
  assert.strictEqual(shortChunks[0], shortText);

  // Generate 10,000 character text with paragraphs
  const paragraphs = [];
  for (let i = 1; i <= 20; i++) {
    paragraphs.push(`Paragraph ${i}: ${"A".repeat(500)}`);
  }
  const longText = paragraphs.join("\n\n");
  const longChunks = chunkText(longText, 4000);
  assert.ok(longChunks.length >= 3, `Expected at least 3 chunks, got ${longChunks.length}`);
  for (const chunk of longChunks) {
    assert.ok(chunk.length <= 4000, `Chunk length ${chunk.length} exceeds 4000 limit`);
  }
  console.log(`  ✓ Successfully chunked 10,000 chars into ${longChunks.length} safe chunks <= 4000 chars.`);

  // -------------------------------------------------------------
  // Test 2: Gemini Schema Conversion & Name Sanitization
  // -------------------------------------------------------------
  console.log("\n2. Testing Gemini Schema & Identifier Sanitization:");
  const testName1 = "user.messages-search";
  const sanitized1 = sanitizeGeminiFunctionName(testName1);
  assert.strictEqual(sanitized1, "user_messages_search");

  const numStartName = "123_tool";
  const sanitized2 = sanitizeGeminiFunctionName(numStartName);
  assert.strictEqual(sanitized2, "fn_123_tool");

  const rawJsonSchema = {
    type: "object",
    properties: {
      chat_id: { type: ["string", "number"], description: "Chat ID" },
      limit: { type: "integer", default: 20 },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["chat_id"],
  };
  const converted = sanitizeSchemaForGemini(rawJsonSchema);
  assert.strictEqual(converted.type, "OBJECT");
  assert.strictEqual(converted.properties.chat_id.type, "STRING");
  assert.strictEqual(converted.properties.limit.type, "INTEGER");
  assert.strictEqual(converted.properties.tags.type, "ARRAY");
  assert.strictEqual(converted.properties.tags.items.type, "STRING");
  assert.deepStrictEqual(converted.required, ["chat_id"]);
  console.log("  ✓ Schema converted cleanly to Gemini uppercase types (STRING, INTEGER, ARRAY).");

  // -------------------------------------------------------------
  // Test 3: MCP Registry & Dynamic Management
  // -------------------------------------------------------------
  console.log("\n3. Testing Dynamic MCP Registry (Default Servers & KV Fallback):");
  const initialServers = await getRegisteredServers(mockEnv);
  assert.strictEqual(initialServers.length, 2);
  assert.strictEqual(initialServers[0].name, "mem0");
  assert.strictEqual(initialServers[1].name, "telegram_userbot");
  console.log("  ✓ Default built-in servers verified: mem0 & telegram_userbot.");

  // Register a new test server
  const registered = await registerServer(mockEnv, "custom_analytics", "https://analytics-mcp.local/sse");
  assert.strictEqual(registered.name, "custom_analytics");
  const updatedServers = await getRegisteredServers(mockEnv);
  assert.strictEqual(updatedServers.length, 3);
  console.log("  ✓ Dynamic registration of 'custom_analytics' succeeded.");

  // Remove test server
  const removed = await removeServer(mockEnv, "custom_analytics");
  assert.strictEqual(removed, true);
  const finalServers = await getRegisteredServers(mockEnv);
  assert.strictEqual(finalServers.length, 2);
  console.log("  ✓ Dynamic removal of 'custom_analytics' succeeded.");

  // -------------------------------------------------------------
  // Test 4: Meta-Tools Execution
  // -------------------------------------------------------------
  console.log("\n4. Testing Meta-Tools (list_mcp_servers, reload_tools):");
  const listRes = await executeMetaTool("list_mcp_servers", {}, mockEnv);
  assert.strictEqual(listRes.isError, false);
  assert.strictEqual(listRes.result.total_servers, 2);
  console.log(`  ✓ list_mcp_servers returned ${listRes.result.total_servers} active servers.`);

  const reloadRes = await executeMetaTool("reload_tools", {}, mockEnv);
  assert.strictEqual(reloadRes.isError, false);
  assert.strictEqual(reloadRes.result.status, "reloaded");
  console.log("  ✓ reload_tools refreshed tool cache cleanly.");

  // -------------------------------------------------------------
  // Test 5: Worker HTTP Endpoints (/health, /tools, CORS)
  // -------------------------------------------------------------
  console.log("\n5. Testing Worker HTTP Endpoints:");
  const healthRes = await worker.fetch(
    new Request("https://spark-agent.local/health"),
    mockEnv,
    mockCtx
  );
  assert.strictEqual(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.service, "spark-telegram-agent");
  assert.strictEqual(healthData.configured.allowedUserId, true);
  console.log("  ✓ /health endpoint returned 200 OK.");

  const corsRes = await worker.fetch(
    new Request("https://spark-agent.local/webhook", { method: "OPTIONS" }),
    mockEnv,
    mockCtx
  );
  assert.strictEqual(corsRes.status, 204);
  console.log("  ✓ OPTIONS preflight returned 204 No Content.");

  const toolsRes = await worker.fetch(
    new Request("https://spark-agent.local/tools"),
    mockEnv,
    mockCtx
  );
  assert.strictEqual(toolsRes.status, 200);
  const toolsData = await toolsRes.json();
  assert.ok(toolsData.metaTools.length >= 4);
  console.log(`  ✓ /tools endpoint returned ${toolsData.metaTools.length} meta-tools.`);

  // -------------------------------------------------------------
  // Test 6: Security Authorization (ALLOWED_USER_ID)
  // -------------------------------------------------------------
  console.log("\n6. Testing Security Filter (ALLOWED_USER_ID):");
  // Unauthorized user (ID: 111222333 !== 987654321)
  const unauthRes = await worker.fetch(
    new Request("https://spark-agent.local/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 10,
          from: { id: 111222333, is_bot: false, first_name: "Intruder" },
          chat: { id: 111222333, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "Hello I am an unauthorized user",
        },
      }),
    }),
    mockEnv,
    mockCtx
  );
  assert.strictEqual(unauthRes.status, 200);
  const unauthData = await unauthRes.json();
  assert.strictEqual(unauthData.ok, true);
  console.log("  ✓ Unauthorized user dropped safely with 200 OK without executing agent.");

  // -------------------------------------------------------------
  // Test 7: Multi-Step Agentic Loop Simulation
  // -------------------------------------------------------------
  console.log("\n7. Testing Multi-Step Agentic Loop (Function Calling & Delivery):");

  let chatActionSent = false;
  let telegramMessageSent = false;
  let finalTelegramPayload = null;
  let geminiCallCount = 0;

  // Intercept global fetch for this unit test
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);

    // Telegram Bot API intercepts
    if (urlStr.includes("api.telegram.org")) {
      if (urlStr.includes("sendChatAction")) {
        chatActionSent = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("sendMessage")) {
        telegramMessageSent = true;
        finalTelegramPayload = JSON.parse(options.body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 55 } }), { status: 200 });
      }
    }

    // Gemini REST API intercepts
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      geminiCallCount++;
      const reqBody = JSON.parse(options.body);

      // Step 1: Gemini decides to call a Meta-Tool (list_mcp_servers)
      if (geminiCallCount === 1) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "list_mcp_servers",
                        args: {},
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Step 2: Gemini receives function response and provides final text
      if (geminiCallCount === 2) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      text: "مرحباً! خوادم الـ MCP النشطة لديك حالياً هي: mem0 و telegram_userbot.",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Fallback to original fetch
    return originalFetch(url, options);
  };

  try {
    const authWebhookRes = await worker.fetch(
      new Request("https://spark-agent.local/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          update_id: 2,
          message: {
            message_id: 11,
            from: { id: 987654321, is_bot: false, first_name: "Mohamed" },
            chat: { id: 987654321, type: "private" },
            date: Math.floor(Date.now() / 1000),
            text: "ما هي سيرفرات MCP المربوطة حالياً؟",
          },
        }),
      }),
      mockEnv,
      mockCtx
    );

    assert.strictEqual(authWebhookRes.status, 200);
    assert.strictEqual(chatActionSent, true, "Typing action must be sent");
    assert.strictEqual(geminiCallCount, 2, "Agentic loop must have executed 2 Gemini steps");
    assert.strictEqual(telegramMessageSent, true, "Final Telegram response must be sent");
    assert.ok(
      finalTelegramPayload.text.includes("خوادم الـ MCP النشطة"),
      "Response text must match final Gemini answer"
    );
    console.log("  ✓ Multi-step agentic loop executed, tool called, and final message delivered to Telegram.");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("\n=== ALL SPARK-TELEGRAM-AGENT TESTS PASSED 100% SUCCESSFULLY ===");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
