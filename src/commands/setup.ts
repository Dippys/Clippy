import {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  Message,
} from "discord.js";
import {
  addWatcher,
  hasWatcherForUserEmoji,
  getWatcherCount,
  getWatchersForUser,
  removeWatcherById,
  Watcher,
} from "../database";
import {
  BRAND_COLOR,
  FOOTER_TEXT,
  MAX_WATCHERS_PER_USER,
  CUSTOM_MESSAGE_MAX_LENGTH,
  DEFAULT_DM_MESSAGE,
} from "../constants";

/** Message IDs currently used for emoji-pick setup — the reaction handler skips these. */
export const pendingSetupMessages = new Set<string>();

/**
 * Tracks in-flight watch setups so we can map modal submissions
 * back to the correct setup message + state.
 */
interface WatchSetupState {
  guildId: string;
  userId: string;
  setupMsg: Message;
  emoji: string | null;
  customMessage: string;
}
const activeSetups = new Map<string, WatchSetupState>();

// ─── Embed builders for each step ────────────────────────────────────────────

function stepOneEmbed(userId: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("📎 New Watcher — Step 1")
    .setDescription(
      `<@${userId}>, react to **this message** with the emoji you want to track.`
    )
    .setFooter({ text: "Waiting for your reaction… • " + FOOTER_TEXT });
}

function stepTwoEmbed(emoji: string, customMessage: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("📎 New Watcher — Review")
    .setDescription("Looking good! Review your watcher below.")
    .addFields(
      { name: "Emoji", value: emoji, inline: true },
      { name: "Notification Message", value: customMessage, inline: false }
    )
    .setFooter({ text: FOOTER_TEXT });
}

function actionButtons(hasCustomMessage: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("clippy_watch_done")
      .setLabel("Done")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId("clippy_watch_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("✖️"),
    new ButtonBuilder()
      .setCustomId("clippy_watch_message")
      .setLabel(hasCustomMessage ? "Update Message" : "Add Custom Message")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("✏️")
  );
  return row;
}

// ─── /clippy watch ───────────────────────────────────────────────────────────

export async function handleWatch(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  // Check watcher limit
  const count = getWatcherCount(guildId, userId);
  if (count >= MAX_WATCHERS_PER_USER) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Limit Reached",
          `You can track up to **${MAX_WATCHERS_PER_USER}** emojis per server. Remove one first with \`/clippy remove\`.`
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  let setupMsg: Message;
  setupMsg = await interaction.reply({
    embeds: [stepOneEmbed(userId)],
    fetchReply: true,
  }) as Message;

  pendingSetupMessages.add(setupMsg.id);

  // Store setup state keyed by the setup message ID
  const state: WatchSetupState = {
    guildId,
    userId,
    setupMsg,
    emoji: null,
    customMessage: DEFAULT_DM_MESSAGE,
  };
  activeSetups.set(setupMsg.id, state);

  // ─── Step 1 : wait for a reaction ──────────────────────────────────
  try {
    const collected = await setupMsg.awaitReactions({
      filter: (_r, u) => u.id === userId,
      max: 1,
      time: 60_000,
      errors: ["time"],
    });

    const reaction = collected.first()!;
    state.emoji = reaction.emoji.id
      ? `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name!;
  } catch {
    await cleanup(state, "Timed Out", "You didn't react in time. Run `/clippy watch` again.");
    return;
  }

  // ─── Step 2 : show review embed + buttons ──────────────────────────
  try {
    await setupMsg.reactions.removeAll().catch(() => {});
  } catch { /* missing perms — cosmetic only */ }

  await setupMsg.edit({
    embeds: [stepTwoEmbed(state.emoji!, state.customMessage)],
    components: [actionButtons(false)],
  });

  // ─── Collect button presses in a loop ──────────────────────────────
  const collector = setupMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === userId,
    time: 120_000, // 2 min total to finish
  });

  collector.on("collect", async (btnInteraction: ButtonInteraction) => {
    try {
      switch (btnInteraction.customId) {
        case "clippy_watch_done": {
          const watcherExists = hasWatcherForUserEmoji(
            state.guildId,
            state.userId,
            state.emoji!
          );
          const latestCount = getWatcherCount(state.guildId, state.userId);

          if (!watcherExists && latestCount >= MAX_WATCHERS_PER_USER) {
            collector.stop("limit");
            await btnInteraction.update({
              embeds: [
                errorEmbed(
                  "Limit Reached",
                  `You already have **${MAX_WATCHERS_PER_USER}** watchers. Remove one first with \`/clippy remove\`.`
                ),
              ],
              components: [],
            });
            setTimeout(() => setupMsg.delete().catch(() => {}), 5_000);
            break;
          }

          addWatcher(state.guildId, state.userId, state.emoji!, state.customMessage);
          collector.stop("done");

          await btnInteraction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(BRAND_COLOR)
                .setTitle("📎 Watcher Created")
                .setDescription(
                  `You'll be DM'd whenever someone reacts with ${state.emoji} on any message in this server.`
                )
                .addFields(
                  { name: "Emoji", value: state.emoji!, inline: true },
                  { name: "Notification Message", value: state.customMessage, inline: false }
                )
                .setFooter({ text: FOOTER_TEXT })
                .setTimestamp(),
            ],
            components: [],
          });

          // Delete after a short delay so the user sees the confirmation
          setTimeout(() => setupMsg.delete().catch(() => {}), 5_000);
          break;
        }

        case "clippy_watch_cancel": {
          collector.stop("cancel");
          await btnInteraction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle("📎 Setup Cancelled")
                .setDescription("No watcher was created.")
                .setFooter({ text: FOOTER_TEXT }),
            ],
            components: [],
          });
          setTimeout(() => setupMsg.delete().catch(() => {}), 3_000);
          break;
        }

        case "clippy_watch_message": {
          // Show a modal to type / update the custom message
          const modal = new ModalBuilder()
            .setCustomId(`clippy_msg_modal:${setupMsg.id}`)
            .setTitle("📎 Custom Notification Message");

          const input = new TextInputBuilder()
            .setCustomId("clippy_custom_message")
            .setLabel("Message shown in your DM notification")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("e.g. Someone needs your attention!")
            .setValue(state.customMessage)
            .setMaxLength(CUSTOM_MESSAGE_MAX_LENGTH)
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(input)
          );

          await btnInteraction.showModal(modal);
          break;
        }
      }
    } catch (err) {
      console.error("Error in watch setup button handler:", err);
    }
  });

  collector.on("end", (_collected, reason) => {
    pendingSetupMessages.delete(setupMsg.id);
    activeSetups.delete(setupMsg.id);

    if (reason === "time") {
      setupMsg
        .edit({
          embeds: [
            errorEmbed("Timed Out", "The setup expired. Run `/clippy watch` again."),
          ],
          components: [],
        })
        .catch(() => {});
      setTimeout(() => setupMsg.delete().catch(() => {}), 5_000);
    }
  });
}

// ─── Handle custom-message modal submission ──────────────────────────────────

export async function handleWatchMessageModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  // customId format: clippy_msg_modal:<setupMsgId>
  const setupMsgId = interaction.customId.split(":")[1];
  const state = activeSetups.get(setupMsgId);

  if (!state) {
    await interaction.reply({
      embeds: [
        errorEmbed("Session Expired", "That setup session is no longer active. Start a new one with `/clippy watch`."),
      ],
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== state.userId) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Not Your Setup",
          "This setup belongs to another user. Start your own with `/clippy watch`."
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const newMessage =
    interaction.fields.getTextInputValue("clippy_custom_message").trim() || DEFAULT_DM_MESSAGE;
  state.customMessage = newMessage;

  // Update the embed to reflect the new message — the modal response *must*
  // update the message the button was on, which is the setupMsg.
  await interaction.deferUpdate();
  await state.setupMsg.edit({
    embeds: [stepTwoEmbed(state.emoji!, state.customMessage)],
    components: [actionButtons(true)],
  });
}

// ─── /clippy list ────────────────────────────────────────────────────────────

export async function handleList(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  const watchers = getWatchersForUser(guildId, userId);

  if (watchers.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle("📎 Your Watchers")
          .setDescription(
            "You don't have any emoji watchers set up yet.\nUse `/clippy watch` to get started!"
          )
          .setFooter({ text: FOOTER_TEXT })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
    return;
  }

  const lines = watchers.map(
    (w, i) =>
      `**${i + 1}.** ${w.emoji} — _"${truncate(w.message, 80)}"_`
  );

  const listEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("📎 Your Watchers")
    .setDescription(lines.join("\n"))
    .setFooter({
      text: `${watchers.length}/${MAX_WATCHERS_PER_USER} slots used • ${FOOTER_TEXT}`,
    })
    .setTimestamp();

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("clippy_list_new")
      .setLabel("Create New")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕"),
    new ButtonBuilder()
      .setCustomId("clippy_list_remove")
      .setLabel("Remove One")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🗑️"),
    new ButtonBuilder()
      .setCustomId("clippy_list_close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("✖️")
  );

  let listMsg: Message;
  listMsg = await interaction.reply({
    embeds: [listEmbed],
    components: [buttons],
    fetchReply: true,
  }) as Message;

  const collector = listMsg.createMessageComponentCollector({
    filter: (i) => i.user.id === userId,
    time: 60_000,
  });

  collector.on("collect", async (btnInteraction) => {
    try {
      if (!btnInteraction.isButton()) return;

      switch (btnInteraction.customId) {
        case "clippy_list_close": {
          collector.stop("closed");
          await btnInteraction.deferUpdate().catch(() => {});
          await listMsg.delete().catch(() => {});
          break;
        }

        case "clippy_list_new": {
          collector.stop("new");
          await btnInteraction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(BRAND_COLOR)
                .setTitle("📎 Create a Watcher")
                .setDescription("Run `/clippy watch` to set up a new emoji watcher!")
                .setFooter({ text: FOOTER_TEXT }),
            ],
            components: [],
          });
          setTimeout(() => listMsg.delete().catch(() => {}), 5_000);
          break;
        }

        case "clippy_list_remove": {
          collector.stop("remove");
          // Transition into remove flow on the same message
          const currentWatchers = getWatchersForUser(guildId, userId);
          if (currentWatchers.length === 0) {
            await btnInteraction.update({
              embeds: [errorEmbed("Nothing to Remove", "All watchers have already been removed.")],
              components: [],
            });
            setTimeout(() => listMsg.delete().catch(() => {}), 5_000);
            return;
          }

          const options = currentWatchers.map((w) => ({
            label: `${emojiLabel(w.emoji)} — "${truncate(w.message, 50)}"`,
            description: `Created ${w.created_at}`,
            value: w.id.toString(),
          }));

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("clippy_list_remove_select")
            .setPlaceholder("Select a watcher to remove…")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);

          const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
          const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("clippy_list_remove_cancel")
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("✖️")
          );

          await btnInteraction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(BRAND_COLOR)
                .setTitle("📎 Remove a Watcher")
                .setDescription("Pick the watcher you'd like to delete.")
                .setFooter({ text: FOOTER_TEXT }),
            ],
            components: [selectRow, cancelRow],
          });

          // Nested collector for the select menu / cancel
          const removeCollector = listMsg.createMessageComponentCollector({
            filter: (i) => i.user.id === userId,
            time: 60_000,
          });

          removeCollector.on("collect", async (subInteraction) => {
            try {
              if (subInteraction.isStringSelectMenu() && subInteraction.customId === "clippy_list_remove_select") {
                const selectedId = parseInt(subInteraction.values[0], 10);
                const removed = removeWatcherById(selectedId, userId);
                removeCollector.stop("selected");

                if (removed) {
                  await subInteraction.update({
                    embeds: [
                      new EmbedBuilder()
                        .setColor(BRAND_COLOR)
                        .setTitle("📎 Watcher Removed")
                        .setDescription("Your watcher has been successfully deleted.")
                        .setFooter({ text: FOOTER_TEXT })
                        .setTimestamp(),
                    ],
                    components: [],
                  });
                } else {
                  await subInteraction.update({
                    embeds: [errorEmbed("Not Found", "That watcher was already removed.")],
                    components: [],
                  });
                }
                setTimeout(() => listMsg.delete().catch(() => {}), 5_000);
              } else if (subInteraction.isButton() && subInteraction.customId === "clippy_list_remove_cancel") {
                removeCollector.stop("cancel");
                await subInteraction.update({
                  embeds: [
                    new EmbedBuilder()
                      .setColor(BRAND_COLOR)
                      .setTitle("📎 Cancelled")
                      .setDescription("No changes were made.")
                      .setFooter({ text: FOOTER_TEXT }),
                  ],
                  components: [],
                });
                setTimeout(() => listMsg.delete().catch(() => {}), 3_000);
              }
            } catch (err) {
              console.error("Error in list-remove flow:", err);
            }
          });

          removeCollector.on("end", (_c, reason) => {
            if (reason === "time") {
              listMsg.edit({
                embeds: [errorEmbed("Timed Out", "The selection expired.")],
                components: [],
              }).catch(() => {});
              setTimeout(() => listMsg.delete().catch(() => {}), 5_000);
            }
          });
          break;
        }
      }
    } catch (err) {
      console.error("Error in list button handler:", err);
    }
  });

  collector.on("end", (_collected, reason) => {
    if (reason === "time") {
      listMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle("📎 Your Watchers")
            .setDescription(lines.join("\n"))
            .setFooter({
              text: `Expired • ${watchers.length}/${MAX_WATCHERS_PER_USER} slots used • ${FOOTER_TEXT}`,
            }),
        ],
        components: [],
      }).catch(() => {});
      setTimeout(() => listMsg.delete().catch(() => {}), 5_000);
    }
  });
}

// ─── /clippy remove ──────────────────────────────────────────────────────────

export async function handleRemove(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  const watchers = getWatchersForUser(guildId, userId);

  if (watchers.length === 0) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Nothing to Remove",
          "You don't have any emoji watchers in this server."
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const options = watchers.map((w) => ({
    label: `${emojiLabel(w.emoji)} — "${truncate(w.message, 50)}"`,
    description: `Created ${w.created_at}`,
    value: w.id.toString(),
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("clippy_remove_select")
    .setPlaceholder("Select a watcher to remove…")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("clippy_remove_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("✖️")
  );

  let removeMsg: Message;
  removeMsg = await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle("📎 Remove a Watcher")
        .setDescription(
          `<@${userId}>, select the watcher you'd like to delete.`
        )
        .setFooter({ text: FOOTER_TEXT }),
    ],
    components: [selectRow, cancelRow],
    fetchReply: true,
  }) as Message;

  // Collect the select-menu choice or cancel
  const collector = removeMsg.createMessageComponentCollector({
    filter: (i) => i.user.id === userId,
    time: 60_000,
  });

  let selectedWatcher: Watcher | undefined;

  collector.on("collect", async (subInteraction) => {
    try {
      if (subInteraction.isStringSelectMenu() && subInteraction.customId === "clippy_remove_select") {
        const selectedId = parseInt(subInteraction.values[0], 10);
        selectedWatcher = watchers.find((w) => w.id === selectedId);

        if (!selectedWatcher) {
          collector.stop("error");
          await subInteraction.update({
            embeds: [errorEmbed("Not Found", "That watcher no longer exists.")],
            components: [],
          });
          setTimeout(() => removeMsg.delete().catch(() => {}), 5_000);
          return;
        }

        // Show confirmation
        const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("clippy_remove_confirm")
            .setLabel("Confirm Delete")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🗑️"),
          new ButtonBuilder()
            .setCustomId("clippy_remove_back")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("✖️")
        );

        await subInteraction.update({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("📎 Confirm Removal")
              .setDescription("Are you sure you want to delete this watcher?")
              .addFields(
                { name: "Emoji", value: selectedWatcher.emoji, inline: true },
                { name: "Message", value: selectedWatcher.message, inline: false }
              )
              .setFooter({ text: FOOTER_TEXT }),
          ],
          components: [confirmRow],
        });
      } else if (subInteraction.isButton()) {
        switch (subInteraction.customId) {
          case "clippy_remove_confirm": {
            if (selectedWatcher) {
              removeWatcherById(selectedWatcher.id, userId);
            }
            collector.stop("confirmed");
            await subInteraction.update({
              embeds: [
                new EmbedBuilder()
                  .setColor(BRAND_COLOR)
                  .setTitle("📎 Watcher Removed")
                  .setDescription("Your watcher has been successfully deleted.")
                  .setFooter({ text: FOOTER_TEXT })
                  .setTimestamp(),
              ],
              components: [],
            });
            setTimeout(() => removeMsg.delete().catch(() => {}), 5_000);
            break;
          }

          case "clippy_remove_back":
          case "clippy_remove_cancel": {
            collector.stop("cancel");
            await subInteraction.update({
              embeds: [
                new EmbedBuilder()
                  .setColor(BRAND_COLOR)
                  .setTitle("📎 Cancelled")
                  .setDescription("No changes were made.")
                  .setFooter({ text: FOOTER_TEXT }),
              ],
              components: [],
            });
            setTimeout(() => removeMsg.delete().catch(() => {}), 3_000);
            break;
          }
        }
      }
    } catch (err) {
      console.error("Error in remove flow:", err);
    }
  });

  collector.on("end", (_collected, reason) => {
    if (reason === "time") {
      removeMsg.edit({
        embeds: [errorEmbed("Timed Out", "The selection expired. Run `/clippy remove` again.")],
        components: [],
      }).catch(() => {});
      setTimeout(() => removeMsg.delete().catch(() => {}), 5_000);
    }
  });
}

// ─── /clippy test ────────────────────────────────────────────────────────────

export async function handleTest(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;

  const serverName = interaction.guild?.name ?? "Unknown";
  const channelName =
    interaction.channel && "name" in interaction.channel
      ? `#${interaction.channel.name}`
      : "unknown";

  let testMsg: Message;
  testMsg = await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle("📎 Test Notification")
        .setDescription(
          `<@${userId}>, this will send a sample DM so you can see what Clippy notifications look like.`
        )
        .addFields(
          { name: "Server", value: serverName, inline: true },
          { name: "Channel", value: channelName, inline: true }
        )
        .setFooter({ text: FOOTER_TEXT }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("clippy_test_send")
          .setLabel("Send Test DM")
          .setStyle(ButtonStyle.Success)
          .setEmoji("📨"),
        new ButtonBuilder()
          .setCustomId("clippy_test_cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("✖️")
      ),
    ],
    fetchReply: true,
  }) as Message;

  const collector = testMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === userId,
    time: 30_000,
  });

  collector.on("collect", async (btnInteraction) => {
    try {
      switch (btnInteraction.customId) {
        case "clippy_test_send": {
          collector.stop("sent");

          const dmEmbed = new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle("📎 Emoji Reaction Alert")
            .setDescription(DEFAULT_DM_MESSAGE)
            .addFields(
              { name: "Emoji", value: "⭐", inline: true },
              { name: "Server", value: serverName, inline: true },
              { name: "Channel", value: channelName, inline: true },
              { name: "Reacted By", value: `<@${userId}>`, inline: true },
              { name: "Message Author", value: `<@${userId}>`, inline: true },
              { name: "Message Preview", value: "_This is an example message content…_", inline: false },
              { name: "Jump to Message", value: "[Click here](https://discord.com)", inline: false }
            )
            .setFooter({ text: "This is a test • " + FOOTER_TEXT })
            .setTimestamp();

          try {
            const user = await interaction.client.users.fetch(userId);
            await user.send({ embeds: [dmEmbed] });

            await btnInteraction.update({
              embeds: [
                new EmbedBuilder()
                  .setColor(BRAND_COLOR)
                  .setTitle("📎 Test Sent!")
                  .setDescription("Check your DMs — a sample notification was sent.")
                  .setFooter({ text: FOOTER_TEXT })
                  .setTimestamp(),
              ],
              components: [],
            });
          } catch {
            await btnInteraction.update({
              embeds: [
                errorEmbed(
                  "Can't DM You",
                  "I wasn't able to send you a DM. Make sure your DMs are open for this server."
                ),
              ],
              components: [],
            });
          }

          setTimeout(() => testMsg.delete().catch(() => {}), 5_000);
          break;
        }

        case "clippy_test_cancel": {
          collector.stop("cancel");
          await btnInteraction.update({
            embeds: [
              new EmbedBuilder()
                .setColor(BRAND_COLOR)
                .setTitle("📎 Cancelled")
                .setDescription("No test DM was sent.")
                .setFooter({ text: FOOTER_TEXT }),
            ],
            components: [],
          });
          setTimeout(() => testMsg.delete().catch(() => {}), 3_000);
          break;
        }
      }
    } catch (err) {
      console.error("Error in test button handler:", err);
    }
  });

  collector.on("end", (_collected, reason) => {
    if (reason === "time") {
      testMsg.edit({
        embeds: [errorEmbed("Timed Out", "The test prompt expired. Run `/clippy test` again.")],
        components: [],
      }).catch(() => {});
      setTimeout(() => testMsg.delete().catch(() => {}), 5_000);
    }
  });
}

// ─── /clippy help ────────────────────────────────────────────────────────────

export async function handleHelp(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const userId = interaction.user.id;

  const helpEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle("📎 Clippy Help")
    .setDescription("Set up emoji reaction DMs with interactive flows.")
    .addFields(
      {
        name: "Commands",
        value:
          "• `/clippy watch` — create a watcher (react to pick emoji)\n" +
          "• `/clippy list` — view watchers and quick actions\n" +
          "• `/clippy remove` — delete a watcher with confirmation\n" +
          "• `/clippy test` — send yourself a sample DM\n" +
          "• `/clippy help` — show this help panel",
        inline: false,
      },
      {
        name: "How Watch Setup Works",
        value:
          "1) Run `/clippy watch`\n" +
          "2) React to Clippy's setup message with your emoji\n" +
          "3) Optionally add/update custom DM message\n" +
          "4) Press **Done** to save",
        inline: false,
      },
      {
        name: "Notes",
        value:
          `• Max **${MAX_WATCHERS_PER_USER}** watchers per user per server\n` +
          "• Setup messages auto-clean after completion/timeout\n" +
          "• Notifications are sent in DMs (no channel spam)",
        inline: false,
      }
    )
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("clippy_help_close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("✖️")
  );

  let helpMsg: Message;
  helpMsg = await interaction.reply({
    embeds: [helpEmbed],
    components: [buttonRow],
    fetchReply: true,
  }) as Message;

  const collector = helpMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === userId,
    time: 90_000,
  });

  collector.on("collect", async (btnInteraction) => {
    try {
      if (btnInteraction.customId === "clippy_help_close") {
        collector.stop("closed");
        await btnInteraction.deferUpdate().catch(() => {});
        await helpMsg.delete().catch(() => {});
      }
    } catch (err) {
      console.error("Error in help button handler:", err);
    }
  });

  collector.on("end", (_collected, reason) => {
    if (reason === "time") {
      helpMsg.edit({
        embeds: [errorEmbed("Timed Out", "The help panel expired. Run `/clippy help` again.")],
        components: [],
      }).catch(() => {});
      setTimeout(() => helpMsg.delete().catch(() => {}), 5_000);
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function cleanup(state: WatchSetupState, title: string, desc: string): Promise<void> {
  pendingSetupMessages.delete(state.setupMsg.id);
  activeSetups.delete(state.setupMsg.id);
  await state.setupMsg.edit({
    embeds: [errorEmbed(title, desc)],
    components: [],
  }).catch(() => {});
  setTimeout(() => state.setupMsg.delete().catch(() => {}), 5_000);
}

function errorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xed4245) // Discord red
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setFooter({ text: FOOTER_TEXT });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function emojiLabel(emoji: string): string {
  // For custom emojis like <:name:123>, extract just the name
  const match = emoji.match(/^<a?:(\w+):\d+>$/);
  return match ? `:${match[1]}:` : emoji;
}
