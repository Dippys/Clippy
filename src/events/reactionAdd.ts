import {
  Client,
  EmbedBuilder,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from "discord.js";
import {
  getWatchersByEmoji,
  hasCooldown,
  setCooldown,
  cleanOldCooldowns,
} from "../database";
import { BRAND_COLOR, FOOTER_TEXT } from "../constants";
import { pendingSetupMessages } from "../commands/setup";

// Clean up stale cooldowns every 30 minutes
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 30 * 60 * 1000;

export async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  client: Client
): Promise<void> {
  // Ignore reactions from bots
  if (user.bot) return;

  // Ensure reaction and message are fully fetched (partials)
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) await user.fetch();
  } catch (err) {
    console.error("Failed to fetch partial reaction/message:", err);
    return;
  }

  const message = reaction.message;
  const guildId = message.guildId;
  if (!guildId) return; // DM reaction, ignore

  // Skip reactions on active setup messages (emoji-pick flow)
  if (pendingSetupMessages.has(message.id)) return;

  // Determine the emoji identifier to match against the DB
  const emojiIdentifier = reaction.emoji.id
    ? `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name}:${reaction.emoji.id}>`
    : reaction.emoji.name;

  if (!emojiIdentifier) return;

  // Get all watchers in this guild for this emoji
  const watchers = getWatchersByEmoji(guildId, emojiIdentifier);
  if (watchers.length === 0) return;

  // Periodic cooldown cleanup
  if (Date.now() - lastCleanup > CLEANUP_INTERVAL) {
    cleanOldCooldowns();
    lastCleanup = Date.now();
  }

  // Build context for the notification
  const messageContent = message.content
    ? message.content.length > 200
      ? message.content.slice(0, 197) + "…"
      : message.content
    : "_No text content (may contain embeds or attachments)_";

  const channelName =
    message.channel && "name" in message.channel
      ? `#${message.channel.name}`
      : "Unknown channel";

  const guild = client.guilds.cache.get(guildId);
  const serverName = guild?.name ?? "Unknown server";
  const messageLink = `https://discord.com/channels/${guildId}/${message.channelId}/${message.id}`;

  for (const watcher of watchers) {
    // Don't notify the person who reacted (they already know)
    if (watcher.user_id === user.id) continue;

    // Cooldown: don't DM the same watcher for the same message+emoji combo
    if (hasCooldown(guildId, watcher.user_id, message.id, emojiIdentifier)) {
      continue;
    }

    // Set cooldown before sending to avoid races
    setCooldown(guildId, watcher.user_id, message.id, emojiIdentifier);

    // Build the DM embed
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle("📎 Emoji Reaction Alert")
      .setDescription(watcher.message)
      .addFields(
        { name: "Emoji", value: emojiIdentifier, inline: true },
        { name: "Server", value: serverName, inline: true },
        { name: "Channel", value: channelName, inline: true },
        { name: "Reacted By", value: `<@${user.id}>`, inline: true },
        {
          name: "Message Author",
          value: message.author ? `<@${message.author.id}>` : "Unknown",
          inline: true,
        },
        { name: "Message Preview", value: messageContent, inline: false },
        {
          name: "Jump to Message",
          value: `[Click here](${messageLink})`,
          inline: false,
        }
      )
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp();

    // Send the DM — silently fail if DMs are closed
    try {
      const targetUser = await client.users.fetch(watcher.user_id);
      await targetUser.send({ embeds: [embed] });
    } catch (err) {
      // User has DMs closed or bot can't reach them — nothing to do
      console.warn(
        `Could not DM user ${watcher.user_id} in guild ${guildId}:`,
        (err as Error).message
      );
    }
  }
}
