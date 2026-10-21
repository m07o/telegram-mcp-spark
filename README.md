<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=200&section=header&text=Telegram%20MCP%20Server&fontSize=50&fontAlignY=35&animation=fadeIn&fontColor=FFFFFF&descAlignY=55&descAlign=62" alt="Telegram MCP Server" width="100%" />
</div>

![MCP Badge](https://badge.mcpx.dev)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square)](https://opensource.org/licenses/Apache-2.0)

A comprehensive Telegram integration for Gemini, Claude, Cursor, and other MCP-compatible clients. It exposes Telegram account, chat, message, contact, media, folder, and admin operations through the [Model Context Protocol](https://modelcontextprotocol.io/) using [Telethon](https://docs.telethon.dev/) and Cloudflare Workers (MTProto via GramJS WebSockets).

## 📖 Complete Documentation & Guides

- **[TOOLS_GUIDE.md](TOOLS_GUIDE.md):** Complete guide in Arabic documenting all 170 MCP tools across 14 modules.
- **[ARCHITECTURE.md](ARCHITECTURE.md):** Architectural design and execution pipeline.
- **[AGENTS_GUIDE.md](AGENTS_GUIDE.md):** Operational guidelines for autonomous agents and subagents.

## Contents

- [What It Can Do](#what-it-can-do)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [MCP Client Configuration](#mcp-client-configuration)
- [Multi-Account Setup](#multi-account-setup)
- [Device Identity](#device-identity)
- [Proxy Support](#proxy-support)
- [File Path Security](#file-path-security)
- [Cloudflare Workers Deployment](#cloudflare-workers-deployment)
- [Security Notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What It Can Do

The server currently includes 170 MCP tools grouped into these 14 areas:

- **Accounts:** list configured accounts and route tool calls by account label.
- **Chats and groups:** list chats, inspect metadata, create groups/channels, join or leave chats, invite users, manage admins, bans, default permissions, slow mode, topics, invite links, common chats, read receipts, and message links.
- **Messages:** send, schedule, edit, delete, forward, pin, unpin, mark read, reply, search, inspect context, create polls, manage reactions, inspect inline buttons, and press inline callbacks.
- **Contacts:** list, search, add, delete, block, unblock, import, export, inspect direct chats, and find recent contact interactions.
- **Media:** send files, download media, upload files, send voice notes, stickers, GIFs, and inspect message media.
- **Profile and privacy:** get your own account info, update profile fields, set or delete profile photos, inspect privacy settings, get user info/photos/status, and manage bot commands.
- **Folders and drafts:** list, create, update, reorder, and delete Telegram folders; save, list, and clear drafts.
- **Discovery:** `list_tool_categories` and `search_tools` let MCP clients browse or search the tool catalog by keyword/category without loading every tool schema into context.
- **Migration & Autonomous Pipeline:** autonomous topic-by-topic migration between forum supergroups with 3-offset pagination, noise cleanup, incremental copying, and strict chronological reordering.

All tool results that include Telegram user-controlled content are sanitized and returned as structured JSON.

## Requirements

- Python 3.10+ (for local Telethon server) or Node.js / Cloudflare Workers runtime (for edge deployment)
- Telegram API credentials from [my.telegram.org/apps](https://my.telegram.org/apps)
- A Telegram session string
- An MCP client such as Gemini, Claude Desktop, Cursor, or Spark

## Quick Start (Python Local Server)

### 1. Install Dependencies
```bash
uv sync
```

### 2. Generate a Session String
```bash
uv run session_string_generator.py --qr
```

### 3. Configure Environment
```bash
cp .env.example .env
```
Fill in `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `TELEGRAM_SESSION_STRING`.

### 4. Run the Server
```bash
uv run main.py
```

## Cloudflare Workers Deployment

This repository includes a standalone Cloudflare Worker (`worker.ts`) that implements MTProto via GramJS over official Telegram WebSockets gateways (WSS FQDN):

```bash
npm install
npx wrangler secret put TELEGRAM_API_ID
npx wrangler secret put TELEGRAM_API_HASH
npx wrangler secret put TELEGRAM_SESSION_STRING
npx wrangler deploy
```

The server provides:
- SSE endpoint at `GET /sse`
- JSON-RPC handler at `POST /messages`
- Health check at `GET /health`

## Security Notes

- Never commit `.env`, session strings, or `*.session` files.
- All SQLite caches (`*.db`, `*.sqlite*`) are excluded via `.gitignore`.
- User-generated Telegram content is sanitized before being returned to MCP clients.

## License

This project is licensed under the [Apache 2.0 License](LICENSE).
