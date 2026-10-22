import { TelegramClient, Api } from "telegram";
import {
  successResult,
  errorResult,
  sanitizeTopicTitle,
  normalizeForumTitle,
  resolveEntity,
  resolveInputChannel,
  extractTopicId,
  fetchAllForumTopics
} from "./dispatcher_helpers";

export async function handleChatsMessagesTool(
  name: string,
  args: Record<string, any>,
  client: TelegramClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean } | null> {
  switch (name) {
    case "list_chats": {
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
      const dialogs = await client.getDialogs({ limit: Math.min(limit * 2, 100), archived: args.archived !== undefined ? Boolean(args.archived) : undefined });
      const results: any[] = [];
      for (const d of dialogs) {
        if (results.length >= limit) break;
        if (args.unread_only && (d.unreadCount || 0) <= 0) continue;
        results.push({ id: d.id?.toString() || null, title: d.title || d.name || "Unknown", unreadCount: d.unreadCount || 0, date: d.date || null });
      }
      return successResult({ count: results.length, chats: results });
    }

    case "search_public_chats": {
      const query = String(args.query || "").trim();
      if (!query) return errorResult("query is required.");
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const res: any = await client.invoke(new Api.contacts.Search({ q: query, limit }));
      const chats = (res.chats || []).map((c: any) => ({ id: c.id?.toString(), title: c.title || "Unknown", username: c.username || null }));
      return successResult({ query, chats });
    }

    case "resolve_username": {
      const rawUsername = String(args.username || "").trim().replace(/^@/, "");
      if (!rawUsername) return errorResult("username is required.");
      const res: any = await client.invoke(new Api.contacts.ResolveUsername({ username: rawUsername }));
      const chat = res.chats?.[0];
      const user = res.users?.[0];
      if (chat) return successResult({ type: "channel", id: `-100${chat.id?.toString()}`, title: chat.title || "", username: chat.username || rawUsername });
      if (user) return successResult({ type: "user", id: user.id?.toString(), first_name: user.firstName || "", username: user.username || rawUsername });
      return errorResult(`Could not resolve username @${rawUsername}.`);
    }

    case "get_full_chat": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      try {
        const inputChannel = await resolveInputChannel(client, peer);
        const fullRes: any = await client.invoke(new Api.channels.GetFullChannel({ channel: inputChannel }));
        return successResult({ id: String(peer), about: fullRes.fullChat?.about || "", participants_count: fullRes.fullChat?.participantsCount || null });
      } catch {
        const entity: any = await resolveEntity(client, peer);
        return successResult({ id: entity.id?.toString(), title: entity.title || entity.firstName || "" });
      }
    }

    case "mute_chat": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.account.UpdateNotifySettings({ peer: new Api.InputNotifyPeer({ peer: entity }), settings: new Api.InputPeerNotifySettings({ muteUntil: 2147483647 }) }));
      return successResult({ status: "muted", chat_id: peer });
    }

    case "unmute_chat": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.account.UpdateNotifySettings({ peer: new Api.InputNotifyPeer({ peer: entity }), settings: new Api.InputPeerNotifySettings({ muteUntil: 0 }) }));
      return successResult({ status: "unmuted", chat_id: peer });
    }

    case "archive_chat": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.folders.EditPeerFolders({ folderPeers: [new Api.InputFolderPeer({ peer: entity, folderId: 1 })] }));
      return successResult({ status: "archived", chat_id: peer, folder_id: 1 });
    }

    case "unarchive_chat": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.folders.EditPeerFolders({ folderPeers: [new Api.InputFolderPeer({ peer: entity, folderId: 0 })] }));
      return successResult({ status: "unarchived", chat_id: peer, folder_id: 0 });
    }

    case "get_common_chats": {
      const peer = args.user_id || args.contact_id;
      if (!peer) return errorResult("user_id is required.");
      const entity = await resolveEntity(client, peer);
      const res: any = await client.invoke(new Api.messages.GetCommonChats({ userId: entity, maxId: BigInt(args.max_id || 0) as any, limit: 100 }));
      const chats = (res.chats || []).map((c: any) => ({ id: c.id?.toString(), title: c.title || "Unknown" }));
      return successResult({ user_id: peer, count: chats.length, chats });
    }

    case "get_message_read_by": {
      const peer = args.chat_id || args.peer;
      const msgId = Number(args.message_id);
      if (!peer || !msgId) return errorResult("chat_id and message_id are required.");
      const entity = await resolveEntity(client, peer);
      const res: any = await client.invoke(new Api.messages.GetMessageReadParticipants({ peer: entity, msgId }));
      const readers = (Array.isArray(res) ? res : []).map((r: any) => ({ user_id: r.userId?.toString(), read_date: r.date || null }));
      return successResult({ chat_id: peer, message_id: msgId, count: readers.length, read_by: readers });
    }

    case "get_message_link": {
      const peer = args.chat_id || args.peer;
      const msgId = Number(args.message_id);
      if (!peer || !msgId) return errorResult("chat_id and message_id are required.");
      try {
        const inputChannel = await resolveInputChannel(client, peer);
        const res: any = await client.invoke(new Api.channels.ExportMessageLink({ channel: inputChannel, id: msgId, thread: Boolean(args.thread) }));
        return successResult({ chat_id: peer, message_id: msgId, link: res.link });
      } catch {
        const bareId = String(peer).replace(/^-100/, "");
        return successResult({ chat_id: peer, message_id: msgId, link: `https://t.me/c/${bareId}/${msgId}` });
      }
    }

    case "enable_forum_topics": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const inputChannel = await resolveInputChannel(client, peer);
      await client.invoke(new Api.channels.ToggleForum({ channel: inputChannel, enabled: true, tabs: args.tabs !== false }));
      return successResult({ status: "forum_enabled", chat_id: peer, tabs: args.tabs !== false });
    }

    case "find_or_create_topic": {
      const peer = args.chat_id || args.peer;
      const rawTitle = args.title || args.topic_title;
      if (!peer || !rawTitle) return errorResult("chat_id and title are required.");
      const cleanTitle = sanitizeTopicTitle(rawTitle);
      const targetNorm = normalizeForumTitle(cleanTitle);
      const inputChannel = await resolveInputChannel(client, peer);

      const existingTopics = await fetchAllForumTopics(client, inputChannel, 300, cleanTitle);
      const exactMatch = existingTopics.find((t: any) => normalizeForumTitle(t.title) === targetNorm);
      if (exactMatch) return successResult({ status: "found_existing", created: false, chat_id: peer, topic_id: exactMatch.id, title: exactMatch.title });

      const randomId = BigInt(Math.floor(Math.random() * 1e15)) as any;
      const createRes: any = await client.invoke(new Api.channels.CreateForumTopic({ channel: inputChannel, title: cleanTitle, randomId }));
      return successResult({ status: "created", created: true, chat_id: peer, topic_id: extractTopicId(createRes), title: cleanTitle });
    }

    case "delete_topic_by_title": {
      const peer = args.chat_id || args.peer;
      const title = args.title;
      if (!peer || !title) return errorResult("chat_id and title are required.");
      const targetNorm = normalizeForumTitle(title);
      const inputChannel = await resolveInputChannel(client, peer);
      const topics = await fetchAllForumTopics(client, inputChannel, 400, String(title));
      const matches = topics.filter((t: any) => normalizeForumTitle(t.title) === targetNorm).sort((a: any, b: any) => a.id - b.id);
      if (matches.length === 0) return successResult({ status: "no_matching_topics", chat_id: peer, title, deleted_count: 0 });

      const toDelete = args.keep_first !== false ? matches.slice(1) : matches;
      const deletedIds: number[] = [];
      for (const t of toDelete) {
        await client.invoke(new Api.channels.DeleteTopicHistory({ channel: inputChannel, topMsgId: Number(t.id) }));
        deletedIds.push(t.id);
      }
      return successResult({ status: "completed", chat_id: peer, title, deleted_count: deletedIds.length, deleted_topic_ids: deletedIds });
    }

    case "list_messages":
    case "get_history": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
      const msgs = await client.getMessages(entity, { limit, search: args.search_query || args.query || undefined, replyTo: args.topic_id ? Number(args.topic_id) : undefined });
      const filtered = msgs.map((m: any) => ({
        id: m.id, date: m.date, sender_id: m.senderId?.toString() || null, text: m.message || "", media_type: m.media ? m.media.className : null
      }));
      return successResult({ chat_id: peer, count: filtered.length, messages: filtered });
    }

    case "get_message_context": {
      const peer = args.chat_id || args.peer;
      const msgId = Number(args.message_id);
      if (!peer || !msgId) return errorResult("chat_id and message_id are required.");
      const entity = await resolveEntity(client, peer);
      const msgs = await client.getMessages(entity, { offsetId: msgId + 4, limit: 7 });
      const formatted = msgs.map((m: any) => ({ id: m.id, is_target: m.id === msgId, text: m.message || "", media_type: m.media ? m.media.className : null }));
      return successResult({ chat_id: peer, target_message_id: msgId, context: formatted });
    }

    case "search_global": {
      const query = String(args.query || "").trim();
      if (!query) return errorResult("query is required.");
      const res: any = await client.invoke(new Api.messages.SearchGlobal({ q: query, filter: new Api.InputMessagesFilterEmpty(), minDate: 0, maxDate: 0, offsetRate: 0, offsetPeer: new Api.InputPeerEmpty(), offsetId: 0, limit: 20 }));
      const messages = (res.messages || []).map((m: any) => ({ id: m.id, text: m.message || "" }));
      return successResult({ query, count: messages.length, messages });
    }

    case "reply_to_message": {
      const peer = args.chat_id || args.peer;
      const msgId = Number(args.message_id);
      const text = args.text || args.message;
      if (!peer || !msgId || !text) return errorResult("chat_id, message_id, and text are required.");
      const entity = await resolveEntity(client, peer);
      const sent = await client.sendMessage(entity, { message: String(text), replyTo: msgId });
      return successResult({ status: "replied", id: sent.id, reply_to_message_id: msgId, text: sent.message });
    }

    case "delete_messages_bulk": {
      const peer = args.chat_id || args.peer;
      const rawIds = Array.isArray(args.message_ids) ? args.message_ids : [args.message_ids];
      const ids = rawIds.map(Number).filter((n: number) => !isNaN(n) && n > 0);
      if (!peer || !ids.length) return errorResult("chat_id and message_ids are required.");
      const entity = await resolveEntity(client, peer);
      await client.deleteMessages(entity, ids, { revoke: args.revoke !== false });
      return successResult({ status: "deleted_bulk", chat_id: peer, deleted_count: ids.length, message_ids: ids });
    }

    case "delete_chat_history": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.DeleteHistory({ peer: entity, maxId: Number(args.max_id || 0), revoke: Boolean(args.revoke), justClear: !args.revoke }));
      return successResult({ status: "history_deleted", chat_id: peer, revoke: Boolean(args.revoke) });
    }

    case "copy_message": {
      const fromChat = args.from_chat_id;
      const toChat = args.to_chat_id;
      const msgId = Number(args.message_id);
      if (!fromChat || !toChat || !msgId) return errorResult("from_chat_id, message_id, and to_chat_id are required.");
      const fromEntity = await resolveEntity(client, fromChat);
      const toEntity = await resolveEntity(client, toChat);
      const msgs = await client.getMessages(fromEntity, { ids: [msgId] });
      const msg = msgs?.[0];
      if (!msg) return errorResult(`Message ${msgId} not found in ${fromChat}.`);
      const replyTo = args.reply_to ? Number(args.reply_to) : undefined;
      const sent = msg.media ? await client.sendFile(toEntity, { file: msg.media, caption: msg.message || "", replyTo }) : await client.sendMessage(toEntity, { message: msg.message || "", replyTo });
      return successResult({ status: "copied", source_chat_id: fromChat, source_message_id: msgId, target_chat_id: toChat, new_message_id: sent?.id || null });
    }

    case "copy_messages": {
      const fromChat = args.from_chat_id;
      const toChat = args.to_chat_id;
      const rawIds = Array.isArray(args.message_ids) ? args.message_ids : [args.message_ids];
      const msgIds = rawIds.map(Number).filter((n: number) => !isNaN(n) && n > 0);
      if (!fromChat || !toChat || !msgIds.length) return errorResult("from_chat_id, message_ids, and to_chat_id are required.");
      const fromEntity = await resolveEntity(client, fromChat);
      const toEntity = await resolveEntity(client, toChat);
      const msgs = await client.getMessages(fromEntity, { ids: msgIds });
      const replyTo = args.reply_to ? Number(args.reply_to) : undefined;
      const copiedIds: number[] = [];
      for (const msg of msgs) {
        if (!msg) continue;
        const sent = msg.media ? await client.sendFile(toEntity, { file: msg.media, caption: msg.message || "", replyTo }) : await client.sendMessage(toEntity, { message: msg.message, replyTo });
        if (sent?.id) copiedIds.push(sent.id);
        await new Promise((r) => setTimeout(r, 150));
      }
      return successResult({ status: "copied_batch", copied_count: copiedIds.length, new_message_ids: copiedIds });
    }

    case "send_scheduled_message": {
      const peer = args.chat_id || args.peer;
      const message = args.message || args.text;
      if (!peer || !message || !args.schedule_date) return errorResult("chat_id, message, and schedule_date are required.");
      const entity = await resolveEntity(client, peer);
      const scheduleTs = typeof args.schedule_date === "number" ? args.schedule_date : Math.floor(new Date(String(args.schedule_date)).getTime() / 1000);
      const sent = await client.sendMessage(entity, { message: String(message), schedule: scheduleTs });
      return successResult({ status: "scheduled", chat_id: peer, message_id: sent.id, schedule_date: scheduleTs });
    }

    case "get_scheduled_messages": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const res: any = await client.invoke(new Api.messages.GetScheduledHistory({ peer: entity, hash: BigInt(0) as any }));
      const scheduled = (res.messages || []).map((m: any) => ({ id: m.id, date: m.date, text: m.message || "" }));
      return successResult({ chat_id: peer, count: scheduled.length, scheduled_messages: scheduled });
    }

    case "delete_scheduled_message": {
      const peer = args.chat_id || args.peer;
      const rawIds = Array.isArray(args.message_ids) ? args.message_ids : [args.message_ids];
      const ids = rawIds.map(Number).filter((n: number) => !isNaN(n));
      if (!peer || !ids.length) return errorResult("chat_id and message_ids are required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.DeleteScheduledMessages({ peer: entity, id: ids }));
      return successResult({ status: "scheduled_deleted", chat_id: peer, deleted_ids: ids });
    }

    case "unpin_all_messages": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.UnpinAllMessages({ peer: entity }));
      return successResult({ status: "all_unpinned", chat_id: peer });
    }

    case "get_pinned_messages": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const msgs = await client.getMessages(entity, { filter: new Api.InputMessagesFilterPinned(), limit: 50 });
      const pinned = msgs.map((m: any) => ({ id: m.id, date: m.date, text: m.message || "", media_type: m.media ? m.media.className : null }));
      return successResult({ chat_id: peer, count: pinned.length, pinned_messages: pinned });
    }

    case "mark_as_read": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.markAsRead(entity);
      return successResult({ status: "marked_as_read", chat_id: peer });
    }

    case "create_poll": {
      const peer = args.chat_id || args.peer;
      const question = String(args.question || "");
      const options: string[] = Array.isArray(args.options) ? args.options.map(String) : [];
      if (!peer || !question || options.length < 2) return errorResult("chat_id, question, and at least 2 options are required.");
      const entity = await resolveEntity(client, peer);
      const pollAnswers = options.map((opt, idx) => new Api.PollAnswer({ text: new Api.TextWithEntities({ text: opt, entities: [] }), option: Buffer.from([idx]) }));
      const res: any = await client.invoke(
        new Api.messages.SendMedia({
          peer: entity,
          media: new Api.InputMediaPoll({
            poll: new Api.Poll({ id: BigInt(Math.floor(Math.random() * 1e15)) as any, question: new Api.TextWithEntities({ text: question, entities: [] }), answers: pollAnswers, multipleChoice: Boolean(args.multiple_choice), quiz: Boolean(args.quiz_mode), publicVoters: args.public_votes !== false })
          }),
          message: "",
          randomId: BigInt(Math.floor(Math.random() * 1e15)) as any,
        })
      );
      return successResult({ status: "poll_created", chat_id: peer, question, options_count: options.length, message_id: extractTopicId(res) });
    }

    case "send_reaction": {
      const peer = args.chat_id || args.peer;
      const msgId = Number(args.message_id);
      if (!peer || !msgId) return errorResult("chat_id and message_id are required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.SendReaction({ peer: entity, msgId, big: Boolean(args.big), reaction: [new Api.ReactionEmoji({ emoticon: String(args.emoji || "👍") })] }));
      return successResult({ status: "reaction_sent", chat_id: peer, message_id: msgId, emoji: args.emoji || "👍" });
    }

    case "remove_reaction": {
      const peer = args.chat_id || args.peer;
      const msgId = Number(args.message_id);
      if (!peer || !msgId) return errorResult("chat_id and message_id are required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.SendReaction({ peer: entity, msgId, reaction: [] }));
      return successResult({ status: "reaction_removed", chat_id: peer, message_id: msgId });
    }

    case "get_message_reactions": {
      const peer = args.chat_id || args.peer;
      const msgId = Number(args.message_id);
      if (!peer || !msgId) return errorResult("chat_id and message_id are required.");
      const entity = await resolveEntity(client, peer);
      const res: any = await client.invoke(new Api.messages.GetMessageReactionsList({ peer: entity, id: msgId, limit: Math.min(Number(args.limit || 50), 100) }));
      const reactions = (res.reactions || []).map((r: any) => ({ peer_id: r.peerId?.userId?.toString() || null, date: r.date, reaction: r.reaction?.emoticon || null }));
      return successResult({ chat_id: peer, message_id: msgId, count: reactions.length, reactions });
    }

    case "list_inline_buttons": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const msgs = args.message_id ? await client.getMessages(entity, { ids: [Number(args.message_id)] }) : await client.getMessages(entity, { limit: Number(args.limit || 10) });
      const buttonsList: any[] = [];
      for (const m of msgs) {
        if (!m || !m.replyMarkup?.rows) continue;
        let flatIdx = 0;
        m.replyMarkup.rows.forEach((row: any, rIdx: number) => {
          (row.buttons || []).forEach((btn: any, cIdx: number) => {
            buttonsList.push({ message_id: m.id, index: flatIdx++, row: rIdx, col: cIdx, text: btn.text || "", url: btn.url || null, has_callback: Boolean(btn.data) });
          });
        });
      }
      return successResult({ chat_id: peer, count: buttonsList.length, buttons: buttonsList });
    }

    case "press_inline_button": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const msgs = args.message_id ? await client.getMessages(entity, { ids: [Number(args.message_id)] }) : await client.getMessages(entity, { limit: 5 });
      const targetMsg = msgs.find((m: any) => m && m.buttonCount > 0);
      if (!targetMsg) return errorResult("No message with inline buttons found.");
      const clickRes = await targetMsg.click({ text: args.button_text ? String(args.button_text) : undefined, i: args.button_index !== undefined ? Number(args.button_index) : undefined });
      return successResult({ status: "button_pressed", chat_id: peer, message_id: targetMsg.id, result: clickRes?.message || "clicked" });
    }

    case "save_draft": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.SaveDraft({ peer: entity, message: String(args.message || ""), noWebpage: Boolean(args.no_webpage) }));
      return successResult({ status: "draft_saved", chat_id: peer, message: args.message });
    }

    case "get_drafts": {
      const res: any = await client.invoke(new Api.messages.GetAllDrafts());
      const drafts = (res.updates || []).map((u: any) => ({ peer: u.peer, draft: u.draft?.message || "", date: u.draft?.date || null }));
      return successResult({ count: drafts.length, drafts });
    }

    case "clear_draft": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.SaveDraft({ peer: entity, message: "" }));
      return successResult({ status: "draft_cleared", chat_id: peer });
    }

    default:
      return null;
  }
}
