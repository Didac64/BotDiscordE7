/*
 * app.js - Epic7 Build Analyzer Discord Bot
 * All-in-one: Express server + SQLite + OCR + Epic7DB + Discord
 */
// app.js
import fs from "fs";
import path from "path";
import express from "express";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import Tesseract from "tesseract.js";
import dotenv from "dotenv";
import {
  Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder, REST, Routes } from "discord.js";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();




// ⚠️ Do not modify this block
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || null;
const EPIC7DB_API = process.env.EPIC7DB_API || "https://api.epic7db.com";
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "db.sqlite");
const UPLOAD_DIR = path.join(__dirname, "uploads");
// ⚠️ End of protected block

// --- Express setup (needed for Render to keep the bot alive) ---
const app = express();
app.get("/", (req, res) => res.send("Epic Seven Build Bot is running."));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Ensure uploads folder exists ---
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// --- SQLite setup ---
let db;
(async () => {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      character_name TEXT,
      build_data TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("SQLite database initialized.");
})();

// --- Discord bot setup ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// --- Register slash commands ---
const commands = [
  {
    name: "build",
    description: "Shows the optimal build for a character.",
    options: [
      {
        name: "character",
        description: "Character name (e.g., Arbiter Vildred)",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "analyze",
    description: "Analyze a character build from an image.",
    options: [
      {
        name: "image",
        description: "Upload a screenshot of your character’s build.",
        type: 11, // ATTACHMENT
        required: true,
      },
    ],
  },
  {
    name: "help",
    description: "Show all available commands.",
  },
];

// Register commands (guild level for instant appearance)
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    console.log("Registering Discord commands...");
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log("Commands registered successfully.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
})();

// --- Command handling ---
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // /help command
  if (commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("Epic Seven Bot Commands")
      .setColor("#2ecc71")
      .setDescription("Here are the available commands:")
      .addFields(
        {
          name: "/build <character>",
          value: "Shows recommended builds, sets, and artifacts.",
        },
        {
          name: "/analyze <image>",
          value:
            "Upload a screenshot of your build. The bot will analyze and rate it.",
        },
        {
          name: "/help",
          value: "Displays this help message.",
        }
      )
      .setFooter({ text: "Epic Seven Build Analyzer" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // /build command
  else if (commandName === "build") {
    const charName = interaction.options.getString("character");

    await interaction.deferReply();
    try {
      const res = await fetch(`${EPIC7DB_API}/hero/${encodeURIComponent(charName.toLowerCase())}`);
      const data = await res.json();

      if (!data || !data.results || data.results.length === 0) {
        await interaction.editReply(`❌ Character **${charName}** not found.`);
        return;
      }

      const hero = data.results[0];

      const embed = new EmbedBuilder()
        .setTitle(`💫 ${hero.name}`)
        .setColor("#3498db")
        .setThumbnail(hero.assets.icon)
        .addFields(
          { name: "Role", value: hero.role || "Unknown", inline: true },
          { name: "Element", value: hero.attribute || "Unknown", inline: true },
          { name: "Rarity", value: `${hero.rarity}★`, inline: true },
          {
            name: "Recommended Sets",
            value: hero.sets?.join(", ") || "Not available",
          },
          {
            name: "Recommended Artifact",
            value: hero.artifact || "Not specified",
          }
        )
        .setFooter({ text: "Data from Epic7DB" });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await interaction.editReply(
        "⚠️ Something went wrong while fetching character data."
      );
    }
  }

  // /analyze command
  else if (commandName === "analyze") {
    const image = interaction.options.getAttachment("image");

    await interaction.deferReply();

    const filePath = path.join(UPLOAD_DIR, `${interaction.id}.png`);
    const response = await fetch(image.url);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(buffer));

    try {
      const result = await Tesseract.recognize(filePath, "eng");
      const text = result.data.text;

      // Simple evaluation logic (demo)
      const isGood =
        text.toLowerCase().includes("speed") &&
        text.toLowerCase().includes("crit");
      const rating = isGood ? "✅ Good build detected!" : "⚠️ Could be improved.";

      const embed = new EmbedBuilder()
        .setTitle("Build Analysis Result")
        .setDescription(rating)
        .addFields({
          name: "Detected Text",
          value: text.slice(0, 1024) || "No text detected.",
        })
        .setColor(isGood ? "#2ecc71" : "#e67e22");

      await db.run(
        `INSERT INTO user_builds (user_id, character_name, build_data) VALUES (?, ?, ?)`,
        [interaction.user.id, "Unknown", text]
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("OCR error:", error);
      await interaction.editReply("❌ Failed to analyze image.");
    } finally {
      fs.unlinkSync(filePath);
    }
  }
});

// --- Log when bot is ready ---
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
