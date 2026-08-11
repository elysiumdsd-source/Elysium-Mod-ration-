const DEFAULT_PREFIX = '-';

function getCommandParts(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const prefix = trimmed.startsWith(DEFAULT_PREFIX) ? DEFAULT_PREFIX : (trimmed.startsWith('+') ? '+' : null);
  if (!prefix) {
    return null;
  }

  const args = trimmed.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  const command = args.shift()?.toLowerCase() || null;

  return { prefix, command, args };
}

module.exports = {
  DEFAULT_PREFIX,
  getCommandParts
};
