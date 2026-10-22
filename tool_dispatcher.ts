import { Api, TelegramClient } from "telegram";

/**
 * Resolves any peer (User, Chat, Channel, "me") using cached dialogs first,
 * guaranteeing accurate channelId and accessHash resolution.
 */
async function resolvePeer(client: TelegramClient, peer: string | number): Promise<any> {
  const str = String(peer).trim();
  if (str === "me" || str === "self" || str === "this") {
    return await client.getInputEntity("me");
  }

  const bare = str.replace(/^-100/, "").replace(/^-/, "");
  try {
    const dialogs = await client.getDialogs({ limit: 100 });
    for (const d of dialogs) {
      const dStr = String(d.id || "");
      const dBare = dStr.replace(/^-100/, "").replace(/^-/, "");
      const title = (d.title || d.name || "").trim().toLowerCase();

      if (dStr === str || dBare === bare || title === str.toLowerCase()) {
        if (d.inputEntity) return d.inputEntity;
        if (d.entity) return await client.getInputEntity(d.entity);
      }
    }
  } catch {}

  let target: any = peer;
  if (/^-?\d+$/.test(str)) {
    target = Number(str);
  }
  const ent = await client.getEntity(target);
  return await client.getInputEntity(ent);
}

/**
 * Resolves an entity specifically as a Channel/Supergroup InputChannel.
 */
async function resolveChannel(client: TelegramClient, chatId: string | number): Promise<any> {
  const str = String(chatId).trim();
  const bare = str.replace(/^-100/, "").replace(/^-/, "");

  try {
    const dialogs = await client.getDialogs({ limit: 100 });
    for (const d of dialogs) {
      const dStr = String(d.id || "");
      const dBare = dStr.replace(/^-100/, "").replace(/^-/, "");
      const title = (d.title || d.name || "").trim().toLowerCase();

      if (dStr === str || dBare === bare || title === str.toLowerCase()) {
        if (d.inputEntity && (d.inputEntity.className === "InputPeerChannel" || d.inputEntity.className === "InputChannel")) {
          return new Api.InputChannel({
            channelId: d.inputEntity.channelId,
            accessHash: d.inputEntity.accessHash,
          });
        }
        if (d.entity && (d.entity.className === "Channel" || (d.entity as any).megagroup || (d.entity as any).broadcast)) {
          return new Api.InputChannel({
            channelId: d.entity.id,
            accessHash: (d.entity as any).accessHash || (BigInt(0) as any),
          });
        }
      }
    }
  } catch {}

  let target: any = chatId;
  if (/^-?\d+$/.test(str)) {
    target = Number(str);
  }
  const entity: any = await client.getEntity(target);
  if (!entity || (!entity.broadcast && !entity.megagroup && entity.className !== "Channel")) {
    throw new Error(`Resolved entity for ${chatId} (${entity?.className}) is not a valid Channel/Supergroup.`);
  }
  return new Api.InputChannel({
    channelId: entity.id,
    accessHash: entity.accessHash || (BigInt(0) as any),
  });
}

export async function dispatchUserbotTool(
  name: string,
  args: any,
  client: TelegramClient
): Promise<any> {
  switch (name) {
    case "list_dialogs": {
      const limit = Math.min(Number(args.limit) || 20, 100);
      const dialogs: any = await client.getDialogs({ limit });
      return dialogs.map((d: any) => ({
        id: d.id ? String(d.id) : null,
        title: d.title || d.name || "",
        isChannel: Boolean(d.isChannel),
        isGroup: Boolean(d.isGroup),
        isUser: Boolean(d.isUser),
        unreadCount: d.unreadCount || 0,
      }));
    }

    case "read_chat_history": {
      const peer = await resolvePeer(client, args.chat_id);
      const limit = Math.min(Number(args.limit) || 20, 100);
      const messages: any = await client.getMessages(peer, { limit });
      return messages.map((m: any) => ({
        id: m.id,
        date: m.date,
        senderId: m.senderId ? String(m.senderId) : null,
        text: m.text || m.message || "",
        out: m.out || false,
        mediaType: m.media?.className || null,
        replyToMsgId: m.replyTo?.replyToMsgId || null,
      }));
    }

    case "send_user_message": {
      const peer = await resolvePeer(client, args.chat_id);
      const text = args.text || args.message;
      const sent: any = await client.sendMessage(peer, { message: text });
      return { success: true, messageId: sent.id };
    }

    case "list_topics": {
      const channel = await resolveChannel(client, args.chat_id);
      const limit = Math.min(Number(args.limit) || 100, 100);
      const res: any = await client.invoke(
        new Api.channels.GetForumTopics({
          channel,
          q: args.search_query || undefined,
          offsetDate: Number(args.offset_date) || 0,
          offsetId: Number(args.offset_id) || 0,
          offsetTopic: Number(args.offset_topic) || 0,
          limit,
        })
      );
      const topics = (res.topics || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        date: t.date,
        top_message_id: t.topMessage,
        unread_count: t.unreadCount,
        unread_mentions_count: t.unreadMentionsCount,
        closed: Boolean(t.closed),
        pinned: Boolean(t.pinned),
        hidden: Boolean(t.hidden),
        icon_color: t.iconColor,
        icon_emoji_id: t.iconEmojiId ? String(t.iconEmojiId) : null,
      }));
      return {
        total_topics: res.count ?? topics.length,
        topics,
        order_by: args.order_by || "activity",
        next_page: {
          offset_date: res.offsetDate || 0,
          offset_id: res.offsetId || 0,
          offset_topic: res.offsetTopic || 0,
        },
      };
    }

    case "count_topics": {
      const channel = await resolveChannel(client, args.chat_id);
      const res: any = await client.invoke(
        new Api.channels.GetForumTopics({
          channel,
          offsetDate: 0,
          offsetId: 0,
          offsetTopic: 0,
          limit: 1,
        })
      );
      return {
        chat_id: args.chat_id,
        count: res.count ?? res.topics?.length ?? 0,
      };
    }

    case "create_forum_topic": {
      const channel = await resolveChannel(client, args.chat_id);
      const res: any = await client.invoke(
        new Api.channels.CreateForumTopic({
          channel,
          title: String(args.title).trim().slice(0, 128),
          iconColor: args.icon_color ? Number(args.icon_color) : undefined,
          iconEmojiId: args.icon_emoji_id ? (args.icon_emoji_id as any) : undefined,
        })
      );
      let topicId = 0;
      if (res.updates) {
        for (const u of res.updates) {
          if (u.message?.id) {
            topicId = u.message.id;
            break;
          }
        }
      }
      return { success: true, topic_id: topicId, title: args.title };
    }

    case "edit_forum_topic": {
      const channel = await resolveChannel(client, args.chat_id);
      const topicId = Number(args.topic_id);
      await client.invoke(
        new Api.channels.EditForumTopic({
          channel,
          topicId,
          title: args.title !== undefined && args.title !== null ? String(args.title) : undefined,
          iconEmojiId: args.icon_emoji_id ? (args.icon_emoji_id as any) : undefined,
          closed: typeof args.closed === "boolean" ? args.closed : undefined,
          hidden: typeof args.hidden === "boolean" ? args.hidden : undefined,
        })
      );
      return { success: true, topic_id: topicId, updated: true };
    }

    case "delete_topic": {
      const channel = await resolveChannel(client, args.chat_id);
      const topicId = Number(args.topic_id);
      await client.invoke(
        new Api.channels.DeleteTopicHistory({
          channel,
          topMsgId: topicId,
        })
      );
      return { success: true, topic_id: topicId, deleted: true };
    }

    case "close_forum_topic": {
      const channel = await resolveChannel(client, args.chat_id);
      const topicId = Number(args.topic_id);
      await client.invoke(
        new Api.channels.EditForumTopic({
          channel,
          topicId,
          closed: true,
        })
      );
      return { success: true, topic_id: topicId, closed: true };
    }

    case "reopen_forum_topic": {
      const channel = await resolveChannel(client, args.chat_id);
      const topicId = Number(args.topic_id);
      await client.invoke(
        new Api.channels.EditForumTopic({
          channel,
          topicId,
          closed: false,
        })
      );
      return { success: true, topic_id: topicId, closed: false };
    }

    case "hide_forum_topic": {
      const channel = await resolveChannel(client, args.chat_id);
      const topicId = Number(args.topic_id);
      await client.invoke(
        new Api.channels.EditForumTopic({
          channel,
          topicId,
          hidden: true,
        })
      );
      return { success: true, topic_id: topicId, hidden: true };
    }

    case "unhide_forum_topic": {
      const channel = await resolveChannel(client, args.chat_id);
      const topicId = Number(args.topic_id);
      await client.invoke(
        new Api.channels.EditForumTopic({
          channel,
          topicId,
          hidden: false,
        })
      );
      return { success: true, topic_id: topicId, hidden: false };
    }

    case "get_topic_message_count": {
      const channel = await resolveChannel(client, args.chat_id);
      const topicIds: number[] = Array.isArray(args.topic_ids) ? args.topic_ids : [Number(args.topic_ids)];
      const results: any[] = [];
      for (const tid of topicIds) {
        try {
          const res: any = await client.invoke(
            new Api.messages.GetReplies({
              peer: channel,
              msgId: Number(tid),
              offsetId: 0,
              offsetDate: 0,
              addOffset: 0,
              limit: 1,
              maxId: 0,
              minId: 0,
              hash: 0 as any,
            })
          );
          results.push({
            topic_id: tid,
            message_count: res.count ?? 0,
          });
        } catch (err: any) {
          results.push({
            topic_id: tid,
            message_count: 0,
            error: err?.message || String(err),
          });
        }
      }
      return {
        chatId: args.chat_id,
        total_topics_queried: topicIds.length,
        results,
      };
    }

    case "copy_topic": {
      const fromChannel = await resolveChannel(client, args.from_chat_id);
      const toChannel = await resolveChannel(client, args.to_chat_id);
      const sourceTopicId = Number(args.topic_id);
      const limit = Math.min(Number(args.limit) || 50, 100);
      const resumeFrom = Number(args.resume_from_msg_id) || 0;

      const history: any = await client.invoke(
        new Api.messages.GetReplies({
          peer: fromChannel,
          msgId: sourceTopicId,
          offsetId: resumeFrom,
          offsetDate: 0,
          addOffset: 0,
          limit,
          maxId: 0,
          minId: 0,
          hash: 0 as any,
        })
      );
      const msgs = (history.messages || []).filter((m: any) => m.id && m.id !== sourceTopicId);
      msgs.sort((a: any, b: any) => a.id - b.id);

      let targetTopicId = args.target_topic_id ? Number(args.target_topic_id) : 0;
      if (!targetTopicId) {
        const title = args.topic_title || `Migrated Topic ${sourceTopicId}`;
        const newTopic: any = await client.invoke(
          new Api.channels.CreateForumTopic({
            channel: toChannel,
            title,
          })
        );
        if (newTopic.updates) {
          for (const u of newTopic.updates) {
            if (u.message?.id) {
              targetTopicId = u.message.id;
              break;
            }
          }
        }
      }

      const copiedIds: number[] = [];
      const msgIds = msgs.map((m: any) => m.id);
      if (msgIds.length > 0 && targetTopicId) {
        await client.invoke(
          new Api.messages.ForwardMessages({
            fromPeer: fromChannel,
            id: msgIds,
            toPeer: toChannel,
            topMsgId: targetTopicId,
          })
        );
        copiedIds.push(...msgIds);
      }

      return {
        success: true,
        source_topic_id: sourceTopicId,
        target_topic_id: targetTopicId,
        copied_count: copiedIds.length,
        copied_ids: copiedIds,
      };
    }

    case "search_messages": {
      const peer = args.chat_id ? await resolvePeer(client, args.chat_id) : undefined;
      const query = args.query || "";
      const limit = Math.min(Number(args.limit) || 20, 100);
      const messages: any = await client.getMessages(peer, {
        search: query,
        limit,
      });
      return messages.map((m: any) => ({
        id: m.id,
        date: m.date,
        senderId: m.senderId ? String(m.senderId) : null,
        text: m.text || m.message || "",
        out: m.out || false,
        chatId: m.chatId ? String(m.chatId) : null,
      }));
    }

    default:
      throw new Error(`Tool '${name}' is not currently implemented on this server.`);
  }
}
