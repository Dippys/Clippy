import { ActivityType, Client, GatewayIntentBits, Partials, Events } from "discord.js";
import dotenv from "dotenv";
import { initDatabase, closeDatabase } from "./database";
import { handleInteraction } from "./commands/handler";
import { handleReactionAdd } from "./events/reactionAdd";
import { getRequiredEnv } from "./env";
import { logError, logInfo, logWarn } from "./logger";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  readyClient.user.setPresence({
    activities: [
      {
        name: "Watching for 📎 reactions",
        type: ActivityType.Watching,
      },
    ],
    status: "online",
  });

  logInfo(`Clippy is online as ${readyClient.user.tag}`);
  logInfo(`Watching ${readyClient.guilds.cache.size} server(s)`);
});

// Handle slash command interactions
client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(interaction);
});

// Handle reaction adds — the core feature
client.on(Events.MessageReactionAdd, (reaction, user) => {
  handleReactionAdd(reaction, user, client);
});

async function main() {
  const token = getRequiredEnv("DISCORD_TOKEN");

  initDatabase();
  logInfo("Database initialized");

  await client.login(token);
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logWarn(`Received ${signal}. Shutting down gracefully...`);

  try {
    if (client.isReady()) {
      client.destroy();
      logInfo("Discord client destroyed");
    }
  } catch (err) {
    logError("Error while destroying client", err);
  }

  try {
    closeDatabase();
    logInfo("Database connection closed");
  } catch (err) {
    logError("Error while closing database", err);
  }

  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  logError("Uncaught exception", error);
  void shutdown("uncaughtException");
});

main().catch((err) => {
  logError("Fatal startup error", err);
  process.exit(1);
});
