import {
  Interaction,
} from "discord.js";
import { handleWatch, handleWatchMessageModal, handleList, handleRemove, handleTest, handleHelp } from "./setup";

export async function handleInteraction(interaction: Interaction): Promise<void> {
  // ─── Modal submissions ───────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("clippy_msg_modal:")) {
      try {
        await handleWatchMessageModal(interaction);
      } catch (err) {
        console.error("Error handling watch message modal:", err);
        const content = "Something went wrong. Please try again!";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content, ephemeral: true });
        } else {
          await interaction.reply({ content, ephemeral: true });
        }
      }
    }
    return;
  }

  // ─── Slash commands ──────────────────────────────────────────────────
  if (!interaction.isChatInputCommand()) return;

  // Only work inside guilds
  if (!interaction.guildId) {
    await interaction.reply({
      content: "📎 Clippy only works inside servers, not in DMs!",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName !== "clippy") return;

  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case "watch":
        await handleWatch(interaction);
        break;
      case "list":
        await handleList(interaction);
        break;
      case "remove":
        await handleRemove(interaction);
        break;
      case "test":
        await handleTest(interaction);
        break;
      case "help":
        await handleHelp(interaction);
        break;
      default:
        await interaction.reply({
          content: "Unknown subcommand.",
          ephemeral: true,
        });
    }
  } catch (err) {
    console.error(`Error handling /${interaction.commandName} ${subcommand}:`, err);

    const content = "Something went wrong processing your command. Please try again!";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
}
