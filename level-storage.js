const fs = require('fs');
const path = require('path');

function loadLevelsFromFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLevelsToFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getUserLevelDataFromFile(filePath, guildId, userId) {
  const allLevels = loadLevelsFromFile(filePath);
  const guildLevels = allLevels[guildId] || {};
  const userData = guildLevels[userId] || {};

  return {
    xp: userData.xp ?? 0,
    level: userData.level ?? 1
  };
}

function saveUserLevelDataToFile(filePath, guildId, userId, data) {
  const allLevels = loadLevelsFromFile(filePath);
  const guildLevels = allLevels[guildId] || {};

  guildLevels[userId] = {
    ...(guildLevels[userId] || {}),
    ...data,
    xp: data.xp ?? guildLevels[userId]?.xp ?? 0,
    level: data.level ?? guildLevels[userId]?.level ?? 1
  };

  allLevels[guildId] = guildLevels;
  saveLevelsToFile(filePath, allLevels);
  return allLevels;
}

module.exports = {
  loadLevelsFromFile,
  saveLevelsToFile,
  getUserLevelDataFromFile,
  saveUserLevelDataToFile
};
