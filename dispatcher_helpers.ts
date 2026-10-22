import { TelegramClient, Api } from "telegram";

export const RESOLVED_ENTITY_CACHE = new Map<string, any>();
export const PROCESSED_MESSAGES_DB = new Map<string, any>();
export const SERIES_EPISODES_DB = new Map<string, any>();
export const TOPIC_BINDINGS_DB = new Map<string, any>();
export const MIGRATION_JOBS_DB = new Map<string, any>();
export const REF_MAP_DB = new Map<string, any[]>();
export let DB_INITIALIZED = true;

// Active Cloudflare KV Namespace reference (if bound in environment)
export let ACTIVE_KV_NAMESPACE: any = null;

export function setKvNamespace(kv: any) {
  ACTIVE_KV_NAMESPACE = kv;
}

export function getKvNamespace() {
  return ACTIVE_KV_NAMESPACE;
}

/**
 * Cloudflare KV asynchronous persistence helpers with graceful in-memory fallback
 */
export async function persistKvSet(key: string, value: any, expirationTtlSecs?: number): Promise<void> {
  if (ACTIVE_KV_NAMESPACE && typeof ACTIVE_KV_NAMESPACE.put === "function") {
    try {
      const opts = expirationTtlSecs ? { expirationTtl: expirationTtlSecs } : undefined;
      await ACTIVE_KV_NAMESPACE.put(key, JSON.stringify(value), opts);
    } catch (err) {
      console.warn(`[KV_PUT_ERROR] key ${key}:`, err);
    }
  }
}

export async function persistKvGet<T = any>(key: string): Promise<T | null> {
  if (ACTIVE_KV_NAMESPACE && typeof ACTIVE_KV_NAMESPACE.get === "function") {
    try {
      const val = await ACTIVE_KV_NAMESPACE.get(key, "json");
      return val as T;
    } catch (err) {
      console.warn(`[KV_GET_ERROR] key ${key}:`, err);
    }
  }
  return null;
}

export async function persistKvDelete(key: string): Promise<void> {
  if (ACTIVE_KV_NAMESPACE && typeof ACTIVE_KV_NAMESPACE.delete === "function") {
    try {
      await ACTIVE_KV_NAMESPACE.delete(key);
    } catch (err) {
      console.warn(`[KV_DELETE_ERROR] key ${key}:`, err);
    }
  }
}

/**
 * Smart Auto-Retry helper for MTProto operations:
 * Automatically pauses and retries when Telegram returns minor FloodWait (<= maxWaitSecs).
 * Completely transparent to user commands and prevents operation failure on transient rate limits.
 */
export async function withSmartRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  maxWaitSecs: number = 10,
  opName: string = "MTProto operation"
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const msg = String(err?.errorMessage || err?.message || "");
      const isFlood = Boolean(err?.seconds || msg.includes("FLOOD_WAIT") || err?.name === "FloodWaitError");
      const waitSecs = Number(err?.seconds || msg.match(/\d+/)?.[0] || 0);

      if (isFlood && waitSecs > 0 && waitSecs <= maxWaitSecs && attempt <= maxRetries) {
        const sleepMs = waitSecs * 1000 + 500;
        console.warn(`[SmartRetry] ${opName}: FloodWait of ${waitSecs}s received. Auto-sleeping ${sleepMs}ms (attempt ${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, sleepMs));
        continue;
      }
      throw err;
    }
  }
}

export function setDbInitialized(val: boolean) {
  DB_INITIALIZED = val;
}

const ARABIC_DIGITS_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function normalizeArabicDigits(input: string): string {
  return String(input || "").replace(/[٠-٩]/g, (d) => ARABIC_DIGITS_MAP[d] || d);
}

export function normalizeForumTitle(title: string): string {
  return normalizeArabicDigits(String(title || ""))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function sanitizeTopicTitle(title: string, maxLength: number = 128): string {
  if (!title) return "[empty]";
  const cleaned = String(title)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "[empty]").slice(0, maxLength);
}

export function isNoiseMessage(msg: any): boolean {
  const rawText = String(msg?.message || msg?.text || "");
  const stripped = rawText.trim();
  const hasMedia = Boolean(msg?.media);
  const hasEntities = Boolean(msg?.entities && msg.entities.length > 0);

  if (!stripped && !hasMedia) return true;
  if (!hasMedia && /^[=\-_.~*#+—–•·\s]{1,}$/.test(stripped)) return true;
  if (/^\/\w+(@\w+)?$/.test(stripped)) return true;
  if (!hasMedia && !hasEntities && stripped.length <= 3 && /^[.\-=_*~/]+$/.test(stripped)) return true;
  return false;
}

export function extractEpisodeInfo(text: string): { season: number; episode: number } | null {
  const t = normalizeArabicDigits(String(text || ""));
  const mSeason = t.match(/\bS(\d{1,2})\s?E(\d{1,3})\b/i);
  if (mSeason) {
    return { season: parseInt(mSeason[1], 10), episode: parseInt(mSeason[2], 10) };
  }
  const patterns = [
    /(?:الحلقة|حلقه|حلقة)\s*(\d{1,3})/i,
    /\b(?:EP|E)\s?-?(\d{1,3})\b/i,
    /^(\d{1,3})[.\-\s]/m,
    /\bab[i1l]\s?0?(\d{1,3})\b/i,
    /\bbrother\s*0?(\d{1,3})\b/i,
  ];
  for (const pat of patterns) {
    const m = t.match(pat);
    if (m) {
      return { season: 1, episode: parseInt(m[1], 10) };
    }
  }
  return null;
}

export async function computeSha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeContentHash(
  text: string,
  fileName: string = "",
  fileSizeBytes: number = 0
): Promise<string> {
  const normText = normalizeArabicDigits(String(text || ""))
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/@\w+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const normFile = String(fileName || "").trim().toLowerCase();
  const payload = `${normText}|${normFile}|${Number(fileSizeBytes || 0)}`;
  const hex = await computeSha256Hex(payload);
  return `sha256:${hex}`;
}

export function getMessageFingerprint(msg: any): string {
  const text = normalizeArabicDigits(String(msg?.message || msg?.text || ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const mediaClass = msg?.media?.className || "none";
  const docId =
    msg?.media?.document?.id?.toString() ||
    msg?.media?.photo?.id?.toString() ||
    "";
  const size = msg?.media?.document?.size?.toString() || "";
  return `${mediaClass}:${docId || size}:${text.slice(0, 120)}`;
}

export async function fetchAllForumTopics(
  client: TelegramClient,
  inputChannel: Api.InputChannel,
  maxTopics: number = 2000,
  searchQuery?: string
): Promise<any[]> {
  const allTopics: any[] = [];
  let offsetTopic = 0;
  let offsetId = 0;
  let offsetDate = 0;
  const startTime = Date.now();

  // Allow up to 7 minutes (420,000ms) with smart auto-retry protection
  while (allTopics.length < maxTopics && Date.now() - startTime < 420000) {
    const res: any = await withSmartRetry(
      () =>
        client.invoke(
          new Api.channels.GetForumTopics({
            channel: inputChannel,
            q: searchQuery || undefined,
            offsetDate,
            offsetId,
            offsetTopic,
            limit: Math.min(100, maxTopics - allTopics.length),
          })
        ),
      2,
      8,
      "GetForumTopics"
    );
    const batch = res.topics || [];
    if (!batch.length) break;
    for (const t of batch) {
      if (t.className === "ForumTopic" || (t.id !== undefined && t.title !== undefined)) {
        allTopics.push(t);
      }
    }
    if (batch.length < 100) break;
    const last = batch[batch.length - 1];
    if (!last || (last.id === offsetTopic && last.topMessage === offsetId)) break;
    offsetTopic = last.id || 0;
    offsetId = last.topMessage || 0;
    offsetDate = last.date || 0;
  }
  return allTopics;
}

export async function fetchTopicMessagesChronological(
  client: TelegramClient,
  entity: any,
  topicId: number,
  maxMessages: number = 200
): Promise<any[]> {
  const limit = maxMessages > 0 ? Math.min(maxMessages, 500) : 200;
  const msgs = await withSmartRetry(
    () =>
      client.getMessages(entity, {
        replyTo: Number(topicId),
        limit,
      }),
    2,
    6,
    "getTopicMessages"
  );
  return [...msgs].filter((m: any) => m && m.id !== Number(topicId)).reverse();
}

export function formatTelegramError(err: any, context?: string): string {
  if (!err) return `Unknown error in ${context || "operation"}.`;
  const name = err.name || err.constructor?.name || "TelegramError";
  const msg = err.errorMessage || err.message || String(err);
  const prefix = context ? `[${context}] ` : "";

  if (err.seconds || name.includes("FloodWait") || msg.includes("FLOOD_WAIT")) {
    const secs = err.seconds || msg.match(/\d+/)?.[0] || "several";
    return `${prefix}FloodWaitError: Telegram requires waiting ${secs} seconds before repeating this action.`;
  }
  if (msg.includes("CHAT_WRITE_FORBIDDEN") || name.includes("ChatWriteForbidden")) {
    return `${prefix}ChatWriteForbiddenError: You do not have permission to write or create topics in this chat/channel.`;
  }
  if (msg.includes("CHANNEL_PRIVATE") || name.includes("ChannelPrivate")) {
    return `${prefix}ChannelPrivateError: Channel is private, inaccessible, or you are not a member.`;
  }
  if (msg.includes("TOPIC_NOT_MODIFIED")) {
    return `${prefix}TopicNotModifiedError: The topic already has this configuration.`;
  }
  if (msg.includes("FORUM_CLOSED")) {
    return `${prefix}ForumClosedError: Forum topics are closed in this supergroup.`;
  }
  if (msg.includes("PEER_ID_INVALID")) {
    return `${prefix}PeerIdInvalidError: The provided chat_id could not be resolved. Ensure you are a member of the group/channel.`;
  }
  return `${prefix}${name}: ${msg}`;
}

export function extractTopicId(res: any): number | null {
  if (!res) return null;
  if (typeof res.id === "number") return res.id;
  const updates = res.updates || (Array.isArray(res) ? res : []);
  for (const u of updates) {
    if (u.message && typeof u.message.id === "number") {
      return u.message.id;
    }
    if (typeof u.id === "number" && u.id > 0) {
      return u.id;
    }
  }
  return null;
}

export async function resolveEntity(client: TelegramClient, peer: any): Promise<any> {
  if (!peer) {
    throw new Error("Cannot resolve entity: peer identifier is empty.");
  }
  if (
    peer instanceof Api.InputPeerChannel ||
    peer instanceof Api.InputPeerUser ||
    peer instanceof Api.InputPeerChat ||
    peer instanceof Api.InputPeerSelf ||
    peer instanceof Api.InputChannel ||
    peer instanceof Api.Channel ||
    peer instanceof Api.User ||
    peer instanceof Api.Chat
  ) {
    return peer;
  }

  const peerStr = String(peer).trim();
  if (peerStr === "me" || peerStr === "self" || peerStr === "this") {
    return new Api.InputPeerSelf();
  }

  let normalizedKey = peerStr;
  let bareNumericKey = "";
  if (/^\d+$/.test(peerStr)) {
    bareNumericKey = peerStr;
    normalizedKey = `-100${peerStr}`;
  } else if (peerStr.startsWith("-100")) {
    bareNumericKey = peerStr.replace(/^-100/, "");
  }

  if (RESOLVED_ENTITY_CACHE.has(peerStr)) return RESOLVED_ENTITY_CACHE.get(peerStr);
  if (RESOLVED_ENTITY_CACHE.has(normalizedKey)) return RESOLVED_ENTITY_CACHE.get(normalizedKey);
  if (bareNumericKey && RESOLVED_ENTITY_CACHE.has(bareNumericKey)) return RESOLVED_ENTITY_CACHE.get(bareNumericKey);

  try {
    const cachedRes = (client as any)._entityCache?.get(normalizedKey) ||
                      (client as any)._entityCache?.get(bareNumericKey) ||
                      (client as any)._entityCache?.get(peerStr);
    if (cachedRes) {
      RESOLVED_ENTITY_CACHE.set(peerStr, cachedRes);
      return cachedRes;
    }
  } catch {}

  try {
    const dialogs = await client.getDialogs({ limit: 100 });
    for (const d of dialogs) {
      const dId = d.id?.toString() || "";
      const bareDId = dId.replace(/^-100/, "");
      const entity = d.inputEntity || d.entity || d;
      if (dId) {
        RESOLVED_ENTITY_CACHE.set(dId, entity);
        RESOLVED_ENTITY_CACHE.set(bareDId, entity);
        RESOLVED_ENTITY_CACHE.set(`-100${bareDId}`, entity);
      }
      const username = (d.entity as any)?.username;
      if (username) {
        RESOLVED_ENTITY_CACHE.set(username.toLowerCase(), entity);
        RESOLVED_ENTITY_CACHE.set(`@${username.toLowerCase()}`, entity);
      }
    }
    if (RESOLVED_ENTITY_CACHE.has(peerStr)) return RESOLVED_ENTITY_CACHE.get(peerStr);
    if (RESOLVED_ENTITY_CACHE.has(normalizedKey)) return RESOLVED_ENTITY_CACHE.get(normalizedKey);
    if (bareNumericKey && RESOLVED_ENTITY_CACHE.has(bareNumericKey)) return RESOLVED_ENTITY_CACHE.get(bareNumericKey);
  } catch {}

  if (!bareNumericKey && !peerStr.startsWith("-")) {
    const cleanUsername = peerStr.replace(/^@/, "");
    try {
      const res: any = await client.invoke(new Api.contacts.ResolveUsername({ username: cleanUsername }));
      if (res.chats?.length) {
        const chat = res.chats[0];
        const inputPeer = new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash });
        RESOLVED_ENTITY_CACHE.set(peerStr, inputPeer);
        return inputPeer;
      }
      if (res.users?.length) {
        const user = res.users[0];
        const inputPeer = new Api.InputPeerUser({ userId: user.id, accessHash: user.accessHash });
        RESOLVED_ENTITY_CACHE.set(peerStr, inputPeer);
        return inputPeer;
      }
    } catch {}
  }

  try {
    const direct = await Promise.race([
      client.getEntity(normalizedKey),
      new Promise((_, reject) => setTimeout(() => reject(new Error("getEntity timeout")), 3000)),
    ]);
    if (direct) {
      RESOLVED_ENTITY_CACHE.set(peerStr, direct);
      return direct;
    }
  } catch {}

  throw new Error(`Could not resolve entity for ${peerStr}. Ensure the account is a member or the chat exists.`);
}

export async function resolveInputChannel(client: TelegramClient, peer: any): Promise<Api.InputChannel> {
  if (!peer) throw new Error("Cannot resolve InputChannel: peer identifier is empty.");
  if (peer instanceof Api.InputChannel) return peer;
  if (peer instanceof Api.InputPeerChannel) return new Api.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash });
  if (peer instanceof Api.Channel || peer instanceof Api.ChannelForbidden) {
    return new Api.InputChannel({ channelId: peer.id, accessHash: peer.accessHash || (BigInt(0) as any) });
  }

  const resolved = await resolveEntity(client, peer);
  if (resolved instanceof Api.InputChannel) return resolved;
  if (resolved instanceof Api.InputPeerChannel) return new Api.InputChannel({ channelId: resolved.channelId, accessHash: resolved.accessHash });
  if (resolved instanceof Api.Channel || resolved instanceof Api.ChannelForbidden) {
    return new Api.InputChannel({ channelId: resolved.id, accessHash: resolved.accessHash || (BigInt(0) as any) });
  }
  if (resolved?.inputEntity instanceof Api.InputPeerChannel) {
    return new Api.InputChannel({ channelId: resolved.inputEntity.channelId, accessHash: resolved.inputEntity.accessHash });
  }
  if (resolved?.entity instanceof Api.Channel) {
    return new Api.InputChannel({ channelId: resolved.entity.id, accessHash: resolved.entity.accessHash || (BigInt(0) as any) });
  }
  throw new Error(`Resolved entity for ${String(peer)} is not a valid Channel/Supergroup.`);
}

export function successResult(data: any): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    isError: false,
  };
}

export function errorResult(message: string): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return {
    content: [{ type: "text" as const, text: `Validation/Error: ${message}` }],
    isError: true,
  };
}
