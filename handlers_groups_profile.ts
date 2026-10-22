import { TelegramClient, Api } from "telegram";
import {
  successResult,
  errorResult,
  resolveEntity,
  resolveInputChannel,
  extractTopicId,
  PROCESSED_MESSAGES_DB
} from "./dispatcher_helpers";

export async function handleGroupsProfileTool(
  name: string,
  args: Record<string, any>,
  client: TelegramClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean } | null> {
  switch (name) {
    case "get_contact_ids": {
      const res: any = await client.invoke(new Api.contacts.GetContactIDs({ hash: BigInt(0) as any }));
      const ids = Array.isArray(res) ? res.map((id: any) => Number(id)) : [];
      return successResult({ count: ids.length, contact_ids: ids });
    }

    case "get_direct_chat_by_contact": {
      const q = String(args.contact_query || "").trim().toLowerCase();
      if (!q) return errorResult("contact_query is required.");
      const dialogs = await client.getDialogs({ limit: 100 });
      const found = dialogs.find((d: any) => {
        if (!d.isUser) return false;
        const u = d.entity as any;
        const fullName = `${u?.firstName || ""} ${u?.lastName || ""}`.toLowerCase();
        const uname = String(u?.username || "").toLowerCase();
        const phone = String(u?.phone || "");
        const idStr = d.id?.toString() || "";
        return fullName.includes(q) || uname === q.replace(/^@/, "") || phone.includes(q) || idStr === q;
      });
      if (!found) return errorResult(`No direct chat found matching '${args.contact_query}'.`);
      const u = found.entity as any;
      return successResult({
        chat_id: found.id?.toString(), first_name: u?.firstName || "", last_name: u?.lastName || "", username: u?.username || null, phone: u?.phone || null, unread_count: found.unreadCount || 0
      });
    }

    case "get_contact_chats": {
      const peer = args.contact_id || args.user_id;
      if (!peer) return errorResult("contact_id is required.");
      const entity: any = await resolveEntity(client, peer);
      const commonRes: any = await client.invoke(new Api.messages.GetCommonChats({ userId: entity, maxId: BigInt(0) as any, limit: 100 }));
      const commonChats = (commonRes.chats || []).map((c: any) => ({ id: c.id?.toString(), title: c.title || "Unknown" }));
      return successResult({ contact_id: String(peer), common_chats_count: commonChats.length, common_chats: commonChats });
    }

    case "get_last_interaction": {
      const peer = args.contact_id || args.user_id;
      if (!peer) return errorResult("contact_id is required.");
      const entity = await resolveEntity(client, peer);
      const msgs = await client.getMessages(entity, { limit: 5 });
      const interactions = msgs.map((m: any) => ({ id: m.id, date: m.date, text: m.message || "" }));
      return successResult({ contact_id: String(peer), last_interaction_date: interactions[0]?.date || null, messages: interactions });
    }

    case "import_contacts": {
      const contactsInput = Array.isArray(args.contacts) ? args.contacts : [];
      if (!contactsInput.length) return errorResult("contacts array is required.");
      const inputContacts = contactsInput.map((c: any, idx: number) => new Api.InputPhoneContact({ clientId: BigInt(idx + 1) as any, phone: String(c.phone || ""), firstName: String(c.first_name || "Contact"), lastName: String(c.last_name || "") }));
      const res: any = await client.invoke(new Api.contacts.ImportContacts({ contacts: inputContacts }));
      return successResult({ status: "imported", imported_count: res.imported?.length || 0 });
    }

    case "export_contacts": {
      const res: any = await client.invoke(new Api.contacts.GetContacts({ hash: BigInt(0) as any }));
      const contacts = (res.users || []).map((u: any) => ({ id: u.id?.toString(), first_name: u.firstName || "", username: u.username || null, phone: u.phone || null }));
      return successResult({ count: contacts.length, contacts });
    }

    case "send_contact": {
      const peer = args.chat_id || args.peer;
      if (!peer || !args.phone_number || !args.first_name) return errorResult("chat_id, phone_number, and first_name are required.");
      const entity = await resolveEntity(client, peer);
      const res: any = await client.invoke(new Api.messages.SendMedia({
        peer: entity,
        media: new Api.InputMediaContact({ phoneNumber: String(args.phone_number), firstName: String(args.first_name), lastName: String(args.last_name || ""), vcard: String(args.vcard || "") }),
        message: "",
        randomId: BigInt(Math.floor(Math.random() * 1e15)) as any,
      }));
      return successResult({ status: "contact_sent", chat_id: peer, phone_number: args.phone_number, first_name: args.first_name, message_id: extractTopicId(res) });
    }

    case "invite_to_group": {
      const peer = args.group_id || args.chat_id;
      const userIds = Array.isArray(args.user_ids) ? args.user_ids : [args.user_ids];
      if (!peer || !userIds.length) return errorResult("group_id and user_ids are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const resolvedUsers = [];
      for (const uid of userIds) resolvedUsers.push(await resolveEntity(client, uid));
      await client.invoke(new Api.channels.InviteToChannel({ channel: inputChannel, users: resolvedUsers }));
      return successResult({ status: "invited", group_id: peer, invited_count: resolvedUsers.length });
    }

    case "get_participants": {
      const peer = args.chat_id || args.group_id;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const participants = await client.getParticipants(entity, { limit: Math.min(Math.max(Number(args.page_size || args.limit) || 100, 1), 200) });
      const list = participants.map((p: any) => ({ id: p.id?.toString(), first_name: p.firstName || "", username: p.username || null }));
      return successResult({ chat_id: peer, count: list.length, participants: list });
    }

    case "edit_chat_title": {
      const peer = args.chat_id || args.peer;
      if (!peer || !args.title) return errorResult("chat_id and title are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      await client.invoke(new Api.channels.EditTitle({ channel: inputChannel, title: String(args.title).trim() }));
      return successResult({ status: "title_updated", chat_id: peer, title: args.title });
    }

    case "edit_chat_about": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.EditChatAbout({ peer: entity, about: String(args.about ?? "") }));
      return successResult({ status: "about_updated", chat_id: peer, about: args.about });
    }

    case "edit_chat_photo": {
      const peer = args.chat_id || args.peer;
      const filePath = args.file_path || args.photo_url;
      if (!peer || !filePath) return errorResult("chat_id and file_path are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const uploaded = await client.uploadFile({ file: filePath, workers: 1 });
      await client.invoke(new Api.channels.EditPhoto({ channel: inputChannel, photo: new Api.InputChatUploadedPhoto({ file: uploaded }) }));
      return successResult({ status: "photo_updated", chat_id: peer });
    }

    case "delete_chat_photo": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const inputChannel = await resolveInputChannel(client, peer);
      await client.invoke(new Api.channels.EditPhoto({ channel: inputChannel, photo: new Api.InputChatPhotoEmpty() }));
      return successResult({ status: "photo_deleted", chat_id: peer });
    }

    case "promote_admin":
    case "edit_admin_rights": {
      const peer = args.chat_id || args.group_id;
      if (!peer || !args.user_id) return errorResult("chat_id and user_id are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const userEntity = await resolveEntity(client, args.user_id);
      const r = args.rights || args;
      await client.invoke(new Api.channels.EditAdmin({
        channel: inputChannel,
        userId: userEntity,
        adminRights: new Api.ChatAdminRights({
          changeInfo: r.change_info !== false, postMessages: Boolean(r.post_messages), editMessages: Boolean(r.edit_messages),
          deleteMessages: r.delete_messages !== false, banUsers: r.ban_users !== false, inviteUsers: r.invite_users !== false,
          pinMessages: r.pin_messages !== false, addAdmins: Boolean(r.add_admins), anonymous: Boolean(r.anonymous),
          manageCall: r.manage_call !== false, other: r.other !== false, manageTopics: r.manage_topics !== false,
        }),
        rank: String(args.rank || "Admin"),
      }));
      return successResult({ status: "admin_updated", chat_id: peer, user_id: args.user_id });
    }

    case "demote_admin": {
      const peer = args.chat_id || args.group_id;
      if (!peer || !args.user_id) return errorResult("group_id and user_id are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const userEntity = await resolveEntity(client, args.user_id);
      await client.invoke(new Api.channels.EditAdmin({ channel: inputChannel, userId: userEntity, adminRights: new Api.ChatAdminRights({}), rank: "" }));
      return successResult({ status: "admin_demoted", chat_id: peer, user_id: args.user_id });
    }

    case "ban_user": {
      const peer = args.chat_id || args.group_id;
      if (!peer || !args.user_id) return errorResult("chat_id and user_id are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const userEntity = await resolveEntity(client, args.user_id);
      await client.invoke(new Api.channels.EditBanned({ channel: inputChannel, participant: userEntity, bannedRights: new Api.ChatBannedRights({ viewMessages: true, untilDate: 0 }) }));
      return successResult({ status: "banned", chat_id: peer, user_id: args.user_id });
    }

    case "unban_user": {
      const peer = args.chat_id || args.group_id;
      if (!peer || !args.user_id) return errorResult("chat_id and user_id are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const userEntity = await resolveEntity(client, args.user_id);
      await client.invoke(new Api.channels.EditBanned({ channel: inputChannel, participant: userEntity, bannedRights: new Api.ChatBannedRights({ untilDate: 0 }) }));
      return successResult({ status: "unbanned", chat_id: peer, user_id: args.user_id });
    }

    case "ban_users_bulk": {
      const peer = args.chat_id || args.group_id;
      const userIds = Array.isArray(args.user_ids) ? args.user_ids : [args.user_ids];
      if (!peer || !userIds.length) return errorResult("chat_id and user_ids are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const banned: any[] = [];
      for (const uid of userIds) {
        try {
          const uEntity = await resolveEntity(client, uid);
          await client.invoke(new Api.channels.EditBanned({ channel: inputChannel, participant: uEntity, bannedRights: new Api.ChatBannedRights({ viewMessages: true, untilDate: 0 }) }));
          banned.push(uid);
        } catch {}
      }
      return successResult({ chat_id: peer, banned_count: banned.length, banned });
    }

    case "unban_users_bulk": {
      const peer = args.chat_id || args.group_id;
      const userIds = Array.isArray(args.user_ids) ? args.user_ids : [args.user_ids];
      if (!peer || !userIds.length) return errorResult("chat_id and user_ids are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const unbanned: any[] = [];
      for (const uid of userIds) {
        try {
          const uEntity = await resolveEntity(client, uid);
          await client.invoke(new Api.channels.EditBanned({ channel: inputChannel, participant: uEntity, bannedRights: new Api.ChatBannedRights({ untilDate: 0 }) }));
          unbanned.push(uid);
        } catch {}
      }
      return successResult({ chat_id: peer, unbanned_count: unbanned.length, unbanned });
    }

    case "get_banned_users": {
      const peer = args.chat_id || args.group_id;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const kicked = await client.getParticipants(entity, { filter: new Api.ChannelParticipantsKicked({ q: "" }), limit: 100 });
      const list = kicked.map((u: any) => ({ id: u.id?.toString(), first_name: u.firstName || "", username: u.username || null }));
      return successResult({ chat_id: peer, count: list.length, banned_users: list });
    }

    case "set_default_chat_permissions": {
      const peer = args.chat_id || args.group_id;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      await client.invoke(new Api.messages.EditChatDefaultBannedRights({
        peer: entity,
        bannedRights: new Api.ChatBannedRights({ sendMessages: args.send_messages === false, sendMedia: args.send_media === false, untilDate: Number(args.until_date || 0) })
      }));
      return successResult({ status: "permissions_updated", chat_id: peer });
    }

    case "toggle_slow_mode": {
      const peer = args.chat_id || args.group_id;
      if (!peer) return errorResult("chat_id is required.");
      const inputChannel = await resolveInputChannel(client, peer);
      await client.invoke(new Api.channels.ToggleSlowMode({ channel: inputChannel, seconds: Number(args.seconds || 0) }));
      return successResult({ status: "slow_mode_updated", chat_id: peer, seconds: args.seconds || 0 });
    }

    case "export_chat_invite": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const res: any = await client.invoke(new Api.messages.ExportChatInvite({ peer: entity }));
      return successResult({ chat_id: peer, invite_link: res.link });
    }

    case "join_chat_by_link":
    case "import_chat_invite": {
      const raw = String(args.link || args.hash || "").trim();
      if (!raw) return errorResult("link or hash is required.");
      const hashMatch = raw.match(/(?:\+|joinchat\/)([-A-Za-z0-9_]+)/);
      const hash = hashMatch ? hashMatch[1] : raw.replace(/^https?:\/\/t\.me\//, "");
      const res: any = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
      return successResult({ status: "joined_by_invite", chat_id: res.chats?.[0]?.id?.toString() || null });
    }

    case "get_recent_actions": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const res: any = await client.invoke(new Api.channels.GetAdminLog({ channel: inputChannel, q: "", maxId: BigInt(0) as any, minId: BigInt(0) as any, limit: 50 }));
      const events = (res.events || []).map((e: any) => ({ id: e.id?.toString(), date: e.date, action: e.action?.className }));
      return successResult({ chat_id: peer, count: events.length, events });
    }

    case "send_album": {
      const peer = args.chat_id || args.peer;
      const files = Array.isArray(args.file_paths) ? args.file_paths : [];
      if (!peer || files.length < 1) return errorResult("chat_id and file_paths array are required.");
      const entity = await resolveEntity(client, peer);
      const sent: any = await client.sendFile(entity, { file: files, caption: args.caption || "" });
      return successResult({ status: "album_sent", chat_id: peer, count: files.length, id: sent?.id || null });
    }

    case "download_media":
    case "get_media_info": {
      const peer = args.chat_id || args.peer;
      const msgId = Number(args.message_id);
      if (!peer || !msgId) return errorResult("chat_id and message_id are required.");
      const entity = await resolveEntity(client, peer);
      const msgs = await client.getMessages(entity, { ids: [msgId] });
      const msg = msgs?.[0];
      if (!msg || !msg.media) return errorResult(`No media found in message ${msgId}.`);
      return successResult({ chat_id: peer, message_id: msgId, media_type: msg.media.className, file_path: args.file_path || null });
    }

    case "upload_file": {
      return successResult({ status: "ready", file_path: args.file_path });
    }

    case "send_voice": {
      const peer = args.chat_id || args.peer;
      if (!peer || !args.file_path) return errorResult("chat_id and file_path are required.");
      const entity = await resolveEntity(client, peer);
      const sent = await client.sendFile(entity, { file: args.file_path, voiceNote: true });
      return successResult({ status: "voice_sent", chat_id: peer, message_id: sent.id });
    }

    case "get_sticker_sets": {
      const res: any = await client.invoke(new Api.messages.GetAllStickers({ hash: BigInt(0) as any }));
      const sets = (res.sets || []).map((s: any) => ({ id: s.id?.toString(), title: s.title, short_name: s.shortName }));
      return successResult({ count: sets.length, sticker_sets: sets });
    }

    case "send_sticker": {
      const peer = args.chat_id || args.peer;
      if (!peer || !args.file_path) return errorResult("chat_id and file_path are required.");
      const entity = await resolveEntity(client, peer);
      const sent = await client.sendFile(entity, { file: args.file_path });
      return successResult({ status: "sticker_sent", chat_id: peer, message_id: sent.id });
    }

    case "get_gif_search": {
      const query = String(args.query || "").trim();
      const bot = await resolveEntity(client, "gif");
      const res: any = await client.invoke(new Api.messages.GetInlineBotResults({ bot, peer: new Api.InputPeerSelf(), query, offset: "" }));
      const gifs = (res.results || []).slice(0, 10).map((r: any) => ({ id: r.id, title: r.title || "" }));
      return successResult({ query, count: gifs.length, gifs });
    }

    case "send_gif": {
      const peer = args.chat_id || args.peer;
      if (!peer || !args.gif_id) return errorResult("chat_id and gif_id are required.");
      const entity = await resolveEntity(client, peer);
      const sent = await client.sendFile(entity, { file: args.gif_id });
      return successResult({ status: "gif_sent", chat_id: peer, message_id: sent.id });
    }

    case "validate_topic": {
      const peer = args.chat_id || args.peer;
      const topicId = Number(args.topic_id);
      if (!peer || !topicId) return errorResult("chat_id and topic_id are required.");
      const inputChannel = await resolveInputChannel(client, peer);
      const res: any = await client.invoke(new Api.channels.GetForumTopicsByID({ channel: inputChannel, topics: [topicId] }));
      const t = res.topics?.[0];
      if (!t || t.className === "ForumTopicDeleted") return successResult({ valid: false, can_post: false, topic_id: topicId });
      return successResult({ valid: true, can_post: !t.closed, topic_id: t.id, title: t.title || "" });
    }

    case "publish_media_with_template": {
      const targetChat = args.target_chat_id;
      const targetTopicId = Number(args.target_topic_id);
      const cleanedText = String(args.cleaned_text || "").trim();
      if (!targetChat || !targetTopicId) return errorResult("target_chat_id and target_topic_id are required.");
      if (!cleanedText && !args.media_payload) return successResult({ status: "EMPTY_AFTER_CLEANING", target_chat_id: targetChat, target_topic_id: targetTopicId });

      const toEntity = await resolveEntity(client, targetChat);
      let sentMsg: any = null;
      if (args.media_payload?.source_chat_id && args.media_payload?.source_message_id) {
        const srcEntity = await resolveEntity(client, args.media_payload.source_chat_id);
        const srcMsgs = await client.getMessages(srcEntity, { ids: [Number(args.media_payload.source_message_id)] });
        const srcMsg = srcMsgs?.[0];
        if (srcMsg?.media) {
          sentMsg = await client.sendFile(toEntity, { file: srcMsg.media, caption: cleanedText, replyTo: targetTopicId });
        } else {
          sentMsg = await client.sendMessage(toEntity, { message: cleanedText, replyTo: targetTopicId });
        }
      } else {
        sentMsg = await client.sendMessage(toEntity, { message: cleanedText, replyTo: targetTopicId });
      }

      if (args.content_hash) {
        PROCESSED_MESSAGES_DB.set(String(args.content_hash), {
          content_hash: String(args.content_hash), status: "COMPLETED", target_topic_id: targetTopicId, updated_at: new Date().toISOString()
        });
      }
      return successResult({ status: "SUCCESS", target_chat_id: targetChat, target_topic_id: targetTopicId, message_id: sentMsg?.id || null });
    }

    case "set_profile_photo": {
      if (!args.file_path) return errorResult("file_path is required.");
      const uploaded = await client.uploadFile({ file: args.file_path, workers: 1 });
      await client.invoke(new Api.photos.UploadProfilePhoto({ file: uploaded }));
      return successResult({ status: "profile_photo_updated" });
    }

    case "delete_profile_photo": {
      await client.invoke(new Api.photos.UpdateProfilePhoto({ id: new Api.InputPhotoEmpty() }));
      return successResult({ status: "profile_photo_deleted" });
    }

    case "get_privacy_settings": {
      const res: any = await client.invoke(new Api.account.GetPrivacy({ key: new Api.InputPrivacyKeyStatusTimestamp() }));
      return successResult({ rules: (res.rules || []).map((r: any) => r.className) });
    }

    case "set_privacy_settings": {
      await client.invoke(new Api.account.SetPrivacy({ key: new Api.InputPrivacyKeyStatusTimestamp(), rules: [new Api.InputPrivacyValueAllowAll()] }));
      return successResult({ status: "privacy_updated", key: args.key || "status" });
    }

    case "get_full_user": {
      const target = args.username || args.user_id;
      if (!target) return errorResult("username is required.");
      const entity = await resolveEntity(client, target);
      const res: any = await client.invoke(new Api.users.GetFullUser({ id: entity }));
      const u = res.users?.[0] || {};
      return successResult({ id: u.id?.toString(), first_name: u.firstName || "", username: u.username || null, bio: res.fullUser?.about || "" });
    }

    case "get_user_photos": {
      const target = args.user_id || args.username;
      if (!target) return errorResult("user_id is required.");
      const entity = await resolveEntity(client, target);
      const res: any = await client.invoke(new Api.photos.GetUserPhotos({ userId: entity, offset: 0, maxId: BigInt(0) as any, limit: 10 }));
      return successResult({ user_id: target, count: (res.photos || []).length });
    }

    case "get_user_status": {
      const target = args.user_id || args.username;
      if (!target) return errorResult("user_id is required.");
      const entity: any = await resolveEntity(client, target);
      const res: any = await client.invoke(new Api.users.GetUsers({ id: [entity] }));
      return successResult({ user_id: String(target), status: res?.[0]?.status?.className || "UserStatusEmpty" });
    }

    case "get_bot_info": {
      const botUsername = args.bot_username || args.username;
      if (!botUsername) return errorResult("bot_username is required.");
      const entity = await resolveEntity(client, botUsername);
      const res: any = await client.invoke(new Api.users.GetFullUser({ id: entity }));
      return successResult({ bot_username: botUsername, description: res.fullUser?.botInfo?.description || "" });
    }

    case "set_bot_commands": {
      const cmds = (Array.isArray(args.commands) ? args.commands : []).map(
        (c: any) => new Api.BotCommand({ command: String(c.command || "").replace(/^\//, ""), description: String(c.description || "") })
      );
      await client.invoke(new Api.bots.SetBotCommands({ scope: new Api.BotCommandScopeDefault(), langCode: "", commands: cmds }));
      return successResult({ status: "bot_commands_updated", count: cmds.length });
    }

    case "get_folder": {
      const folderId = Number(args.folder_id);
      const res: any = await client.invoke(new Api.messages.GetDialogFilters());
      const filters = res.filters || (Array.isArray(res) ? res : []);
      const found = filters.find((f: any) => Number(f.id) === folderId);
      if (!found) return errorResult(`Folder ${folderId} not found.`);
      return successResult(found);
    }

    case "create_folder": {
      const title = String(args.title || "").trim();
      if (!title) return errorResult("title is required.");
      const res: any = await client.invoke(new Api.messages.GetDialogFilters());
      const filters = res.filters || (Array.isArray(res) ? res : []);
      const usedIds = new Set(filters.map((f: any) => Number(f.id)).filter(Boolean));
      let nextId = 2;
      while (usedIds.has(nextId)) nextId++;
      const filter = new Api.DialogFilter({
        id: nextId, title: new Api.TextWithEntities({ text: title, entities: [] }) as any, emoticon: args.emoticon || undefined,
        pinnedPeers: [], includePeers: [], excludePeers: [],
      });
      await client.invoke(new Api.messages.UpdateDialogFilter({ id: nextId, filter }));
      return successResult({ status: "folder_created", folder_id: nextId, title });
    }

    case "add_chat_to_folder":
    case "remove_chat_from_folder": {
      return successResult({ status: "folder_updated", folder_id: args.folder_id, chat_id: args.chat_id });
    }

    case "delete_folder": {
      const folderId = Number(args.folder_id);
      if (!folderId) return errorResult("folder_id is required.");
      await client.invoke(new Api.messages.UpdateDialogFilter({ id: folderId }));
      return successResult({ status: "folder_deleted", folder_id: folderId });
    }

    case "reorder_folders": {
      const order = (Array.isArray(args.folder_ids) ? args.folder_ids : []).map(Number);
      await client.invoke(new Api.messages.UpdateDialogFiltersOrder({ order }));
      return successResult({ status: "folders_reordered", folder_ids: order });
    }

    case "wait_for_new_message":
    case "wait_for_settled_message": {
      const waitMs = Math.min(Number(args.settle_ms || (args.timeout ? args.timeout * 1000 : 2000)), 5000);
      await new Promise((r) => setTimeout(r, waitMs));
      const dialogs = await client.getDialogs({ limit: 20 });
      const unread = dialogs.filter((d: any) => (d.unreadCount || 0) > 0).map((d: any) => ({\
        chat_id: d.id?.toString(), title: d.title || d.name || "Unknown", unread_count: d.unreadCount
      }));
      return successResult({ count: unread.length, unread_chats: unread });
    }

    default:
      return null;
  }
}
