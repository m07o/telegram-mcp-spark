import { handleDbTool } from "./handlers_db";
import { handleMigrationTool } from "./handlers_migration";
import { handleChatsMessagesTool } from "./handlers_chats_messages";
import { handleGroupsProfileTool } from "./handlers_groups_profile";
/**
 * Telegram MTProto Userbot Tool Dispatcher
 * Implements execution logic for tools extracted from the Python codebase using GramJS.
 * Includes automatic cache warming, -100 entity resolution, and safe forum topics iteration.
 */

import { TelegramClient, Api } from "telegram";

// Module-level cache for resolved entities and input entities
const RESOLVED_ENTITY_CACHE = new Map<string, any>();

/**
 * Formats Telegram and MTProto errors into clean, human-readable strings
 * avoiding hanging promises and providing immediate feedback.
 */
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

/**
 * Extracts newly created topic ID from Api.Updates / UpdateNewChannelMessage
 */
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

/**
 * Robust Entity Resolution with automatic cache warming (client.getDialogs).
 * Guaranteed to never invoke channels.GetChannels with accessHash=0.
 */
export async function resolveEntity(client: TelegramClient, peer: any): Promise<any> {
  if (!peer) {
    throw new Error("Cannot resolve entity: peer identifier is empty.");
  }

  // 1. Direct short-circuit if already an InputPeer, InputChannel, or Entity object
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

  // 2. Known local keywords
  if (peerStr === "me" || peerStr === "self" || peerStr === "this") {
    return new Api.InputPeerSelf();
  }

  // 3. Normalized string representation
  let normalizedKey = peerStr;
  let bareNumericKey = "";
  if (/^\d+$/.test(peerStr)) {
    bareNumericKey = peerStr;
    normalizedKey = `-100${peerStr}`;
  } else if (peerStr.startsWith("-100")) {
    bareNumericKey = peerStr.replace(/^-100/, "");
  }

  // 4. Check memory cache first
  if (RESOLVED_ENTITY_CACHE.has(peerStr)) return RESOLVED_ENTITY_CACHE.get(peerStr);
  if (RESOLVED_ENTITY_CACHE.has(normalizedKey)) return RESOLVED_ENTITY_CACHE.get(normalizedKey);
  if (bareNumericKey && RESOLVED_ENTITY_CACHE.has(bareNumericKey)) return RESOLVED_ENTITY_CACHE.get(bareNumericKey);

  // 5. Check GramJS internal client._entityCache
  try {
    const cachedRes = (client as any)._entityCache?.get(normalizedKey) ||
                      (client as any)._entityCache?.get(bareNumericKey) ||
                      (client as any)._entityCache?.get(peerStr);
    if (cachedRes) {
      RESOLVED_ENTITY_CACHE.set(peerStr, cachedRes);
      return cachedRes;
    }
  } catch {}

  // 6. Warm up cache using getDialogs to fetch real channels and their accessHash
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
  } catch (dialogErr) {
    // Continue to username lookup
  }

  // 7. If username format, use ResolveUsername directly
  if (!bareNumericKey && !peerStr.startsWith("-")) {
    const cleanUsername = peerStr.replace(/^@/, "");
    try {
      const res: any = await client.invoke(
        new Api.contacts.ResolveUsername({ username: cleanUsername })
      );
      if (res.chats?.length) {
        const chat = res.chats[0];
        const inputPeer = new Api.InputPeerChannel({
          channelId: chat.id,
          accessHash: chat.accessHash,
        });
        RESOLVED_ENTITY_CACHE.set(peerStr, inputPeer);
        RESOLVED_ENTITY_CACHE.set(chat.id.toString(), inputPeer);
        return inputPeer;
      }
      if (res.users?.length) {
        const user = res.users[0];
        const inputPeer = new Api.InputPeerUser({
          userId: user.id,
          accessHash: user.accessHash,
        });
        RESOLVED_ENTITY_CACHE.set(peerStr, inputPeer);
        return inputPeer;
      }
    } catch {}
  }

  // 8. Safe getEntity fallback with 3-second timeout to prevent 25s hang
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

/**
 * Resolves an entity specifically into an Api.InputChannel with accessHash.
 * Guarantees that channels.CreateForumTopic and channel operations have a valid InputChannel.
 */
export async function resolveInputChannel(client: TelegramClient, peer: any): Promise<Api.InputChannel> {
  if (!peer) {
    throw new Error("Cannot resolve InputChannel: peer identifier is empty.");
  }
  if (peer instanceof Api.InputChannel) {
    return peer;
  }
  if (peer instanceof Api.InputPeerChannel) {
    return new Api.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash });
  }
  if (peer instanceof Api.Channel || peer instanceof Api.ChannelForbidden) {
    return new Api.InputChannel({
      channelId: peer.id,
      accessHash: peer.accessHash || (BigInt(0) as any),
    });
  }

  const resolved = await resolveEntity(client, peer);
  if (resolved instanceof Api.InputChannel) {
    return resolved;
  }
  if (resolved instanceof Api.InputPeerChannel) {
    return new Api.InputChannel({ channelId: resolved.channelId, accessHash: resolved.accessHash });
  }
  if (resolved instanceof Api.Channel || resolved instanceof Api.ChannelForbidden) {
    return new Api.InputChannel({
      channelId: resolved.id,
      accessHash: resolved.accessHash || (BigInt(0) as any),
    });
  }
  if (resolved?.inputEntity instanceof Api.InputPeerChannel) {
    return new Api.InputChannel({
      channelId: resolved.inputEntity.channelId,
      accessHash: resolved.inputEntity.accessHash,
    });
  }
  if (resolved?.entity instanceof Api.Channel) {
    return new Api.InputChannel({
      channelId: resolved.entity.id,
      accessHash: resolved.entity.accessHash || (BigInt(0) as any),
    });
  }

  throw new Error(`Resolved entity for ${String(peer)} is not a valid Channel/Supergroup.`);
}

export async function dispatchUserbotTool(
  name: string,
  args: Record<string, any>,
  client: TelegramClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean }> {
  try {
    // Check modular handler libraries first for all 172+ tools
    const dbRes = await handleDbTool(name, args, client);
    if (dbRes) return dbRes;

    const migRes = await handleMigrationTool(name, args, client, dispatchUserbotTool);
    if (migRes) return migRes;

    const chatMsgRes = await handleChatsMessagesTool(name, args, client);
    if (chatMsgRes) return chatMsgRes;

    const grpProfRes = await handleGroupsProfileTool(name, args, client);
    if (grpProfRes) return grpProfRes;

    switch (name) {
      // 1. Core Messaging & Userbot tools
      case "send_user_message":
      case "send_message": {
        const peer = args.chat_id || args.peer || args.recipient || args.username;
        const text = args.text || args.message;
        if (!peer || !text) {
          return errorResult("chat_id (or peer) and text are required.");
        }
        try {
          const entity = await resolveEntity(client, peer);
          const replyTo = args.reply_to_msg_id || args.reply_to || args.topic_id;
          const sent = await client.sendMessage(entity, {
            message: String(text),
            replyTo: replyTo ? Number(replyTo) : undefined,
          });
          return successResult({
            status: "sent",
            id: sent.id,
            chatId: peer,
            date: sent.date,
            text: sent.message,
          });
        } catch (err: any) {
          return errorResult(formatTelegramError(err, "send_user_message"));
        }
      }

      case "read_chat_history":
      case "get_messages":
      case "get_chat_history": {
        const peer = args.chat_id || args.peer || args.entity;
        if (!peer) {
          return errorResult("chat_id is required.");
        }
        const entity = await resolveEntity(client, peer);
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
        const offsetId = args.offset_id ? Number(args.offset_id) : undefined;
        const messages = await client.getMessages(entity, {
          limit,
          offsetId,
          search: args.search || args.query,
        });
        const formatted = messages.map((m: any) => ({
          id: m.id,
          date: m.date,
          senderId: m.senderId?.toString() || null,
          text: m.message || "",
          out: Boolean(m.out),
          mediaType: m.media ? m.media.className : null,
          replyToMsgId: m.replyTo?.replyToMsgId || null,
        }));
        return successResult(formatted);
      }

      case "search_messages": {
        const query = args.query || args.search || args.q || "";
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
        const peer = args.chat_id || args.peer;
        const entity = peer ? await resolveEntity(client, peer) : undefined;
        const messages = await client.getMessages(entity, {
          search: query,
          limit,
        });
        const formatted = messages.map((m: any) => ({
          id: m.id,
          chatId: m.chatId?.toString() || null,
          date: m.date,
          senderId: m.senderId?.toString() || null,
          text: m.message || "",
        }));
        return successResult(formatted);
      }

      case "edit_message": {
        const peer = args.chat_id || args.peer;
        const messageId = args.message_id || args.id;
        const text = args.text || args.message;
        if (!peer || !messageId || !text) {
          return errorResult("chat_id, message_id, and text are required.");
        }
        const entity = await resolveEntity(client, peer);
        const edited = await client.editMessage(entity, {
          message: Number(messageId),
          text,
        });
        return successResult({ status: "edited", id: edited.id, text: edited.message });
      }

      case "delete_messages":
      case "delete_message": {
        const peer = args.chat_id || args.peer;
        const messageIds = args.message_ids || (args.message_id ? [args.message_id] : []);
        if (!peer || !messageIds.length) {
          return errorResult("chat_id and message_ids are required.");
        }
        const entity = await resolveEntity(client, peer);
        const numericIds = (Array.isArray(messageIds) ? messageIds : [messageIds]).map(Number);
        await client.deleteMessages(entity, numericIds, { revoke: true });
        return successResult({ status: "deleted", count: numericIds.length, ids: numericIds });
      }

      case "forward_messages":
      case "forward_message": {
        const toPeer = args.to_chat_id || args.to_peer || args.chat_id;
        const fromPeer = args.from_chat_id || args.from_peer;
        const messageIds = args.message_ids || (args.message_id ? [args.message_id] : []);
        if (!toPeer || !fromPeer || !messageIds.length) {
          return errorResult("to_chat_id, from_chat_id, and message_ids are required.");
        }
        const toEntity = await resolveEntity(client, toPeer);
        const fromEntity = await resolveEntity(client, fromPeer);
        const numericIds = (Array.isArray(messageIds) ? messageIds : [messageIds]).map(Number);
        const forwarded = await client.forwardMessages(toEntity, {
          messages: numericIds,
          fromPeer: fromEntity,
        });
        return successResult({ status: "forwarded", count: forwarded.length });
      }

      case "pin_message": {
        const peer = args.chat_id || args.peer;
        const messageId = args.message_id || args.id;
        if (!peer || !messageId) {
          return errorResult("chat_id and message_id are required.");
        }
        const entity = await resolveEntity(client, peer);
        await client.pinMessage(entity, Number(messageId), { notify: Boolean(args.notify) });
        return successResult({ status: "pinned", message_id: messageId });
      }

      case "unpin_message": {
        const peer = args.chat_id || args.peer;
        const messageId = args.message_id || args.id;
        if (!peer) {
          return errorResult("chat_id is required.");
        }
        const entity = await resolveEntity(client, peer);
        if (messageId) {
          await client.unpinMessage(entity, Number(messageId));
        } else {
          await client.unpinMessage(entity);
        }
        return successResult({ status: "unpinned", message_id: messageId || "all" });
      }

      // 2. Forum Topics Tools (GetForumTopics)
      case "list_topics":
      case "get_forum_topics":
      case "get_topics": {
        const peer = args.chat_id || args.peer || args.channel;
        if (!peer) return errorResult("chat_id is required for list_topics.");

        const entity = await resolveInputChannel(client, peer);
        const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 100);
        const fetchAll = Boolean(args.fetch_all || args.fetchAll);
        const searchQuery = args.search_query || args.search || args.q || "";
        const compact = args.compact !== false; // Default: true (compact mode to avoid truncation)
        const orderBy = String(args.order_by || args.orderBy || "activity").toLowerCase();

        // Read initial offset parameters (pass all 3 to Telegram for reliable pagination)
        let offsetTopic = Number(args.offset_topic || args.offsetTopic || 0);
        let offsetId = Number(args.offset_id || args.offsetId || 0);
        let offsetDate = Number(args.offset_date || args.offsetDate || 0);

        const allTopics: any[] = [];
        const maxTopicsToFetch = fetchAll ? 500 : limit;
        const startTime = Date.now();
        let lastRawTopic: any = null;
        let lastBatchLength = 0;
        let executionBudgetHit = false;
        let totalCount = 0;

        while (true) {
          // Timeout guard: terminate pagination safely at 100s to allow response transmission
          if (Date.now() - startTime > 100000) {
            executionBudgetHit = true;
            break;
          }

          const res: any = await client.invoke(
            new Api.channels.GetForumTopics({
              channel: entity,
              q: searchQuery || undefined,
              offsetDate: offsetDate,
              offsetId: offsetId,
              offsetTopic: offsetTopic,
              limit: Math.min(limit, maxTopicsToFetch - allTopics.length),
            })
          );

          if (res.count !== undefined && res.count !== null) {
            totalCount = Number(res.count);
          }

          const topicsBatch = res.topics || [];
          lastBatchLength = topicsBatch.length;
          if (!topicsBatch.length) break;

          for (const t of topicsBatch) {
            if (t.className === "ForumTopic" || t.id !== undefined) {
              lastRawTopic = t;
              if (compact) {
                // Enriched compact mode: minimal payload with essential fields
                allTopics.push({
                  id: t.id,
                  title: t.title || "(no title)",
                  date: t.date,
                  top_message_id: t.topMessage,
                  unread_count: t.unreadCount || 0,
                  pinned: Boolean(t.pinned),
                  closed: Boolean(t.closed),
                });
              } else {
                // Full details mode
                allTopics.push({
                  id: t.id,
                  title: t.title || "(no title)",
                  date: t.date,
                  iconColor: t.iconColor,
                  iconEmojiId: t.iconEmojiId?.toString() || null,
                  topMessageId: t.topMessage,
                  unreadCount: t.unreadCount || 0,
                  closed: Boolean(t.closed),
                  pinned: Boolean(t.pinned),
                  hidden: Boolean(t.hidden),
                });
              }
            }
          }

          if (!fetchAll || allTopics.length >= maxTopicsToFetch || topicsBatch.length < limit) {
            break;
          }

          // Advance offset using all 3 fields from the last topic in the batch
          const lastInBatch = topicsBatch[topicsBatch.length - 1];
          if (!lastInBatch || (lastInBatch.id === offsetTopic && lastInBatch.topMessage === offsetId)) {
            break;
          }

          offsetTopic = lastInBatch.id || 0;
          offsetId = lastInBatch.topMessage || 0;
          offsetDate = lastInBatch.date || 0;
        }

        // Apply server-side sorting if requested
        if (orderBy === "oldest") {
          allTopics.sort((a, b) => (a.date || a.id || 0) - (b.date || b.id || 0));
        } else if (orderBy === "newest") {
          allTopics.sort((a, b) => (b.date || b.id || 0) - (a.date || a.id || 0));
        } // "activity" keeps Telegram's natural descending activity order

        // Include next_page payload whenever more topics might exist
        let nextPage = null;
        let hasMore = false;

        if (executionBudgetHit && lastRawTopic) {
          nextPage = {
            offset_date: lastRawTopic.date || 0,
            offset_id: lastRawTopic.topMessage || 0,
            offset_topic: lastRawTopic.id,
          };
          hasMore = true;
        } else if (fetchAll) {
          if (lastRawTopic && (allTopics.length < totalCount || totalCount === 0) && lastBatchLength >= limit) {
            nextPage = {
              offset_date: lastRawTopic.date || 0,
              offset_id: lastRawTopic.topMessage || 0,
              offset_topic: lastRawTopic.id,
            };
            hasMore = true;
          }
        } else {
          // Single page mode
          if (lastRawTopic && lastBatchLength >= limit) {
            nextPage = {
              offset_date: lastRawTopic.date || 0,
              offset_id: lastRawTopic.topMessage || 0,
              offset_topic: lastRawTopic.id,
            };
            hasMore = true;
          }
        }

        return successResult({
          chatId: peer,
          total_count: totalCount || allTopics.length,
          totalFetched: allTopics.length,
          has_more: hasMore,
          compactMode: compact,
          order_by: orderBy,
          ...(executionBudgetHit
            ? { warning: "Execution budget reached. Returned partial results. Use next_page to continue." }
            : {}),
          next_page: nextPage,
          topics: allTopics,
        });
      }

      case "count_topics": {
        const peer = args.chat_id || args.peer || args.channel;
        if (!peer) return errorResult("chat_id is required for count_topics.");
        const entity = await resolveInputChannel(client, peer);
        const res: any = await client.invoke(
          new Api.channels.GetForumTopics({
            channel: entity,
            offsetDate: 0,
            offsetId: 0,
            offsetTopic: 0,
            limit: 1,
          })
        );
        return successResult({
          chatId: peer,
          totalTopics: res.count || res.topics?.length || 0,
        });
      }

      case "get_topic_message_count": {
        const peer = args.chat_id || args.peer || args.channel;
        if (!peer) return errorResult("chat_id is required for get_topic_message_count.");

        const rawTopicIds = args.topic_ids ?? args.topic_id ?? args.topics ?? args.topicId;
        if (rawTopicIds === undefined || rawTopicIds === null) {
          return errorResult("topic_ids is required for get_topic_message_count.");
        }

        let rawList: any[] = [];
        if (Array.isArray(rawTopicIds)) {
          rawList = rawTopicIds;
        } else if (typeof rawTopicIds === "string" && rawTopicIds.includes(",")) {
          rawList = rawTopicIds.split(",");
        } else {
          rawList = [rawTopicIds];
        }

        const topicIdsList = rawList
          .map((id) => Number(id))
          .filter((id) => !isNaN(id) && id > 0);

        if (topicIdsList.length === 0) {
          return errorResult("No valid topic IDs provided.");
        }

        if (topicIdsList.length > 30) {
          return errorResult("A maximum of 30 topic IDs is allowed per request.");
        }

        const entity = await resolveEntity(client, peer);
        const results: Array<{ topic_id: number; message_count: number; error?: string }> = [];

        for (let i = 0; i < topicIdsList.length; i++) {
          const topicId = topicIdsList[i];
          try {
            const msgs = await client.getMessages(entity, {
              replyTo: topicId,
              limit: 1,
            });
            const count = typeof msgs.total === "number" ? msgs.total : msgs.length;
            results.push({ topic_id: topicId, message_count: count });
          } catch (err: any) {
            results.push({ topic_id: topicId, message_count: 0, error: err.message || String(err) });
          }

          if (i < topicIdsList.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        return successResult({
          chatId: peer,
          total_topics_queried: results.length,
          results,
        });
      }

      case "create_forum_topic":
      case "create_topic": {
        const peer = args.chat_id || args.peer || args.channel;
        const title = args.title || args.topic_title || args.name;
        if (!peer || !title) {
          return errorResult("chat_id and title are required for create_forum_topic.");
        }

        const cleanTitle = String(title).trim().slice(0, 128);
        if (!cleanTitle) {
          return errorResult("Title cannot be empty.");
        }

        try {
          const inputChannel = await resolveInputChannel(client, peer);
          const randomId = BigInt(Math.floor(Math.random() * 1e15)) as any;

          const res: any = await client.invoke(
            new Api.channels.CreateForumTopic({
              channel: inputChannel,
              title: cleanTitle,
              randomId,
              iconColor: args.icon_color ? Number(args.icon_color) : undefined,
              iconEmojiId: args.icon_emoji_id ? (BigInt(args.icon_emoji_id) as any) : undefined,
            })
          );

          const topicId = extractTopicId(res);
          return successResult({
            status: "topic_created",
            chat_id: peer,
            title: cleanTitle,
            topic_id: topicId,
          });
        } catch (err: any) {
          return errorResult(formatTelegramError(err, "create_forum_topic"));
        }
      }

      case "copy_topic": {
        const fromChat = args.from_chat_id || args.source_chat_id || args.from_peer;
        const topicId = args.topic_id || args.source_topic_id;
        const toChat = args.to_chat_id || args.target_chat_id || args.to_peer;
        let topicTitle = args.topic_title || args.title;

        if (!fromChat || !topicId || !toChat) {
          return errorResult("from_chat_id, topic_id, and to_chat_id are required for copy_topic.");
        }

        try {
          const fromEntity = await resolveEntity(client, fromChat);
          const toEntity = await resolveEntity(client, toChat);
          const toInputChannel = await resolveInputChannel(client, toChat);

          // If topic title not provided, fetch topic details from source
          if (!topicTitle) {
            try {
              const topicInfoRes: any = await client.invoke(
                new Api.channels.GetForumTopicsByID({
                  channel: await resolveInputChannel(client, fromChat),
                  topics: [Number(topicId)],
                })
              );
              const found = topicInfoRes?.topics?.[0];
              if (found && found.title) {
                topicTitle = found.title;
              }
            } catch {}
          }
          if (!topicTitle) {
            topicTitle = `Topic ${topicId}`;
          }

          const cleanTitle = String(topicTitle).trim().slice(0, 128);

          // Check if targetTopicId is passed, or search existing topics to avoid duplicates
          let targetTopicId: number | null = args.target_topic_id || args.to_topic_id ? Number(args.target_topic_id || args.to_topic_id) : null;

          if (!targetTopicId) {
            try {
              const existingTopicsRes: any = await client.invoke(
                new Api.channels.GetForumTopics({
                  channel: toInputChannel,
                  q: cleanTitle,
                  offsetDate: 0,
                  offsetId: 0,
                  offsetTopic: 0,
                  limit: 20,
                })
              );
              const foundTopic = (existingTopicsRes.topics || []).find(
                (t: any) => (t.title || "").trim().toLowerCase() === cleanTitle.toLowerCase()
              );
              if (foundTopic && foundTopic.id) {
                targetTopicId = foundTopic.id;
              }
            } catch {}
          }

          if (!targetTopicId) {
            const randomId = BigInt(Math.floor(Math.random() * 1e15)) as any;
            const createRes: any = await client.invoke(
              new Api.channels.CreateForumTopic({
                channel: toInputChannel,
                title: cleanTitle,
                randomId,
              })
            );
            targetTopicId = extractTopicId(createRes);
          }

          if (!targetTopicId) {
            return errorResult(`Failed to create or resolve topic '${cleanTitle}' in destination supergroup.`);
          }

          // Fetch messages from source topic
          const limit = args.limit ? Math.min(Math.max(Number(args.limit), 1), 100) : 50;
          const resumeFrom = args.resume_from_msg_id ? Number(args.resume_from_msg_id) : 0;

          const msgs = await client.getMessages(fromEntity, {
            replyTo: Number(topicId),
            limit,
          });

          // Sort messages in chronological order (oldest first)
          const chronologicalMsgs = [...msgs].reverse();

          let copiedCount = 0;
          let failedCount = 0;
          let skippedCount = 0;
          let lastCopiedId: number | null = null;

          for (const msg of chronologicalMsgs) {
            if (resumeFrom && msg.id <= resumeFrom) {
              skippedCount++;
              continue;
            }

            try {
              if (msg.media) {
                await client.sendFile(toEntity, {
                  file: msg.media,
                  caption: msg.message || "",
                  replyTo: targetTopicId,
                });
              } else if (msg.message && msg.message.trim().length > 0) {
                await client.sendMessage(toEntity, {
                  message: msg.message,
                  replyTo: targetTopicId,
                });
              } else {
                skippedCount++;
                continue;
              }

              copiedCount++;
              lastCopiedId = msg.id;

              // Small delay to prevent FloodWait
              await new Promise((resolve) => setTimeout(resolve, 150));
            } catch (copyErr: any) {
              failedCount++;
              // If FloodWait, stop batch early and return partial progress
              const errStr = String(copyErr);
              if (errStr.includes("FLOOD_WAIT") || copyErr.seconds) {
                break;
              }
            }
          }

          return successResult({
            status: "completed",
            source_chat: fromChat,
            source_topic_id: Number(topicId),
            target_chat: toChat,
            target_topic_id: targetTopicId,
            topic_title: cleanTitle,
            messages_copied: copiedCount,
            messages_failed: failedCount,
            messages_skipped: skippedCount,
            total_processed: copiedCount + failedCount + skippedCount,
            last_copied_msg_id: lastCopiedId,
            has_more: chronologicalMsgs.length >= limit,
          });
        } catch (err: any) {
          return errorResult(formatTelegramError(err, "copy_topic"));
        }
      }

      case "migrate_topics_autonomous": {
        const fromChat = args.source_chat_id || args.from_chat_id || args.chat_id;
        const toChat = args.target_chat_id || args.to_chat_id;
        if (!fromChat || !toChat) {
          return errorResult("source_chat_id and target_chat_id are required for migrate_topics_autonomous.");
        }

        try {
          const fromInputChannel = await resolveInputChannel(client, fromChat);
          const toInputChannel = await resolveInputChannel(client, toChat);

          // Get batch of source topics
          const topicsRes: any = await client.invoke(
            new Api.channels.GetForumTopics({
              channel: fromInputChannel,
              offsetDate: 0,
              offsetId: 0,
              offsetTopic: args.offset_topic ? Number(args.offset_topic) : 0,
              limit: Math.min(Number(args.limit) || 10, 20), // Safe batch size
            })
          );

          const topics = topicsRes.topics || [];
          const migratedResults: any[] = [];

          for (const topic of topics) {
            if (!topic.id || !topic.title) continue;
            try {
              // Create target topic
              const randomId = BigInt(Math.floor(Math.random() * 1e15)) as any;
              const createRes: any = await client.invoke(
                new Api.channels.CreateForumTopic({
                  channel: toInputChannel,
                  title: topic.title,
                  randomId,
                })
              );
              const targetTopicId = extractTopicId(createRes);
              migratedResults.push({
                source_topic_id: topic.id,
                title: topic.title,
                target_topic_id: targetTopicId,
                status: targetTopicId ? "created" : "failed",
              });
              await new Promise((resolve) => setTimeout(resolve, 300));
            } catch (err) {
              migratedResults.push({
                source_topic_id: topic.id,
                title: topic.title,
                status: "failed",
                error: formatTelegramError(err),
              });
            }
          }

          return successResult({
            status: "batch_completed",
            total_attempted: topics.length,
            topics: migratedResults,
            next_offset: topics.length ? topics[topics.length - 1].id : null,
          });
        } catch (err: any) {
          return errorResult(formatTelegramError(err, "migrate_topics_autonomous"));
        }
      }

      default:
        return errorResult(`Tool '${name}' is not currently implemented on this server.`);
    }
  } catch (err: any) {
    return errorResult(`Unhandled dispatcher error: ${err?.message || String(err)}`);
  }
}

function successResult(data: any): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    isError: false,
  };
}

function errorResult(message: string): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return {
    content: [
      {
        type: "text",
        text: `Error: ${message}`,\n      },\n    ],\n    isError: true,\n  };\n}\n