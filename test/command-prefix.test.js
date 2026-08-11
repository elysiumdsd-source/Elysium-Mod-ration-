const test = require('node:test');
const assert = require('node:assert/strict');
const { getCommandParts, DEFAULT_PREFIX } = require('../command-prefix');

test('parses commands with the default prefix', () => {
  const parsed = getCommandParts('-warn user 123');

  assert.deepEqual(parsed, {
    prefix: DEFAULT_PREFIX,
    command: 'warn',
    args: ['user', '123']
  });
});

test('also parses legacy plus-prefixed commands', () => {
  const parsed = getCommandParts('+help');

  assert.deepEqual(parsed, {
    prefix: '+',
    command: 'help',
    args: []
  });
});
