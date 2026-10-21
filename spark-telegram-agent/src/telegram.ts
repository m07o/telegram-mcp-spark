/**
 * Telegram Bot API client for spark-telegram-agent
 * Handles typing actions, intelligent message chunking, and Markdown fallback.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * Sends a chat action (e.g. "typing") to indicate ongoing background processing.
 */
export async function sendChatAction(
  botToken: string,
  chatId: number | string,
  action: string = "typing"
): Promise<boolean> {
  try {
    const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendChatAction`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        action,
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[Telegram] Failed to send chat action '${action}':`, err);
    return false;
  }
}

/**
 * Splits text into chunks strictly less than or equal to maxLen (Telegram limit is 4096).
 * Preserves paragraph breaks and code fence integrity where possible.
 */
export function chunkText(text: string, maxLen: number = 4000): string[] {
  if (!text || text.length <= maxLen) {
    return [text || ""];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try splitting at double newline
    let splitIdx = remaining.lastIndexOf("\n\n", maxLen);
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      // Try splitting at single newline
      splitIdx = remaining.lastIndexOf("\n", maxLen);
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      // Try splitting at space
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx === -1 || splitIdx < maxLen * 0.3) {
      // Hard split at maxLen
      splitIdx = maxLen;
    }

    const chunk = remaining.slice(0, splitIdx).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks;
}

/**
 * Sends a message to a chat, with automatic chunking for long messages
 * and automatic fallback to plain text if Markdown parsing fails.
 */
export async function sendMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  parseMode: string = "Markdown"
): Promise<{ success: boolean; sentCount: number; errors?: string[] }> {
  const chunks = chunkText(text, 4000);
  let sentCount = 0;
  const errors: string[] = [];

  for (const chunk of chunks) {
    let sent = false;

    // 1. Attempt sending with specified parse_mode (Markdown)
    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      });

      if (res.ok) {
        sent = true;
        sentCount++;
      } else {
        const errData: any = await res.json().catch(() => ({}));
        console.warn(`[Telegram] sendMessage failed with ${parseMode}: ${errData?.description}`);

        // 2. Fallback: retry without parse_mode (plain text)
        const fallbackRes = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
          }),
        });

        if (fallbackRes.ok) {
          sent = true;
          sentCount++;
        } else {
          const fbErr: any = await fallbackRes.json().catch(() => ({}));
          errors.push(fbErr?.description || `HTTP ${fallbackRes.status}`);
        }
      }
    } catch (err: any) {
      // Network failure on Markdown attempt -> try plain text
      try {
        const fallbackRes = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
          }),
        });
        if (fallbackRes.ok) {
          sent = true;
          sentCount++;
        } else {
          errors.push(err?.message || "Network error");
        }
      } catch (fbErr: any) {
        errors.push(fbErr?.message || "Fallback network error");
      }
    }

    // Brief throttle delay between multi-part messages
    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  return {
    success: sentCount === chunks.length,
    sentCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}
