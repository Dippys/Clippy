/**
 * Run this script once to register slash commands with Discord.
 *
 *   npm run deploy
 */

import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
import { getRequiredEnv } from "./env";
import { logError, logInfo } from "./logger";

dotenv.config();

const token = getRequiredEnv("DISCORD_TOKEN");
const clientId = getRequiredEnv("CLIENT_ID");

const commands = [
  new SlashCommandBuilder()
    .setName("clippy")
    .setDescription("Manage your Clippy emoji reaction notifications.")
    .addSubcommand((sub) =>
      sub
        .setName("watch")
        .setDescription(
          "Start watching an emoji — you'll pick the emoji and set your message."
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("View all your active emoji watchers in this server.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove one of your emoji watchers.")
    )
    .addSubcommand((sub) =>
      sub
        .setName("test")
        .setDescription(
          "Send yourself a test DM to make sure notifications work."
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("help")
        .setDescription("Show how Clippy works and all available commands.")
    )
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    logInfo("Registering slash commands...");

    await rest.put(Routes.applicationCommands(clientId), { body: commands });

    logInfo("Slash commands registered globally");
    logInfo("Note: Global commands can take up to 1 hour to propagate");
  } catch (err) {
    logError("Failed to register commands", err);
    process.exit(1);
  }
})();
