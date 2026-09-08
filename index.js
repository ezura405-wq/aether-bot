require("dotenv").config();

const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ApplicationCommandOptionType
} = require("discord.js");
const { getProfile, updateProfile } = require("./database");

// Temporary test mode. Set to true only while testing activity XP locally.
const DEVELOPMENT_MODE = false;

// Production activity XP settings.
const PRODUCTION_ACTIVITY_INTERVAL_MS = 30 * 60 * 1000;
const PRODUCTION_XP_PER_ACTIVITY = 10;

// Development values make the activity system quick to test and are easy to remove later.
const ACTIVITY_INTERVAL_MS = DEVELOPMENT_MODE
  ? 60 * 1000
  : PRODUCTION_ACTIVITY_INTERVAL_MS;
const XP_PER_ACTIVITY = DEVELOPMENT_MODE
  ? 100
  : PRODUCTION_XP_PER_ACTIVITY;
const MAX_ACTIVITY_GAP_MS = 5 * 60 * 1000;
const REP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Add approved Discord user IDs here before using /chapter publish.
const APPROVED_AUTHOR_IDS = [];

// Each giver-recipient pair has its own reputation cooldown.
const reputationCooldowns = new Map();

// Level 1 starts at 0 XP, and each next level needs progressively more XP.
function xpForLevel(level) {
  return (level - 1) ** 2 * 100;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("clientReady", async () => {
  try {
    const commands = await client.application.commands.set([
      {
        name: "ping",
        description: "Replies with Pong!"
      },
      {
        name: "profile",
        description: "Shows your Aether profile"
      },
      {
        name: "rep",
        description: "Give a user reputation",
        options: [
          {
            name: "user",
            description: "The user who should receive reputation",
            type: ApplicationCommandOptionType.User,
            required: true
          }
        ]
      },
      {
        name: "chapter",
        description: "Publish a chapter announcement",
        options: [
          {
            name: "publish",
            description: "Publish a new chapter",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: "story",
                description: "The name of the story",
                type: ApplicationCommandOptionType.String,
                required: true
              },
              {
                name: "chapter",
                description: "The chapter number",
                type: ApplicationCommandOptionType.Integer,
                required: true
              },
              {
                name: "title",
                description: "The chapter title",
                type: ApplicationCommandOptionType.String,
                required: true
              },
              {
                name: "link",
                description: "A link to the chapter",
                type: ApplicationCommandOptionType.String,
                required: true
              },
              {
                name: "description",
                description: "An optional chapter description",
                type: ApplicationCommandOptionType.String,
                required: false
              }
            ]
          }
        ]
      }
    ]);

    console.log(`Registered ${commands.size} slash commands`);
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }

  console.log(`Aether is online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const now = Date.now();
  const profile = getProfile(message.author.id, message.guild.id);

  // Only count time between messages in a continuing activity session.
  // A long gap starts a new session instead of granting idle time.
  if (profile.last_activity_at > 0) {
    const elapsed = now - profile.last_activity_at;

    if (elapsed > 0 && elapsed <= MAX_ACTIVITY_GAP_MS) {
      profile.activity_ms += elapsed;
    } else if (elapsed > MAX_ACTIVITY_GAP_MS) {
      profile.activity_ms = 0;
    }
  }

  profile.last_activity_at = now;

  if (profile.activity_ms >= ACTIVITY_INTERVAL_MS) {
    const previousLevel = profile.level;
    profile.xp += XP_PER_ACTIVITY;
    profile.activity_ms = 0;

    // This is the only place that changes a user's level.
    while (profile.xp >= xpForLevel(profile.level + 1)) {
      profile.level += 1;
    }

    updateProfile(profile);

    if (profile.level > previousLevel) {
      message.channel.send(
        `🎉 ${message.author} reached Level ${profile.level}!`
      );
    }
    return;
  }

  // Save the activity timestamp and accumulated time after every qualifying message.
  updateProfile(profile);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    interaction.reply("Pong! 🤖");
    return;
  }

  if (!interaction.guildId) {
    interaction.reply({
      content: "Aether profile commands can only be used in a server.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "profile") {
    const profile = getProfile(interaction.user.id, interaction.guildId);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTitle("Aether Profile")
      .addFields(
        { name: "Reputation", value: String(profile.reputation), inline: true },
        { name: "XP", value: String(profile.xp), inline: true },
        { name: "Level", value: String(profile.level), inline: true },
        { name: "Chapters", value: String(profile.chapters), inline: true }
      );

    interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "rep") {
    const recipient = interaction.options.getUser("user", true);

    if (recipient.id === interaction.user.id) {
      interaction.reply({
        content: "You cannot give reputation to yourself.",
        ephemeral: true
      });
      return;
    }

    if (recipient.bot) {
      interaction.reply({
        content: "Bots cannot receive reputation.",
        ephemeral: true
      });
      return;
    }

    const cooldownKey = `${interaction.guildId}:${interaction.user.id}:${recipient.id}`;
    const lastRepAt = reputationCooldowns.get(cooldownKey) ?? 0;
    const timeSinceLastRep = Date.now() - lastRepAt;

    if (timeSinceLastRep < REP_COOLDOWN_MS) {
      const remainingHours = Math.ceil(
        (REP_COOLDOWN_MS - timeSinceLastRep) / (60 * 60 * 1000)
      );

      interaction.reply({
        content: `You can give reputation to this user again in about ${remainingHours} hour(s).`,
        ephemeral: true
      });
      return;
    }

    const profile = getProfile(recipient.id, interaction.guildId);
    profile.reputation += 1;
    updateProfile(profile);
    reputationCooldowns.set(cooldownKey, Date.now());

    interaction.reply({
      content: `You gave ${recipient} +1 reputation. They now have ${profile.reputation} reputation.`,
      ephemeral: false
    });
  }

  if (
    interaction.commandName === "chapter" &&
    interaction.options.getSubcommand() === "publish"
  ) {
    if (interaction.user.bot) {
      interaction.reply({
        content: "Bots cannot publish chapters.",
        ephemeral: true
      });
      return;
    }

    if (!APPROVED_AUTHOR_IDS.includes(interaction.user.id)) {
      interaction.reply({
        content: "You are not approved to publish chapters.",
        ephemeral: true
      });
      return;
    }

    const story = interaction.options.getString("story", true).trim();
    const chapterNumber = interaction.options.getInteger("chapter", true);
    const title = interaction.options.getString("title", true).trim();
    const link = interaction.options.getString("link", true).trim();
    const description = interaction.options.getString("description")?.trim();

    if (chapterNumber <= 0) {
      interaction.reply({
        content: "The chapter number must be positive.",
        ephemeral: true
      });
      return;
    }

    let chapterUrl;
    try {
      chapterUrl = new URL(link);
    } catch {
      interaction.reply({
        content: "The chapter link must be a valid HTTP or HTTPS URL.",
        ephemeral: true
      });
      return;
    }

    if (chapterUrl.protocol !== "http:" && chapterUrl.protocol !== "https:") {
      interaction.reply({
        content: "The chapter link must be a valid HTTP or HTTPS URL.",
        ephemeral: true
      });
      return;
    }

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      interaction.reply({
        content: "I cannot publish a chapter in this channel.",
        ephemeral: true
      });
      return;
    }

    const chapterEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${story} - Chapter ${chapterNumber}: ${title}`)
      .setURL(chapterUrl.toString())
      .addFields(
        { name: "Story", value: story, inline: true },
        { name: "Chapter", value: String(chapterNumber), inline: true },
        { name: "Author", value: interaction.user.toString(), inline: true }
      );

    if (description) {
      chapterEmbed.setDescription(description);
    }

    try {
      await interaction.deferReply({ ephemeral: true });
      await interaction.channel.send({ embeds: [chapterEmbed] });

      const profile = getProfile(interaction.user.id, interaction.guildId);
      profile.chapters += 1;
      updateProfile(profile);

      interaction.editReply("Chapter published successfully.");
    } catch (error) {
      console.error("Failed to publish chapter:", error);

      if (interaction.deferred) {
        interaction.editReply(
          "The chapter could not be published. Your chapter count was not changed."
        );
      } else {
        interaction.reply({
          content: "The chapter could not be published. Your chapter count was not changed.",
          ephemeral: true
        });
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);