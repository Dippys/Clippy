# 📎 Clippy

A Discord bot that sends you a DM whenever someone reacts with your tracked emoji on any message in the server. Quiet, private, and configurable — with a fully interactive setup experience.

---

## Features

- **Interactive Setup** — every command uses a visible, evolving embed with buttons that auto-cleans up when done.
- **React-to-Pick Emoji** — no typing emoji names; just react on the bot's message to select one.
- **Custom Messages** — set and update a personalized notification note via a pop-up modal, as many times as you want before confirming.
- **Per-User Config** — each person manages their own watchers; multiple users can track the same emoji.
- **Zero Server Clutter** — setup embeds auto-delete after completion or timeout. Notifications are always DMs.
- **Cooldowns** — you won't get spammed if the same emoji is reacted multiple times on the same message.
- **Up to 10 watchers** per user per server.

---

## Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** → name it **Clippy**.
3. Go to the **Bot** tab → click **Reset Token** → copy the token.
4. Under **Privileged Gateway Intents**, enable:
   - **MESSAGE CONTENT INTENT**
5. Go to the **OAuth2** tab → copy the **Client ID**.

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
DISCORD_TOKEN=your-bot-token-here
CLIENT_ID=your-client-id-here
```

### 3. Install & Build

```bash
npm install
npm run build
```

### 4. Register Slash Commands

```bash
npm run deploy
```

> Global commands can take up to 1 hour to appear in all servers.

### 5. Invite the Bot

Use this URL template (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=0&scope=bot%20applications.commands
```

The bot needs **no special permissions** — it only reads reactions and sends DMs.

### 6. Start the Bot

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

---

## Commands

All commands are under `/clippy`. Each one uses the slash command reply itself as an interactive embed with buttons — and auto-cleans when done.

| Command | Description |
| --- | --- |
| `/clippy watch` | Create a new watcher. React to pick your emoji, optionally add/update a custom message, then confirm. |
| `/clippy list` | View all your watchers with buttons to create new ones or remove existing ones. |
| `/clippy remove` | Select a watcher from a dropdown, then confirm deletion. |
| `/clippy test` | Send yourself a sample DM notification to make sure your DMs are open. |
| `/clippy help` | Show an in-channel help panel with command explanations and setup steps. |

---

## How It Works

1. A user runs `/clippy watch`.
2. The bot posts a temporary embed in the channel — the user **reacts** to it with any emoji.
3. The embed updates to a review screen with the selected emoji and default message, plus buttons: **Done**, **Cancel**, **Add Custom Message**.
4. Pressing **Add Custom Message** opens a modal to type/update the notification text. The button then becomes **Update Message** so you can keep tweaking it.
5. Press **Done** — the watcher is saved and the setup message auto-deletes.
6. From then on, whenever **anyone** in the server reacts with that emoji on any message, Clippy DMs the watcher with:
   - Who reacted
   - Message content preview
   - Server, channel, and message author info
   - A jump-to-message link
   - Their custom note
7. Each watcher is only notified **once per message per emoji** (cooldown).
8. The reactor themselves are never notified about their own reaction.

---

## Project Structure

```
src/
├── index.ts              # Entry point — client setup & event wiring
├── database.ts           # SQLite database (better-sqlite3) — schema & queries
├── constants.ts          # Brand color, limits, defaults
├── deploy.ts             # One-time slash command registration script
├── commands/
│   ├── handler.ts        # Routes slash commands + modal submissions
│   └── setup.ts          # /clippy watch | list | remove | test | help (interactive flows)
└── events/
    └── reactionAdd.ts    # Core logic — emoji matching, cooldowns, DMs
```

---

## License

MIT
