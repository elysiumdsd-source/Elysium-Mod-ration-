const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadLevelsFromFile, saveUserLevelDataToFile, getUserLevelDataFromFile } = require('../level-storage');

test('persists user level data to file when Mongo is unavailable', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elysium-levels-'));
  const levelsFile = path.join(tempDir, 'levels.json');
  const guildId = 'guild-1';
  const userId = 'user-1';

  saveUserLevelDataToFile(levelsFile, guildId, userId, { xp: 7, level: 2 });

  const data = getUserLevelDataFromFile(levelsFile, guildId, userId);
  const stored = loadLevelsFromFile(levelsFile);

  assert.deepEqual(data, { xp: 7, level: 2 });
  assert.equal(stored[guildId][userId].xp, 7);
  assert.equal(stored[guildId][userId].level, 2);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
