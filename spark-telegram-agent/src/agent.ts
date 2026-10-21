/**
 * Spark Agentic Engine
 * Coordinates Mem0 memory recall, multi-step Gemini tool loops, Meta-Tools, and Telegram delivery.
 */

import { Env, GeminiContent, GeminiPart, TelegramUpdate } from "./types";
import { sendChatAction, sendMessage } from "./telegram";
import { getAllRegisteredTools, BoundTool } from "./mcp_registry";
import { executeServerTool } from "./mcp_client";
import { META_TOOL_DECLARATIONS, META_TOOL_NAMES, executeMetaTool } from "./meta_tools";
import { callGemini, mcpToolToGeminiFunction } from "./gemini";

const DEFAULT_SYSTEM_INSTRUCTION = `أنت سبارك (Spark)، المساعد الذكي والوكيل المستقل عبر تيليجرام.
لديك وصول مباشر إلى خوادم MCP متعددة (بما في ذلك Userbot تيليجرام، وخادم الذاكرة Mem0، وخوادم مخصصة).
تتحدث باللغة العربية بأسلوب راقٍ، دقيق، وذكي، وتساعد المستخدم في إنجاز مهامه البرمجية وإدارة حساباته وقنواته.

قواعد العمل:
1. تصرف كوكيل مستقل (Autonomous Agent): استخدم الأدوات المتاحة كلما دعت الحاجة دون تردد لإتمام المهمة.
2. إذا طلب المستخدم عمليات على تيليجرام (موضوعات، رسائل، نسخ، قنوات)، استخدم أدوات telegram_userbot.
3. إذا طلب المستخدم تذكر شيء أو كان هناك سياق سابق، استفد من سياق Mem0.
4. يمكنك إدارة قدراتك الخاصة وسيرفراتك عبر أدوات Meta-Tools (مثل register_mcp_server, list_mcp_servers, remove_mcp_server, reload_tools).
5. صِغ إجاباتك بتنسيق Markdown منسق ومنظم وواضح.`;

const MAX_AGENT_STEPS = 10;

/**
 * Attempts to retrieve relevant memory context from Mem0 for this user/query.
 */
async function retrieveMem0Context(
  env: Env,
  userId: number | string,
  query: string,
  allTools: BoundTool[]
): Promise<string> {
  const mem0SearchTool = allTools.find(
    (t) =>
      t.serverName === "mem0" &&
      (t.originalName === "search_memories" ||
        t.originalName === "get_all_memories" ||
        t.originalName === "get_memories")
  );

  if (!mem0SearchTool) return "";

  try {
    const result = await executeServerTool(mem0SearchTool.serverUrl, mem0SearchTool.originalName, {
      query: query.slice(0, 200),
      user_id: String(userId),
      limit: 5,
    });

    if (result.isError || !result.content?.[0]?.text) return "";

    const text = result.content[0].text;
    if (text && text.length > 10 && !text.includes("[]")) {
      return `\n[سياق الذاكرة المسترجع من Mem0 للمستخدم]:\n${text.slice(0, 1500)}\n`;
    }
  } catch (err) {
    console.warn("[Mem0] Background context retrieval failed:", err);
  }

  return "";
}

/**
 * Records the conversation turn into Mem0 in the background.
 */
async function recordToMem0(
  env: Env,
  userId: number | string,
  userMessage: string,
  agentReply: string,
  allTools: BoundTool[]
): Promise<void> {
  const mem0AddTool = allTools.find(
    (t) =>
      t.serverName === "mem0" &&
      (t.originalName === "add_memory" || t.originalName === "add_memories")
  );

  if (!mem0AddTool) return;

  try {
    await executeServerTool(mem0AddTool.serverUrl, mem0AddTool.originalName, {
      user_id: String(userId),
      messages: [
        { role: "user", content: userMessage.slice(0, 1000) },
        { role: "assistant", content: agentReply.slice(0, 1500) },
      ],
      infer: true,
    });
  } catch (err) {
    console.warn("[Mem0] Background add_memory failed:", err);
  }
}

/**
 * Main autonomous agent runner.
 */
export async function handleTelegramMessage(
  update: TelegramUpdate,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const message = update.message || update.edited_message;
  if (!message || !message.text) {
    return;
  }

  const chatId = message.chat.id;
  const fromUser = message.from;
  const userText = message.text.trim();

  // Strict Authorization Check: Only respond to ALLOWED_USER_ID
  if (!fromUser || String(fromUser.id) !== String(env.ALLOWED_USER_ID).trim()) {
    console.warn(`[Security] Unauthorized access attempt from User ID: ${fromUser?.id}`);
    return;
  }

  // 1. Send initial typing indicator
  await sendChatAction(env.TELEGRAM_BOT_TOKEN, chatId, "typing");

  // 2. Fetch all registered MCP tools & prepare mapping
  const registeredTools = await getAllRegisteredTools(env);
  const toolMap = new Map<string, BoundTool>();
  for (const t of registeredTools) {
    toolMap.set(t.geminiName, t);
  }

  // 3. Pre-fetch relevant memory from Mem0
  const memoryContext = await retrieveMem0Context(env, fromUser.id, userText, registeredTools);

  // 4. Assemble Gemini Tools declarations
  const geminiFunctions = [
    ...META_TOOL_DECLARATIONS,
    ...registeredTools.map((t) => mcpToolToGeminiFunction(t.definition, t.geminiName)),
  ];

  // 5. Build conversation history
  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [
        {
          text: memoryContext ? `${memoryContext}\nرسالة المستخدم: ${userText}` : userText,
        },
      ],
    },
  ];

  const systemInstructionText = env.SYSTEM_INSTRUCTION || DEFAULT_SYSTEM_INSTRUCTION;
  let finalResponseText = "";

  // 6. Multi-Step Tool Execution Loop
  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    // Keep typing indicator active for each iteration
    ctx.waitUntil(sendChatAction(env.TELEGRAM_BOT_TOKEN, chatId, "typing"));

    let response;
    try {
      response = await callGemini(env, {
        contents,
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        tools: geminiFunctions.length > 0 ? [{ functionDeclarations: geminiFunctions }] : undefined,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      });
    } catch (err: any) {
      console.error(`[Gemini] Execution error at step ${step}:`, err);
      finalResponseText = `عذراً، حدث خطأ أثناء التواصل مع نموذج Gemini:\n\`${err?.message || String(err)}\``;
      break;
    }

    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content || !candidate.content.parts) {
      finalResponseText = "عذراً، لم أتلقَ رداً واضحاً من النموذج الذكي.";
      break;
    }

    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p) => p.functionCall);

    // If no function calls, we have our final text response
    if (functionCalls.length === 0) {
      const textParts = parts.filter((p) => p.text).map((p) => p.text).join("\n\n");
      finalResponseText = textParts || "تمت معالجة طلبك بنجاح.";
      break;
    }

    // Append the model's turn containing function calls
    contents.push({
      role: "model",
      parts,
    });

    // Execute each function call
    const functionResponseParts: GeminiPart[] = [];

    for (const p of functionCalls) {
      const fc = p.functionCall!;
      const fnName = fc.name;
      const fnArgs = fc.args || {};

      let resultData: any;
      let isError = false;

      if (META_TOOL_NAMES.has(fnName)) {
        // Execute Meta-Tool
        const metaRes = await executeMetaTool(fnName, fnArgs, env);
        resultData = metaRes.result;
        isError = metaRes.isError;
      } else if (toolMap.has(fnName)) {
        // Execute Remote MCP Tool
        const bound = toolMap.get(fnName)!;
        const toolRes = await executeServerTool(bound.serverUrl, bound.originalName, fnArgs);
        resultData = toolRes.content?.[0]?.text || toolRes.content || "executed";
        isError = Boolean(toolRes.isError);
      } else {
        resultData = `Error: Tool '${fnName}' is not recognized in active registry.`;
        isError = true;
      }

      functionResponseParts.push({
        functionResponse: {
          name: fnName,
          response: {
            content: resultData,
            isError,
          },
        },
      });
    }

    // Append the function responses as user role turn
    contents.push({
      role: "user",
      parts: functionResponseParts,
    });
  }

  if (!finalResponseText) {
    finalResponseText = "تم إكمال الخطوات ولكن تم الوصول إلى الحد الأقصى لدورات الأدوات.";
  }

  // 7. Send final answer to Telegram (with chunking and Markdown fallback)
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, finalResponseText, "Markdown");

  // 8. Background task: Record to Mem0 without blocking
  ctx.waitUntil(recordToMem0(env, fromUser.id, userText, finalResponseText, registeredTools));
}
