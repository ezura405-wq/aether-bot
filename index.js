require("dotenv").config();

const { Client, EmbedBuilder, GatewayIntentBits } = require("discord.js");

const profiles = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

client.once("ready", async () => {
  try {
    const commands = await client.application.commands.set([
      {
        name: "ping",
        description: "Replies with Pong!"
      },
      {
        name: "profile",
        description: "Shows your Aether profile"
      }
    ]);

    console.log(`Registered ${commands.size} slash commands`);
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }

  console.log(`Aether is online as ${client.user.tag}`);
});

client.on("interactionCreate", (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    interaction.reply("Pong! 🤖");
  }

  if (interaction.commandName === "profile") {
    const profile = profiles.get(interaction.user.id) ?? {
      reputation: 0,
      xp: 0,
      level: 1,
      chapters: 0
    };

    profiles.set(interaction.user.id, profile);

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
});

client.login(process.env.DISCORD_TOKEN);