import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "clippy.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}

export function initDatabase(): void {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS watchers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      emoji       TEXT    NOT NULL,
      message     TEXT    NOT NULL DEFAULT 'Someone reacted with your tracked emoji!',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(guild_id, user_id, emoji)
    );
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_watchers_guild_emoji
    ON watchers (guild_id, emoji);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      emoji       TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, target_id, message_id, emoji)
    );
  `);
}

// ─── Watcher CRUD ────────────────────────────────────────────────────────────

export interface Watcher {
  id: number;
  guild_id: string;
  user_id: string;
  emoji: string;
  message: string;
  created_at: string;
}

export function addWatcher(
  guildId: string,
  userId: string,
  emoji: string,
  message: string
): void {
  const stmt = getDb().prepare(`
    INSERT INTO watchers (guild_id, user_id, emoji, message)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, emoji)
    DO UPDATE SET message = excluded.message
  `);
  stmt.run(guildId, userId, emoji, message);
}

export function removeWatcher(
  guildId: string,
  userId: string,
  emoji: string
): boolean {
  const stmt = getDb().prepare(`
    DELETE FROM watchers WHERE guild_id = ? AND user_id = ? AND emoji = ?
  `);
  const result = stmt.run(guildId, userId, emoji);
  return result.changes > 0;
}

export function removeWatcherById(id: number, userId: string): boolean {
  const stmt = getDb().prepare(`
    DELETE FROM watchers WHERE id = ? AND user_id = ?
  `);
  const result = stmt.run(id, userId);
  return result.changes > 0;
}

export function getWatchersForUser(
  guildId: string,
  userId: string
): Watcher[] {
  const stmt = getDb().prepare(`
    SELECT * FROM watchers WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `);
  return stmt.all(guildId, userId) as Watcher[];
}

export function getWatchersByEmoji(
  guildId: string,
  emoji: string
): Watcher[] {
  const stmt = getDb().prepare(`
    SELECT * FROM watchers WHERE guild_id = ? AND emoji = ?
  `);
  return stmt.all(guildId, emoji) as Watcher[];
}

export function getWatcherCount(guildId: string, userId: string): number {
  const stmt = getDb().prepare(`
    SELECT COUNT(*) as count FROM watchers WHERE guild_id = ? AND user_id = ?
  `);
  const row = stmt.get(guildId, userId) as { count: number };
  return row.count;
}

export function hasWatcherForUserEmoji(
  guildId: string,
  userId: string,
  emoji: string
): boolean {
  const stmt = getDb().prepare(`
    SELECT 1 FROM watchers WHERE guild_id = ? AND user_id = ? AND emoji = ?
  `);
  return !!stmt.get(guildId, userId, emoji);
}

// ─── Cooldown management ─────────────────────────────────────────────────────

export function hasCooldown(
  guildId: string,
  targetId: string,
  messageId: string,
  emoji: string
): boolean {
  const stmt = getDb().prepare(`
    SELECT 1 FROM cooldowns
    WHERE guild_id = ? AND target_id = ? AND message_id = ? AND emoji = ?
  `);
  return !!stmt.get(guildId, targetId, messageId, emoji);
}

export function setCooldown(
  guildId: string,
  targetId: string,
  messageId: string,
  emoji: string
): void {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO cooldowns (guild_id, user_id, target_id, message_id, emoji)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(guildId, targetId, targetId, messageId, emoji);
}

export function cleanOldCooldowns(): void {
  const stmt = getDb().prepare(`
    DELETE FROM cooldowns WHERE created_at < datetime('now', '-1 hour')
  `);
  stmt.run();
}
