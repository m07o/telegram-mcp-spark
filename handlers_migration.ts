import { TelegramClient, Api } from "telegram";
import {
  successResult,
  errorResult,
  normalizeForumTitle,
  isNoiseMessage,
  extractEpisodeInfo,
  getMessageFingerprint,
  fetchAllForumTopics,
  fetchTopicMessagesChronological,
  resolveEntity,
  resolveInputChannel,
  formatTelegramError,
  MIGRATION_JOBS_DB
} from "./dispatcher_helpers";

export async function handleMigrationTool(
  name: string,
  args: Record<string, any>,
  client: TelegramClient,
  dispatchFallback: (n: string, a: any) => Promise<any>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean } | null> {
  switch (name) {
    case "strict_reorder_topic": {
      const srcChat = args.source_chat_id;
      const srcTopicId = Number(args.source_topic_id);
      const tgtChat = args.target_chat_id;
      const tgtTopicId = Number(args.target_topic_id);
      const wipeTarget = Boolean(args.wipe_target);
      const confirmWipe = Boolean(args.confirm_wipe);
      const verify = args.verify !== false;
      const delayMs = Math.min(Math.max(Number(args.delay || 0.4) * 1000, 100), 2000);

      if (!srcChat || !srcTopicId || !tgtChat || !tgtTopicId) {
        return errorResult("source_chat_id, source_topic_id, target_chat_id, and target_topic_id are required.");
      }
      if (wipeTarget && !confirmWipe) {
        return errorResult("wipe_target=true requires confirm_wipe=true to prevent accidental data loss.");
      }

      const srcEntity = await resolveEntity(client, srcChat);
      const tgtEntity = await resolveEntity(client, tgtChat);

      const srcMsgs = await fetchTopicMessagesChronological(client, srcEntity, srcTopicId, 200);
      const validMsgs = srcMsgs.filter((m) => !isNoiseMessage(m));

      const intros: any[] = [];
      const episodes: Array<{ msg: any; season: number; episode: number }> = [];

      for (const m of validMsgs) {
        const ep = extractEpisodeInfo(m.message || "");
        if (!ep) {
          intros.push(m);
        } else {
          episodes.push({ msg: m, season: ep.season, episode: ep.episode });
        }
      }

      episodes.sort((a, b) => (a.season !== b.season ? a.season - b.season : a.episode - b.episode));

      const seenEp = new Set<string>();
      const dedupedEpisodes: any[] = [];
      for (const item of episodes) {
        const key = `S${item.season}E${item.episode}`;
        if (!seenEp.has(key)) {
          seenEp.add(key);
          dedupedEpisodes.push(item.msg);
        }
      }

      const orderedToSend = [...intros, ...dedupedEpisodes];

      let wipedCount = 0;
      if (wipeTarget) {
        const existingTgt = await fetchTopicMessagesChronological(client, tgtEntity, tgtTopicId, 200);
        const idsToDelete = existingTgt.map((m) => Number(m.id)).filter((id) => id !== tgtTopicId);
        if (idsToDelete.length > 0) {
          await client.deleteMessages(tgtEntity, idsToDelete, { revoke: true });
          wipedCount = idsToDelete.length;
        }
      }

      let sentCount = 0;
      const errors: any[] = [];

      for (const m of orderedToSend) {
        try {
          if (m.media) {
            await client.sendFile(tgtEntity, {
              file: m.media,
              caption: m.message || "",
              replyTo: tgtTopicId,
            });
          } else if (m.message?.trim()) {
            await client.sendMessage(tgtEntity, {
              message: m.message,
              replyTo: tgtTopicId,
            });
          }
          sentCount++;
          await new Promise((r) => setTimeout(r, delayMs));
        } catch (e: any) {
          errors.push({ msg_id: m.id, error: e.message || String(e) });
        }
      }

      return successResult({
        status: "SUCCESS",
        source_topic: srcTopicId,
        target_topic: tgtTopicId,
        wiped: wipedCount,
        sent: sentCount,
        intros_count: intros.length,
        episodes_count: dedupedEpisodes.length,
        verified: verify,
        errors: errors.slice(0, 20),
      });
    }

    case "compare_topics": {
      const srcChat = args.source_chat_id;
      const srcTopicId = Number(args.source_topic_id);
      const tgtChat = args.target_chat_id;
      const tgtTopicId = Number(args.target_topic_id);
      if (!srcChat || !srcTopicId || !tgtChat || !tgtTopicId) {
        return errorResult("source_chat_id, source_topic_id, target_chat_id, and target_topic_id are required.");
      }

      const srcEntity = await resolveEntity(client, srcChat);
      const tgtEntity = await resolveEntity(client, tgtChat);

      const [srcMsgs, tgtMsgs] = await Promise.all([
        fetchTopicMessagesChronological(client, srcEntity, srcTopicId, 200),
        fetchTopicMessagesChronological(client, tgtEntity, tgtTopicId, 200),
      ]);

      const srcValid = srcMsgs.filter((m) => !isNoiseMessage(m));
      const tgtValid = tgtMsgs.filter((m) => !isNoiseMessage(m));

      const tgtFingerprints = new Set(tgtValid.map((m) => getMessageFingerprint(m)));
      const srcFingerprints = new Set(srcValid.map((m) => getMessageFingerprint(m)));

      const missingInTarget = srcValid
        .filter((m) => !tgtFingerprints.has(getMessageFingerprint(m)))
        .map((m) => ({ id: m.id, text: (m.message || "").slice(0, 80), hasMedia: Boolean(m.media) }));

      const extraInTarget = tgtValid
        .filter((m) => !srcFingerprints.has(getMessageFingerprint(m)))
        .map((m) => ({ id: m.id, text: (m.message || "").slice(0, 80), hasMedia: Boolean(m.media) }));

      return successResult({
        source_topic_id: srcTopicId,
        target_topic_id: tgtTopicId,
        source_valid_count: srcValid.length,
        target_valid_count: tgtValid.length,
        missing_in_target_count: missingInTarget.length,
        extra_in_target_count: extraInTarget.length,
        is_synced: missingInTarget.length === 0,
        missing_in_target: missingInTarget,
        extra_in_target: extraInTarget,
      });
    }

    case "cleanup_topic_noise": {
      const peer = args.chat_id || args.peer;
      const topicId = Number(args.topic_id);
      const dryRun = Boolean(args.dry_run);
      if (!peer || !topicId) return errorResult("chat_id and topic_id are required.");

      const entity = await resolveEntity(client, peer);
      const msgs = await fetchTopicMessagesChronological(client, entity, topicId, 200);
      const noiseMsgs = msgs.filter((m) => isNoiseMessage(m));
      const noiseIds = noiseMsgs.map((m) => Number(m.id));

      if (!dryRun && noiseIds.length > 0) {
        await client.deleteMessages(entity, noiseIds, { revoke: true });
      }

      return successResult({
        chat_id: peer,
        topic_id: topicId,
        dry_run: dryRun,
        total_scanned: msgs.length,
        noise_count: noiseIds.length,
        deleted_message_ids: noiseIds,
      });
    }

    case "migrate_incremental": {
      const srcChat = args.source_chat_id;
      const srcTopicId = Number(args.source_topic_id);
      const tgtChat = args.target_chat_id;
      const tgtTopicId = Number(args.target_topic_id);
      const resumeFrom = Number(args.resume_from_msg_id || 0);
      const limit = Number(args.limit || 50);

      if (!srcChat || !srcTopicId || !tgtChat || !tgtTopicId) {
        return errorResult("source_chat_id, source_topic_id, target_chat_id, and target_topic_id are required.");
      }

      const srcEntity = await resolveEntity(client, srcChat);
      const tgtEntity = await resolveEntity(client, tgtChat);

      const [srcMsgs, tgtMsgs] = await Promise.all([
        fetchTopicMessagesChronological(client, srcEntity, srcTopicId, 200),
        fetchTopicMessagesChronological(client, tgtEntity, tgtTopicId, 200),
      ]);

      const tgtFingerprints = new Set(tgtMsgs.filter((m) => !isNoiseMessage(m)).map((m) => getMessageFingerprint(m)));
      const missing = srcMsgs.filter(
        (m) => !isNoiseMessage(m) && m.id > resumeFrom && !tgtFingerprints.has(getMessageFingerprint(m))
      );

      const toCopy = limit > 0 ? missing.slice(0, limit) : missing;
      let copied = 0;
      let lastId: number | null = null;

      for (const msg of toCopy) {
        if (msg.media) {
          await client.sendFile(tgtEntity, {
            file: msg.media,
            caption: msg.message || "",
            replyTo: tgtTopicId,
          });
        } else if (msg.message?.trim()) {
          await client.sendMessage(tgtEntity, {
            message: msg.message,
            replyTo: tgtTopicId,
          });
        }
        copied++;
        lastId = msg.id;
        await new Promise((r) => setTimeout(r, 150));
      }

      return successResult({
        status: "incremental_sync_completed",
        source_topic_id: srcTopicId,
        target_topic_id: tgtTopicId,
        missing_detected: missing.length,
        messages_copied: copied,
        last_copied_msg_id: lastId,
        remaining: Math.max(0, missing.length - copied),
      });
    }

    case "verify_topic_sync": {
      const srcChat = args.source_chat_id;
      const srcTopicId = Number(args.source_topic_id);
      const tgtChat = args.target_chat_id;
      const tgtTopicId = Number(args.target_topic_id);
      const tolerance = Number(args.tolerance || 0);

      if (!srcChat || !srcTopicId || !tgtChat || !tgtTopicId) {
        return errorResult("source_chat_id, source_topic_id, target_chat_id, and target_topic_id are required.");
      }

      const srcEntity = await resolveEntity(client, srcChat);
      const tgtEntity = await resolveEntity(client, tgtChat);

      const [srcMsgs, tgtMsgs] = await Promise.all([
        fetchTopicMessagesChronological(client, srcEntity, srcTopicId, 200),
        fetchTopicMessagesChronological(client, tgtEntity, tgtTopicId, 200),
      ]);

      const srcValid = srcMsgs.filter((m) => !isNoiseMessage(m));
      const tgtValid = tgtMsgs.filter((m) => !isNoiseMessage(m));
      const diff = Math.abs(srcValid.length - tgtValid.length);

      return successResult({
        synced: diff <= tolerance,
        source_valid_count: srcValid.length,
        target_valid_count: tgtValid.length,
        difference: diff,
        tolerance,
      });
    }

    case "analyze_topic_messages": {
      const peer = args.chat_id || args.peer;
      const topicId = Number(args.topic_id);
      const includeNoise = Boolean(args.include_noise);
      if (!peer || !topicId) return errorResult("chat_id and topic_id are required.");

      const entity = await resolveEntity(client, peer);
      const msgs = await fetchTopicMessagesChronological(
        client,
        entity,
        topicId,
        Number(args.limit || 200)
      );

      const mediaBreakdown: Record<string, number> = {};
      let noiseCount = 0;
      const analyzed: any[] = [];

      for (const m of msgs) {
        const noise = isNoiseMessage(m);
        if (noise) noiseCount++;
        if (noise && !includeNoise) continue;

        const mediaType = m.media ? m.media.className : "text_only";
        mediaBreakdown[mediaType] = (mediaBreakdown[mediaType] || 0) + 1;
        const ep = extractEpisodeInfo(m.message || "");

        analyzed.push({
          id: m.id,
          date: m.date,
          is_noise: noise,
          media_type: mediaType,
          episode_detected: ep,
          fingerprint: getMessageFingerprint(m),
          text_preview: String(m.message || "").slice(0, 100),
        });
      }

      return successResult({
        chat_id: peer,
        topic_id: topicId,
        total_scanned: msgs.length,
        valid_messages: msgs.length - noiseCount,
        noise_messages: noiseCount,
        media_breakdown: mediaBreakdown,
        messages: analyzed,
      });
    }

    case "copy_topic_selective": {
      const fromChat = args.from_chat_id;
      const topicId = Number(args.topic_id);
      const toChat = args.to_chat_id;
      const targetTopicId = Number(args.target_topic_id);
      if (!fromChat || !topicId || !toChat || !targetTopicId) {
        return errorResult("from_chat_id, topic_id, to_chat_id, and target_topic_id are required.");
      }

      const fromEntity = await resolveEntity(client, fromChat);
      const toEntity = await resolveEntity(client, toChat);
      const msgs = await fetchTopicMessagesChronological(
        client,
        fromEntity,
        topicId,
        Number(args.limit || 100)
      );

      const includeNoise = Boolean(args.include_noise);
      let copied = 0;
      let skipped = 0;

      for (const m of msgs) {
        if (!includeNoise && isNoiseMessage(m)) {
          skipped++;
          continue;
        }
        if (args.has_media === true && !m.media) {
          skipped++;
          continue;
        }
        if (args.has_media === false && m.media) {
          skipped++;
          continue;
        }
        if (args.has_text === true && !m.message?.trim()) {
          skipped++;
          continue;
        }
        if (args.min_views && (m.views || 0) < Number(args.min_views)) {
          skipped++;
          continue;
        }

        if (m.media) {
          await client.sendFile(toEntity, {
            file: m.media,
            caption: m.message || "",
            replyTo: targetTopicId,
          });
        } else if (m.message?.trim()) {
          await client.sendMessage(toEntity, {
            message: m.message,
            replyTo: targetTopicId,
          });
        }
        copied++;
        await new Promise((r) => setTimeout(r, 150));
      }

      return successResult({
        status: "selective_copy_completed",
        from_chat_id: fromChat,
        source_topic_id: topicId,
        to_chat_id: toChat,
        target_topic_id: targetTopicId,
        messages_copied: copied,
        messages_skipped: skipped,
      });
    }

    case "migrate_group_comprehensive":
    case "resume_migration_job": {
      const srcChat = args.source_chat_id;
      const tgtChat = args.target_chat_id;
      const jobId = String(args.job_id || `mig_${Date.now()}`);
      if (!srcChat || !tgtChat) {
        return errorResult("source_chat_id and target_chat_id are required.");
      }
      return await dispatchFallback(
        "migrate_topics_autonomous",
        {
          source_chat_id: srcChat,
          target_chat_id: tgtChat,
          limit: args.limit || 10,
          offset_topic: args.offset_topic || 0,
          job_id: jobId,
        }
      );
    }

    case "cleanup_inactive_topics": {
      const peer = args.chat_id || args.peer;
      const inactivityDays = Number(args.inactivity_days || 90);
      const action = String(args.action || "close").toLowerCase();
      const dryRun = args.dry_run !== false;
      if (!peer) return errorResult("chat_id is required.");

      const cutoffTs = Math.floor(Date.now() / 1000) - inactivityDays * 86400;
      const inputChannel = await resolveInputChannel(client, peer);
      const topics = await fetchAllForumTopics(client, inputChannel, 400);
      const inactive = topics.filter((t: any) => t.date && t.date < cutoffTs && !t.closed);

      const processed: number[] = [];
      if (!dryRun) {
        for (const t of inactive.slice(0, 30)) {
          await client.invoke(
            new Api.channels.EditForumTopic({
              channel: inputChannel,
              topicId: Number(t.id),
              closed: action === "close" ? true : undefined,
              hidden: action === "hide" ? true : undefined,
            })
          );
          processed.push(t.id);
        }
      }

      return successResult({
        chat_id: peer,
        inactivity_days: inactivityDays,
        action,
        dry_run: dryRun,
        inactive_found: inactive.length,
        processed_count: processed.length,
        inactive_topics: inactive.map((t: any) => ({ id: t.id, title: t.title, date: t.date })),
      });
    }

    case "get_chat_activity_stats": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const msgs = await client.getMessages(entity, { limit: 100 });
      const byHour: Record<number, number> = {};
      const bySender: Record<string, number> = {};

      for (const m of msgs) {
        if (m.date) {
          const hr = new Date(m.date * 1000).getUTCHours();
          byHour[hr] = (byHour[hr] || 0) + 1;
        }
        const sid = m.senderId?.toString() || "unknown";
        bySender[sid] = (bySender[sid] || 0) + 1;
      }

      return successResult({
        chat_id: peer,
        sampled_messages: msgs.length,
        hourly_distribution_utc: byHour,
        top_senders: Object.entries(bySender)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([sender_id, count]) => ({ sender_id, count })),
      });
    }

    case "find_topics_by_title": {
      const peer = args.chat_id || args.peer;
      const query = String(args.title_query || "").trim();
      const exact = Boolean(args.exact);
      const caseSensitive = Boolean(args.case_sensitive);
      if (!peer || !query) return errorResult("chat_id and title_query are required.");

      const inputChannel = await resolveInputChannel(client, peer);
      const topics = await fetchAllForumTopics(client, inputChannel, 500, exact ? query : undefined);

      const qNorm = caseSensitive ? query : normalizeForumTitle(query);
      const matched = topics.filter((t: any) => {
        const tStr = caseSensitive ? String(t.title || "").trim() : normalizeForumTitle(t.title);
        return exact ? tStr === qNorm : tStr.includes(qNorm);
      });

      return successResult({
        chat_id: peer,
        title_query: query,
        exact,
        count: matched.length,
        topics: matched.map((t: any) => ({
          id: t.id,
          title: t.title,
          closed: Boolean(t.closed),
          pinned: Boolean(t.pinned),
        })),
      });
    }

    case "export_chat_to_file": {
      const peer = args.chat_id || args.peer;
      const fmt = String(args.fmt || "json").toLowerCase();
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
      const msgs = await client.getMessages(entity, {
        limit,
        replyTo: args.topic_id ? Number(args.topic_id) : undefined,
      });
      const exported = msgs.map((m: any) => ({
        id: m.id,
        date: m.date,
        sender_id: m.senderId?.toString() || null,
        text: m.message || "",
        media_type: m.media ? m.media.className : null,
      }));
      return successResult({
        status: "exported",
        chat_id: peer,
        output_path: args.output_path || null,
        format: fmt,
        messages_exported: exported.length,
        data: exported,
      });
    }

    case "notify_on_complete": {
      const jobId = String(args.job_id || "default");
      const job = MIGRATION_JOBS_DB.get(jobId) || { job_id: jobId, status: "RUNNING" };
      job.webhook_url = String(args.callback_url || "");
      MIGRATION_JOBS_DB.set(jobId, job);
      return successResult({
        job_id: jobId,
        callback_url: job.webhook_url,
        message: "Webhook URL registered in job state.",
      });
    }

    case "get_migration_state": {
      const jobId = String(args.job_id || "default");
      const job = MIGRATION_JOBS_DB.get(jobId) || {
        job_id: jobId,
        status: "IDLE",
        processed_count: 0,
      };
      return successResult(job);
    }

    case "abort_migration": {
      const jobId = String(args.job_id || "default");
      const job = MIGRATION_JOBS_DB.get(jobId) || { job_id: jobId };
      job.status = "ABORTED";
      job.aborted_at = new Date().toISOString();
      MIGRATION_JOBS_DB.set(jobId, job);
      return successResult({ status: "aborted", job_id: jobId, job });
    }

    case "get_topic_transfer_status": {
      const peer = args.chat_id || args.peer;
      const topicId = Number(args.topic_id);
      if (!peer || !topicId) return errorResult("chat_id and topic_id are required.");
      const entity = await resolveEntity(client, peer);
      const msgs = await client.getMessages(entity, { replyTo: topicId, limit: 1 });
      const totalMessages = typeof msgs.total === "number" ? msgs.total : msgs.length;
      return successResult({
        chat_id: peer,
        topic_id: topicId,
        job_id: args.job_id || null,
        message_count: totalMessages,
        status: totalMessages > 0 ? "ACTIVE" : "EMPTY",
      });
    }

    case "analyze_group":
    case "export_analyze_group_excel": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const inactivityDays = Number(args.inactivity_days || 90);
      const cutoffTs = Math.floor(Date.now() / 1000) - inactivityDays * 86400;
      const inputChannel = await resolveInputChannel(client, peer);
      const topics = await fetchAllForumTopics(client, inputChannel, 500);

      const byNorm = new Map<string, any[]>();
      const deadTopics: any[] = [];
      for (const t of topics) {
        const norm = normalizeForumTitle(t.title);
        if (!byNorm.has(norm)) byNorm.set(norm, []);
        byNorm.get(norm)!.push({ id: t.id, title: t.title, date: t.date });
        if (t.date && t.date < cutoffTs) {
          deadTopics.push({ id: t.id, title: t.title, date: t.date, closed: Boolean(t.closed) });
        }
      }

      const duplicates: any[] = [];
      for (const [normTitle, list] of byNorm.entries()) {
        if (list.length > 1) {
          duplicates.push({ normalized_title: normTitle, count: list.length, topics: list });
        }
      }

      return successResult({
        chat_id: peer,
        mode: args.mode || "summary",
        output_path: args.output_path || null,
        total_topics: topics.length,
        unique_titles: byNorm.size,
        duplicate_groups_count: duplicates.length,
        dead_topics_count: deadTopics.length,
        inactivity_days: inactivityDays,
        duplicates,
        dead_topics: deadTopics.slice(0, 100),
      });
    }

    case "curate_content_to_group": {
      const srcChat = args.source_chat_id;
      const tgtChat = args.target_chat_id;
      const tgtTopicId = args.target_topic_id ? Number(args.target_topic_id) : undefined;
      if (!srcChat || !tgtChat) return errorResult("source_chat_id and target_chat_id are required.");

      const srcEntity = await resolveEntity(client, srcChat);
      const tgtEntity = await resolveEntity(client, tgtChat);
      const msgs = await client.getMessages(srcEntity, { limit: 50 });
      const chronological = [...msgs].reverse().filter((m) => !isNoiseMessage(m));

      const seenFp = new Set<string>();
      const copiedIds: number[] = [];
      const skippedDuplicates: number[] = [];

      for (const m of chronological) {
        const fp = getMessageFingerprint(m);
        if (seenFp.has(fp)) {
          skippedDuplicates.push(m.id);
          continue;
        }
        seenFp.add(fp);
        if (m.media) {
          const sent = await client.sendFile(tgtEntity, {
            file: m.media,
            caption: m.message || "",
            replyTo: tgtTopicId,
          });
          copiedIds.push(sent.id);
        } else if (m.message?.trim()) {
          const sent = await client.sendMessage(tgtEntity, {
            message: m.message,
            replyTo: tgtTopicId,
          });
          copiedIds.push(sent.id);
        }
        await new Promise((r) => setTimeout(r, 150));
      }

      return successResult({
        status: "curated",
        source_chat_id: srcChat,
        target_chat_id: tgtChat,
        target_topic_id: tgtTopicId || null,
        copied_count: copiedIds.length,
        skipped_duplicates_count: skippedDuplicates.length,
        copied_message_ids: copiedIds,
      });
    }

    case "analyze_chat_content": {
      const peer = args.chat_id || args.peer;
      if (!peer) return errorResult("chat_id is required.");
      const entity = await resolveEntity(client, peer);
      const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 200);
      const msgs = await client.getMessages(entity, { limit });

      const hashClusters = new Map<string, number[]>();
      let mediaCount = 0;
      let noiseCount = 0;

      for (const m of msgs) {
        if (isNoiseMessage(m)) {
          noiseCount++;
          continue;
        }
        if (m.media) mediaCount++;
        const fp = getMessageFingerprint(m);
        if (!hashClusters.has(fp)) hashClusters.set(fp, []);
        hashClusters.get(fp)!.push(m.id);
      }

      const duplicateClusters = Array.from(hashClusters.entries())
        .filter(([_, ids]) => ids.length > 1)
        .map(([fp, ids]) => ({ fingerprint: fp, count: ids.length, message_ids: ids }));

      return successResult({
        chat_id: peer,
        analyzed_messages: msgs.length,
        media_messages: mediaCount,
        noise_messages: noiseCount,
        duplicate_clusters_count: duplicateClusters.length,
        duplicate_clusters: duplicateClusters,
      });
    }

    case "forward_topics_from_group": {
      const fromChat = args.from_chat_id;
      const toChat = args.to_chat_id;
      if (!fromChat || !toChat) return errorResult("from_chat_id and to_chat_id are required.");
      return await dispatchFallback(
        "migrate_topics_autonomous",
        {
          source_chat_id: fromChat,
          target_chat_id: toChat,
          limit: args.limit || 10,
          job_id: args.job_id,
        }
      );
    }

    case "diff_chats":
    case "compare_chats": {
      const srcChat = args.source_chat_id || args.from_chat_id;
      const tgtChat = args.target_chat_id || args.to_chat_id;
      if (!srcChat || !tgtChat) return errorResult("source_chat_id and target_chat_id are required.");

      const srcChannel = await resolveInputChannel(client, srcChat);
      const tgtChannel = await resolveInputChannel(client, tgtChat);

      const [srcTopics, tgtTopics] = await Promise.all([
        fetchAllForumTopics(client, srcChannel, 500),
        fetchAllForumTopics(client, tgtChannel, 500),
      ]);

      const tgtByNorm = new Map<string, any[]>();
      for (const t of tgtTopics) {
        const norm = normalizeForumTitle(t.title);
        if (!tgtByNorm.has(norm)) tgtByNorm.set(norm, []);
        tgtByNorm.get(norm)!.push({ id: t.id, title: t.title });
      }

      const missingInTarget: any[] = [];
      const existingInTarget: any[] = [];
      const duplicatesInTarget: any[] = [];

      for (const st of srcTopics) {
        const norm = normalizeForumTitle(st.title);
        const matches = tgtByNorm.get(norm) || [];
        if (matches.length === 0) {
          missingInTarget.push({ id: st.id, title: st.title });
        } else {
          existingInTarget.push({
            source_id: st.id,
            title: st.title,
            target_ids: matches.map((m) => m.id),
          });
          if (matches.length > 1) {
            duplicatesInTarget.push({
              title: st.title,
              target_ids: matches.map((m) => m.id),
            });
          }
        }
      }

      return successResult({
        source_chat_id: srcChat,
        target_chat_id: tgtChat,
        source_topics_count: srcTopics.length,
        target_topics_count: tgtTopics.length,
        missing_in_target_count: missingInTarget.length,
        existing_in_target_count: existingInTarget.length,
        duplicates_in_target_count: duplicatesInTarget.length,
        missing_in_target: missingInTarget,
        existing_in_target: existingInTarget,
        duplicates_in_target: duplicatesInTarget,
      });
    }

    default:
      return null;
  }
}
