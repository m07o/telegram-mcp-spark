import { TelegramClient } from "telegram";
import {
  successResult,
  errorResult,
  normalizeForumTitle,
  computeContentHash,
  PROCESSED_MESSAGES_DB,
  SERIES_EPISODES_DB,
  TOPIC_BINDINGS_DB,
  MIGRATION_JOBS_DB,
  REF_MAP_DB,
  AUDIT_CHECKPOINTS_DB,
  RESOLVED_ENTITY_CACHE,
  DB_INITIALIZED,
  setDbInitialized,
  getKvNamespace,
  persistKvGet,
  persistKvSet
} from "./dispatcher_helpers";

export async function handleDbTool(
  name: string,
  args: Record<string, any>,
  client: TelegramClient
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean } | null> {
  switch (name) {
    case "list_tool_categories": {
      const categories = [
        { category: "accounts", count: 1, description: "Telegram account configuration and connection state", examples: ["list_accounts"] },
        { category: "discovery", count: 3, description: "Self-discovery of MCP tools, categories, and server health", examples: ["search_tools", "list_tool_categories", "telegram_health_check"] },
        { category: "contacts", count: 14, description: "Contact management, search, blocking, import/export, and vCards", examples: ["list_contacts", "search_contacts", "add_contact", "block_user"] },
        { category: "chats", count: 27, description: "Dialogs, channels, and forum topic operations & incremental sync", examples: ["list_chats", "list_topics", "create_forum_topic", "find_or_create_topic", "compare_topics"] },
        { category: "messages", count: 34, description: "Messages, search, copy without forward tag, batch caption edit, scheduling, reactions, polls, buttons, drafts", examples: ["send_message", "get_history", "copy_message", "batch_edit_captions", "send_reaction"] },
        { category: "groups", count: 34, description: "Group/supergroup administration, permissions, slow mode, forum controls, and group analytics", examples: ["promote_admin", "ban_user", "close_forum_topic", "delete_topic", "analyze_group"] },
        { category: "media", count: 12, description: "Media upload/download, albums, voice notes, stickers, GIFs, and templated topic publishing", examples: ["send_file", "send_album", "get_media_info", "publish_media_with_template", "validate_topic"] },
        { category: "profile", count: 11, description: "Personal profile, photos, privacy settings, user statuses, and bot commands", examples: ["get_me", "update_profile", "get_full_user", "get_privacy_settings"] },
        { category: "folders", count: 7, description: "Dialog filter folders management and ordering", examples: ["list_folders", "create_folder", "add_chat_to_folder", "reorder_folders"] },
        { category: "events", count: 2, description: "Real-time incoming message polling and debounced settling", examples: ["wait_for_new_message", "wait_for_settled_message"] },
        { category: "forum_forward", count: 1, description: "Bulk forum topic copying across supergroups without forward tags", examples: ["forward_topics_from_group"] },
        { category: "content", count: 2, description: "Chat content quality analysis, deduplication clustering, and curated migration", examples: ["analyze_chat_content", "curate_content_to_group"] },
        { category: "database", count: 14, description: "Deduplication tracking, SHA-256 content hashing, audit checkpoints, read-only DB query, parity check, and topic bindings with Cloudflare KV persistence", examples: ["initialize_database", "query_media_db", "db_parity_check", "save_audit_checkpoint", "get_audit_checkpoint"] },
        { category: "migration", count: 17, description: "Autonomous forum migration, delta topic sync, sequence auditing, selective topic copy, inactive topic cleanup, and strict episode reordering", examples: ["migrate_topics_autonomous", "sync_topic_delta", "audit_topic_sequence", "strict_reorder_topic"] },
      ];
      return successResult({ total_categories: categories.length, total_tools: 179, categories });
    }

    case "search_tools": {
      const query = String(args.query || "").toLowerCase().trim();
      const categoryFilter = args.category ? String(args.category).toLowerCase().trim() : null;
      return successResult({ query, category: categoryFilter, status: "ok" });
    }

    case "telegram_health_check": {
      let me: any = null;
      try { me = await client.getMe(); } catch {}
      const hasKv = Boolean(getKvNamespace());
      return successResult({
        status: "ok",
        connected: Boolean(client?.connected),
        account: me ? { id: me.id?.toString(), username: me.username || null, first_name: me.firstName || "" } : null,
        persistence: {
          kv_storage_bound: hasKv,
          storage_mode: hasKv ? "Cloudflare KV + In-Memory Cache" : "In-Memory Only",
        },
        database: {
          initialized: DB_INITIALIZED,
          processed_messages: PROCESSED_MESSAGES_DB.size,
          series_episodes: SERIES_EPISODES_DB.size,
          topic_bindings: TOPIC_BINDINGS_DB.size,
          migration_jobs: MIGRATION_JOBS_DB.size,
          audit_checkpoints: AUDIT_CHECKPOINTS_DB.size,
          ref_maps: REF_MAP_DB.size,
        },
        entity_cache_size: RESOLVED_ENTITY_CACHE.size,
      });
    }

    case "initialize_database": {
      setDbInitialized(true);
      const hasKv = Boolean(getKvNamespace());
      return successResult({
        status: "initialized",
        persistence: hasKv ? "Cloudflare KV + In-Memory" : "In-Memory",
        tables: ["processed_messages", "series_episodes", "topic_bindings", "migration_jobs", "audit_checkpoints", "ref_map"],
        counts: {
          processed_messages: PROCESSED_MESSAGES_DB.size,
          series_episodes: SERIES_EPISODES_DB.size,
          topic_bindings: TOPIC_BINDINGS_DB.size,
          migration_jobs: MIGRATION_JOBS_DB.size,
          audit_checkpoints: AUDIT_CHECKPOINTS_DB.size,
        },
      });
    }

    case "compute_content_hash_tool":
    case "compute_content_hash": {
      const hash = await computeContentHash(
        String(args.text || ""),
        String(args.file_name || ""),
        Number(args.file_size_bytes || 0)
      );
      return successResult({
        content_hash: hash,
        file_name: args.file_name || "",
        file_size_bytes: Number(args.file_size_bytes || 0),
      });
    }

    case "check_duplicate": {
      const srcChannel = String(args.source_channel_id || "");
      const srcMsgId = String(args.source_message_id || "");
      const contentHash = String(args.content_hash || "");
      const compositeKey = `${srcChannel}:${srcMsgId}`;

      let byHash = contentHash ? PROCESSED_MESSAGES_DB.get(contentHash) : null;
      if (!byHash && contentHash) {
        byHash = await persistKvGet(`msg_hash:${contentHash}`);
        if (byHash) PROCESSED_MESSAGES_DB.set(contentHash, byHash);
      }

      let byMsg = PROCESSED_MESSAGES_DB.get(compositeKey);
      if (!byMsg && srcChannel && srcMsgId) {
        byMsg = await persistKvGet(`msg_id:${srcChannel}:${srcMsgId}`);
        if (byMsg) PROCESSED_MESSAGES_DB.set(compositeKey, byMsg);
      }

      const existing = byHash || byMsg || null;

      return successResult({
        is_duplicate: Boolean(existing && existing.status === "COMPLETED"),
        match_type: byHash ? "content_hash" : byMsg ? "source_message_id" : null,
        existing_record: existing,
      });
    }

    case "record_message_status": {
      const srcChannel = String(args.source_channel_id || "");
      const srcMsgId = Number(args.source_message_id || 0);
      const contentHash = String(args.content_hash || "");
      const status = String(args.status || "COMPLETED");
      const record = {
        source_channel_id: srcChannel,
        source_message_id: srcMsgId,
        content_hash: contentHash,
        status,
        target_topic_id: args.target_topic_id ? Number(args.target_topic_id) : null,
        failure_reason: args.failure_reason || null,
        updated_at: new Date().toISOString(),
      };
      if (contentHash) {
        PROCESSED_MESSAGES_DB.set(contentHash, record);
        await persistKvSet(`msg_hash:${contentHash}`, record);
      }
      if (srcChannel && srcMsgId) {
        PROCESSED_MESSAGES_DB.set(`${srcChannel}:${srcMsgId}`, record);
        await persistKvSet(`msg_id:${srcChannel}:${srcMsgId}`, record);
      }
      return successResult({ status: "recorded", record });
    }

    case "get_message_status_tool":
    case "get_message_status": {
      const contentHash = String(args.content_hash || "");
      let rec = PROCESSED_MESSAGES_DB.get(contentHash) || null;
      if (!rec && contentHash) {
        rec = await persistKvGet(`msg_hash:${contentHash}`);
        if (rec) PROCESSED_MESSAGES_DB.set(contentHash, rec);
      }
      return successResult({ found: Boolean(rec), content_hash: contentHash, record: rec });
    }

    case "add_series_episode_tool":
    case "add_series_episode": {
      const seriesName = normalizeForumTitle(args.series_name);
      const season = Number(args.season_number || 1);
      const episode = Number(args.episode_number || 1);
      const key = `${seriesName}::S${season}`;
      if (!SERIES_EPISODES_DB.has(key)) {
        SERIES_EPISODES_DB.set(key, {
          series_name: args.series_name,
          season_number: season,
          episodes: new Map<number, any>(),
        });
      }
      const entry = SERIES_EPISODES_DB.get(key)!;
      entry.episodes.set(episode, {
        episode_number: episode,
        telegram_message_id: args.telegram_message_id ? Number(args.telegram_message_id) : null,
        topic_id: args.topic_id ? Number(args.topic_id) : null,
        recorded_at: new Date().toISOString(),
      });
      return successResult({
        status: "episode_recorded",
        series_name: args.series_name,
        season_number: season,
        episode_number: episode,
        total_recorded_in_season: entry.episodes.size,
      });
    }

    case "audit_series_sequence": {
      const seriesName = normalizeForumTitle(args.series_name);
      const season = Number(args.season_number || 1);
      const key = `${seriesName}::S${season}`;
      const entry = SERIES_EPISODES_DB.get(key);
      const epNums: number[] = entry
        ? (Array.from(entry.episodes.keys()) as number[]).sort((a, b) => a - b)
        : [];
      const maxEp = epNums.length ? epNums[epNums.length - 1] : 0;
      const missing: number[] = [];
      for (let i = 1; i <= maxEp; i++) {
        if (!epNums.includes(i)) missing.push(i);
      }
      return successResult({
        series_name: args.series_name,
        season_number: season,
        available_episodes: epNums,
        total_available: epNums.length,
        max_episode: maxEp,
        missing_episodes: missing,
        is_complete: epNums.length > 0 && missing.length === 0,
      });
    }

    case "record_topic_binding": {
      const normSeries = normalizeForumTitle(args.series_name);
      const chatId = String(args.chat_id || "");
      const topicId = Number(args.topic_id);
      const existing =
        TOPIC_BINDINGS_DB.get(`${chatId}::${normSeries}`) ||
        (await persistKvGet(`topic_binding:${chatId}:${normSeries}`));
      const lastSyncedMsgId =
        args.last_synced_msg_id !== undefined
          ? Number(args.last_synced_msg_id)
          : Number(existing?.last_synced_msg_id || 0);

      const binding = {
        series_name: args.series_name,
        normalized_series_name: normSeries,
        chat_id: chatId,
        topic_id: topicId,
        binding_type: String(args.binding_type || "PRIMARY"),
        last_synced_msg_id: lastSyncedMsgId,
        updated_at: new Date().toISOString(),
      };
      TOPIC_BINDINGS_DB.set(`${chatId}::${normSeries}`, binding);
      TOPIC_BINDINGS_DB.set(normSeries, binding);

      await persistKvSet(`topic_binding:${chatId}:${normSeries}`, binding);
      await persistKvSet(`topic_binding_global:${normSeries}`, binding);

      return successResult({ status: "binding_recorded", binding });
    }

    case "get_topic_binding": {
      if (args.series_name) {
        const normSeries = normalizeForumTitle(args.series_name);
        const chatId = args.chat_id ? String(args.chat_id) : null;
        let b =
          (chatId ? TOPIC_BINDINGS_DB.get(`${chatId}::${normSeries}`) : null) ||
          TOPIC_BINDINGS_DB.get(normSeries) ||
          null;

        if (!b && chatId) {
          b = await persistKvGet(`topic_binding:${chatId}:${normSeries}`);
          if (b) TOPIC_BINDINGS_DB.set(`${chatId}::${normSeries}`, b);
        }
        if (!b) {
          b = await persistKvGet(`topic_binding_global:${normSeries}`);
          if (b) TOPIC_BINDINGS_DB.set(normSeries, b);
        }

        return successResult({ found: Boolean(b), binding: b });
      }
      const allBindings = Array.from(TOPIC_BINDINGS_DB.values());
      return successResult({ count: allBindings.length, bindings: allBindings });
    }

    case "record_migration_progress": {
      const jobId = String(args.job_id || "default");
      let existing = MIGRATION_JOBS_DB.get(jobId);
      if (!existing) {
        existing = (await persistKvGet(`migration_job:${jobId}`)) || {
          job_id: jobId,
          status: "RUNNING",
          processed_count: 0,
          topics: {},
          created_at: new Date().toISOString(),
        };
      }
      existing.processed_count += Number(args.increment || 0);
      if (args.status) existing.status = String(args.status);
      if (args.source_topic_id) {
        existing.last_source_topic_id = Number(args.source_topic_id);
        existing.last_target_topic_id = args.target_topic_id ? Number(args.target_topic_id) : null;
      }
      existing.updated_at = new Date().toISOString();
      MIGRATION_JOBS_DB.set(jobId, existing);

      await persistKvSet(`migration_job:${jobId}`, existing);

      return successResult({ status: "progress_updated", job: existing });
    }

    case "get_ref_map": {
      const jobId = String(args.job_id || "default");
      const entries = REF_MAP_DB.get(jobId) || [];
      if (args.stats_only) {
        return successResult({ job_id: jobId, total_mappings: entries.length });
      }
      return successResult({
        job_id: jobId,
        total_mappings: entries.length,
        mappings: args.list_all ? entries : entries.slice(0, 100),
      });
    }

    case "save_audit_checkpoint": {
      const sweepName = String(args.sweep_name || "").trim();
      if (!sweepName) return errorResult("sweep_name is required.");
      const checkpoint = {
        sweep_name: sweepName,
        last_topic_id: args.last_topic_id !== undefined && args.last_topic_id !== null ? Number(args.last_topic_id) : null,
        processed_count: Number(args.processed_count || 0),
        status: String(args.status || "IN_PROGRESS"),
        metadata_json: args.metadata_json ? (typeof args.metadata_json === "string" ? args.metadata_json : JSON.stringify(args.metadata_json)) : null,
        updated_at: new Date().toISOString(),
      };
      AUDIT_CHECKPOINTS_DB.set(sweepName, checkpoint);
      await persistKvSet(`audit_checkpoint:${sweepName}`, checkpoint);
      return successResult({ status: "SUCCESS", checkpoint });
    }

    case "get_audit_checkpoint": {
      const sweepName = String(args.sweep_name || "").trim();
      if (!sweepName) return errorResult("sweep_name is required.");
      let cp = AUDIT_CHECKPOINTS_DB.get(sweepName) || null;
      if (!cp) {
        cp = await persistKvGet(`audit_checkpoint:${sweepName}`);
        if (cp) AUDIT_CHECKPOINTS_DB.set(sweepName, cp);
      }
      return successResult({
        status: "SUCCESS",
        found: Boolean(cp),
        checkpoint: cp,
      });
    }

    case "query_media_db": {
      const rawSql = String(args.sql || args.query || "").trim();
      if (!rawSql) return errorResult("sql is required.");

      // Read-only SQL guard (mirrors Python DB-READONLY-VIOLATION check)
      const strippedNoStrings = rawSql
        .replace(/'([^'\\]|\\.)*'/g, "''")
        .replace(/"([^"\\]|\\.)*"/g, '""');
      const upper = strippedNoStrings.toUpperCase();
      const forbidden = /\b(DELETE|DROP|UPDATE|INSERT|ALTER|REPLACE|TRUNCATE|CREATE|ATTACH|DETACH)\b|;/i;
      if (forbidden.test(upper.replace(/;\s*$/, "")) || (!upper.startsWith("SELECT") && !upper.startsWith("PRAGMA"))) {
        return successResult({
          status: "ERROR",
          error_code: "DB-READONLY-VIOLATION",
          error: "Only read-only SELECT or PRAGMA queries are allowed.",
        });
      }

      const tableMap: Record<string, any[]> = {
        topic_bindings: Array.from(TOPIC_BINDINGS_DB.values()),
        audit_checkpoints: Array.from(AUDIT_CHECKPOINTS_DB.values()),
        migration_jobs: Array.from(MIGRATION_JOBS_DB.values()),
        processed_messages: Array.from(PROCESSED_MESSAGES_DB.values()),
        series_episodes: Array.from(SERIES_EPISODES_DB.entries()).map(([k, v]) => ({
          key: k,
          series_name: v.series_name,
          season_number: v.season_number,
          episode_count: v.episodes?.size || 0,
        })),
      };

      const lower = rawSql.toLowerCase();
      if (lower.includes("sqlite_master")) {
        return successResult({
          status: "SUCCESS",
          rows: Object.keys(tableMap).map((name) => ({ name })),
        });
      }

      for (const [tbl, rows] of Object.entries(tableMap)) {
        if (lower.includes(tbl)) {
          const limitMatch = lower.match(/\blimit\s+(\d+)/);
          const limit = limitMatch ? Math.min(Number(limitMatch[1]), 200) : 100;
          return successResult({
            status: "SUCCESS",
            table: tbl,
            count: Math.min(rows.length, limit),
            rows: rows.slice(0, limit),
          });
        }
      }

      return successResult({ status: "SUCCESS", rows: [] });
    }

    case "db_parity_check": {
      const bindings = Array.from(TOPIC_BINDINGS_DB.values());
      const jobs = Array.from(MIGRATION_JOBS_DB.values());
      const checkpoints = Array.from(AUDIT_CHECKPOINTS_DB.values());
      const chatFilter = args.chat_id ? String(args.chat_id) : null;
      const filteredBindings = chatFilter
        ? bindings.filter((b) => String(b.chat_id) === chatFilter)
        : bindings;

      return successResult({
        status: "SUCCESS",
        chat_id: chatFilter,
        counts: {
          topic_bindings: filteredBindings.length,
          processed_messages: PROCESSED_MESSAGES_DB.size,
          series_episodes: SERIES_EPISODES_DB.size,
          migration_jobs: jobs.length,
          audit_checkpoints: checkpoints.length,
        },
        bindings_missing_sync_cursor: filteredBindings
          .filter((b) => !b.last_synced_msg_id || Number(b.last_synced_msg_id) === 0)
          .slice(0, 50)
          .map((b) => ({ series_name: b.series_name, topic_id: b.topic_id, chat_id: b.chat_id })),
      });
    }

    default:
      return null;
  }
}
