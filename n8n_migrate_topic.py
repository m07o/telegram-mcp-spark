#!/usr/bin/env python3
"""
n8n Telegram topic migration step.

Usage:
  python n8n_migrate_topic.py --source masass18 --target egyxos

Each run migrates ONE topic (oldest-first, skipping done ones).
State is kept in an SQLite file (n8n_migration_state.sqlite) so you can
call this repeatedly from an n8n Schedule Trigger.

Exit codes:
  0  success (or nothing left to do)
  2  FloodWait — n8n should wait then retry (wait seconds printed to stdout)
  1  other failure
"""
import argparse
import asyncio
import json
import os
import sqlite3
import sys
import time

from telethon import TelegramClient, errors
from telethon.tl import functions, types

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "n8n_migration_state.sqlite")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS done_topics(
               topic_id INTEGER PRIMARY KEY,
               done_at TEXT DEFAULT (datetime('now'))
           )"""
    )
    conn.commit()
    return conn


async def resolve_target(client, target):
    """Accept a username or numeric id; return the entity."""
    try:
        return await client.get_entity(target)
    except ValueError:
        return await client.get_entity(int(target))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="source group (username or id), e.g. masass18")
    ap.add_argument("--target", required=True, help="target group (username or id), e.g. egyxos")
    args = ap.parse_args()

    env = {}
    env_file = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()

    api_id = int(os.environ.get("TELEGRAM_API_ID", env.get("TELEGRAM_API_ID", "")))
    api_hash = os.environ.get("TELEGRAM_API_HASH", env.get("TELEGRAM_API_HASH", ""))
    session_name = os.environ.get("TELEGRAM_SESSION_NAME", env.get("TELEGRAM_SESSION_NAME", "test_session"))

    client = TelegramClient(os.path.join(BASE_DIR, session_name), api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("ERROR: session not authorized. Run telegram-mcp once to log in.", flush=True)
        return 1

    src = await resolve_target(client, args.source)
    dst = await resolve_target(client, args.target)

    conn = get_db()
    done = {row[0] for row in conn.execute("SELECT topic_id FROM done_topics")}

    # List source topics via the forum channels API
    res = await client(functions.channels.GetForumTopicsRequest(
        channel=src, offset_date=0, offset_id=0, offset_topic=0, limit=100,
    ))
    topics = [t for t in res.topics if isinstance(t, types.ForumTopic)]
    pending = [t for t in topics if t.id not in done]
    if not pending:
        print(json.dumps({"status": "complete", "total": len(topics)}))
        conn.close()
        return 0

    done_count = len(done)
    pending_sorted = sorted(pending, key=lambda t: t.id)
    topic = pending_sorted[0]
    print(f"[{done_count + 1}/{len(topics)}] Migrating topic {topic.id}: {topic.title!r}", flush=True)

    # Ensure a matching topic exists in the target group
    try:
        new_topic = await client(functions.channels.CreateForumTopicRequest(
            channel=dst, title=topic.title, random_id=os.urandom(8) and int.from_bytes(os.urandom(8), "big"),
        ))
        new_topic_id = new_topic.updates[0].id
    except errors.FloodWaitError as e:
        print(f"FLOODWAIT {e.seconds}", flush=True)
        conn.close()
        return 2

    # Copy messages oldest->newest
    copied = 0
    try:
        async for msg in client.iter_messages(src, reverse=True, reply_to=topic.id, wait_time=1):
            if getattr(msg, "action", None) and not isinstance(
                msg.action, (types.MessageActionTopicCreated,)
            ):
                continue
            try:
                await client.send_message(
                    dst,
                    message=msg.message or None,
                    file=msg.media,
                    reply_to=new_topic_id,
                    formatting_entities=msg.entities,
                )
                copied += 1
                await asyncio.sleep(1.5)  # gentle pacing to avoid FloodWait
            except errors.FloodWaitError as e:
                print(f"FLOODWAIT {e.seconds} (after {copied} messages of topic {topic.id})", flush=True)
                conn.close()
                return 2
    except Exception as e:
        print(f"ERROR copying topic {topic.id}: {e}", flush=True)
        conn.close()
        return 1

    conn.execute("INSERT OR REPLACE INTO done_topics(topic_id) VALUES (?)", (topic.id,))
    conn.commit()
    conn.close()
    print(json.dumps({"status": "ok", "topic_id": topic.id, "title": topic.title, "messages": copied}))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
