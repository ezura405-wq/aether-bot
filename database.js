const { DatabaseSync } = require("node:sqlite");

const database = new DatabaseSync("database.sqlite");

// One profile belongs to one user in one guild.
database.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    reputation INTEGER NOT NULL DEFAULT 0,
    chapters INTEGER NOT NULL DEFAULT 0,
    activity_ms INTEGER NOT NULL DEFAULT 0,
    last_activity_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, guild_id)
  )
`);

// Add activity columns when upgrading a database created by an older version.
const profileColumns = database
  .prepare("PRAGMA table_info(profiles)")
  .all()
  .map((column) => column.name);

if (!profileColumns.includes("activity_ms")) {
  database.exec(
    "ALTER TABLE profiles ADD COLUMN activity_ms INTEGER NOT NULL DEFAULT 0"
  );
}

if (!profileColumns.includes("last_activity_at")) {
  database.exec(
    "ALTER TABLE profiles ADD COLUMN last_activity_at INTEGER NOT NULL DEFAULT 0"
  );
}

const findProfile = database.prepare(`
  SELECT user_id, guild_id, xp, level, reputation, chapters,
    activity_ms, last_activity_at
  FROM profiles
  WHERE user_id = ? AND guild_id = ?
`);

const createProfile = database.prepare(`
  INSERT OR IGNORE INTO profiles (user_id, guild_id)
  VALUES (?, ?)
`);

const saveProfile = database.prepare(`
  UPDATE profiles
  SET xp = ?, level = ?, reputation = ?, chapters = ?,
    activity_ms = ?, last_activity_at = ?
  WHERE user_id = ? AND guild_id = ?
`);

function getProfile(userId, guildId) {
  // Creating on first access means /profile and XP can safely handle new users.
  createProfile.run(userId, guildId);
  return findProfile.get(userId, guildId);
}

function updateProfile(profile) {
  saveProfile.run(
    profile.xp,
    profile.level,
    profile.reputation,
    profile.chapters,
    profile.activity_ms,
    profile.last_activity_at,
    profile.user_id,
    profile.guild_id
  );
}

module.exports = {
  getProfile,
  updateProfile
};
