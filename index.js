const fs = require('fs');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { MongoClient } = require('mongodb');
const {
  loadLevelsFromFile,
  saveUserLevelDataToFile,
  getUserLevelDataFromFile
} = require('./level-storage');
const { DEFAULT_PREFIX, getCommandParts } = require('./command-prefix');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const prefix = DEFAULT_PREFIX;
const adminIds = (process.env.ADMIN_IDS || '1497279403619647648,827492150760570883')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const EMOJIS = {
  success: '<a:VerifySecu:1537214710951321602>',
  error: '<a:error:1537215138703220776>',
  warn: '<a:Warning:1537215268802265229>',
  info: '<:Info:1537215204939792404>',
  ticket: '<:ticket:1533786391576838194>',
  close: '🔒',
  purge: '🧹',
  rules: '📜',
  tos: '📧',
  welcome: '<:welcome:1537215076392767618>',
  mod: '<:discord_moderator:1537215324766867516>',
  logs: '📝',
  categories: '📂',
  help: '<:Discord_Helper:1191360487963775038>'
};

const BOT_COLORS = {
  default: '#5B6CFF',
  success: '#3BA55D',
  warn: '#F3C53D',
  error: '#FF4D4D',
  info: '#7A83FF',
  background: '#1C1E25'
};

function buildEmbed({ title, description, color = BOT_COLORS.default, footer = 'Elysium • Bot', thumbnail, image }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: footer })
    .setTimestamp();

  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  return embed;
}

function infoEmbed(title, description) {
  return buildEmbed({ title, description, color: BOT_COLORS.info, footer: 'Elysium • Info' });
}

function successEmbed(title, description) {
  return buildEmbed({ title, description, color: BOT_COLORS.success, footer: 'Elysium • Succès' });
}

function warningEmbed(title, description) {
  return buildEmbed({ title, description, color: BOT_COLORS.warn, footer: 'Elysium • Attention' });
}

function errorEmbed(title, description) {
  return buildEmbed({ title, description, color: BOT_COLORS.error, footer: 'Elysium • Erreur' });
}

const LEVEL_CHANNEL_ID = process.env.LEVEL_CHANNEL_ID || '1533511740183019550';
const LEVEL_IMAGE_NAME = 'lvl.png';
const XP_MIN_PER_MESSAGE = 5;
const XP_MAX_PER_MESSAGE = 9;
const SPAM_THRESHOLD = 5;
const SPAM_WINDOW = 10_000; // 10 secondes
const SPAM_MUTE_DURATION = 60_000; // 1 minute
const AUTO_DELETE_CHANNEL_ID = process.env.AUTO_DELETE_CHANNEL_ID || '1533505601773113456';
const MONGO_URI = (process.env.MONGO_URI || '').trim();
const DB_NAME = (process.env.DB_NAME || 'elysium_bot').trim();
const LEVELS_COLLECTION = 'levels';
const spamRecords = new Map();
const lastMessageByChannel = new Map();
const xpCooldowns = new Set();
const COOLDOWN_TIME = 60_000;
const LEVEL_ROLES = {
  5: '🌱 Novice',
  10: '🗨️ Habitué',
  15: '⭐ Citoyen',
  20: '⚔️ Aventurier',
  30: '🛡️ Gardien',
  40: '🔥 Vétéran',
  50: '💎 Élite',
  60: '👑 Champion',
  70: '🌟 Héros',
  80: '⚜️ Légende',
  90: '🏛️ Mythique',
  100: '🌌 Immortel'
};
let mongoClient = null;
let levelsCollection = null;

const guildId = process.env.GUILD_ID || null;
const welcomeChannelId = process.env.WELCOME_CHANNEL_ID || '1533505331177590814';
const logsChannelId = process.env.LOGS_CHANNEL_ID || '1533505620836220998';
const ticketPanelChannelId = process.env.TICKET_PANEL_CHANNEL_ID || null;

const dataDir = path.join(__dirname, 'data');
const warningsFile = path.join(dataDir, 'warnings.json');
const ticketPanelFile = path.join(dataDir, 'ticket-panel.json');
const levelsFile = path.join(dataDir, 'levels.json');
const transcriptDir = path.join(dataDir, 'transcripts');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(warningsFile)) {
  fs.writeFileSync(warningsFile, JSON.stringify({}, null, 2));
}

if (!fs.existsSync(ticketPanelFile)) {
  fs.writeFileSync(ticketPanelFile, JSON.stringify({}, null, 2));
}

if (!fs.existsSync(levelsFile)) {
  fs.writeFileSync(levelsFile, JSON.stringify({}, null, 2));
}

if (!fs.existsSync(transcriptDir)) {
  fs.mkdirSync(transcriptDir, { recursive: true });
}

const TICKET_CATEGORIES = [
  { emoji: '💰', value: 'aide-economie', label: 'Aide économie' },
  { emoji: '🛠️', value: 'aide', label: 'Aide' },
  { emoji: '🎁', value: 'giveaway', label: 'Giveaway' },
  { emoji: '📌', value: 'claim', label: 'Claim' }
];

const STAFF_ROLE_IDS = ['1533835913065398333', '1533499987810324571', '1533836673430065282'];

const TICKET_REPLIES = {
  'aide-economie': [
    'Je prépare un ticket économique, tiens-toi prêt !',
    'Analyse en cours… Ton ticket économie arrive dans quelques secondes.',
    'Hop, création du ticket pour ton besoin d’économie !'
  ],
  'aide': [
    'Je viens en aide ! Je crée ton ticket immédiatement.',
    'Ouverture du ticket d’assistance en cours, reste connecté.',
    'C’est parti, ton support arrive.'
  ],
  'giveaway': [
    'Préparation du ticket de giveaway… bonne chance !',
    'Un ticket giveaway est en route pour toi.',
    'Je lance ton ticket giveaway, reste prêt.'
  ],
  'claim': [
    'Ticket claim créé, on vérifie ta demande.',
    'J’ouvre ton ticket claim maintenant.',
    'Seulement quelques secondes avant l’ouverture de ton ticket claim.'
  ]
};

function isAdmin(userId) {
  return adminIds.includes(userId);
}

function hasStaffRole(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.some((role) => STAFF_ROLE_IDS.includes(role.id));
}

function loadWarnings() {
  try {
    return JSON.parse(fs.readFileSync(warningsFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveWarnings(data) {
  fs.writeFileSync(warningsFile, JSON.stringify(data, null, 2));
}

function loadTicketPanels() {
  try {
    return JSON.parse(fs.readFileSync(ticketPanelFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveTicketPanels(data) {
  fs.writeFileSync(ticketPanelFile, JSON.stringify(data, null, 2));
}

function sanitizeTranscriptName(value) {
  return String(value).replace(/[^a-z0-9._-]/gi, '_');
}

function getTicketTranscriptPath(channel) {
  return path.join(transcriptDir, `${channel.id}-${sanitizeTranscriptName(channel.name)}.log`);
}

function appendTicketTranscript(channel, line) {
  try {
    fs.appendFileSync(getTicketTranscriptPath(channel), `${line}\n`);
  } catch (error) {
    console.error('❌ Erreur lors de l’écriture du transcript de ticket :', error.message);
  }
}

function writeTicketTranscriptHeader(channel, user, categoryValue) {
  const header = [
    '=== Transcript de ticket ===',
    `Salon: #${channel.name}`,
    `Créé par: ${user?.tag || user?.username || 'inconnu'}`,
    `Catégorie: ${categoryValue}`,
    `Date: ${new Date().toISOString()}`,
    ''
  ];

  fs.writeFileSync(getTicketTranscriptPath(channel), header.join('\n'));
}

function loadLevels() {
  try {
    return JSON.parse(fs.readFileSync(levelsFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveLevels(data) {
  fs.writeFileSync(levelsFile, JSON.stringify(data, null, 2));
}

function getUserWarnings(guildWarnings, userId) {
  return guildWarnings[userId] || [];
}

function xpToNextLevel(level) {
  return 50 + level * 25;
}

function getXpGainForMessage() {
  return Math.floor(Math.random() * (XP_MAX_PER_MESSAGE - XP_MIN_PER_MESSAGE + 1)) + XP_MIN_PER_MESSAGE;
}

async function sendLevelUpMessage(guild, user, level, xpGained) {
  const channel = guild.channels.cache.get(LEVEL_CHANNEL_ID) || await guild.channels.fetch(LEVEL_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const attachment = new AttachmentBuilder(path.join(__dirname, 'assets', LEVEL_IMAGE_NAME)).setName(LEVEL_IMAGE_NAME);
  const embed = new EmbedBuilder()
    .setColor(BOT_COLORS.success)
    .setTitle(`${EMOJIS.success} Niveau supérieur !`)
    .setDescription(`Bravo **${user.tag}** ! Tu viens de passer niveau **${level}**.`)
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: 'XP gagnée', value: `+${xpGained} XP`, inline: true },
      { name: 'Nouveau niveau', value: `Niveau ${level}`, inline: true }
    )
    .setFooter({ text: 'Elysium • Progression' })
    .setImage(`attachment://${LEVEL_IMAGE_NAME}`)
    .setTimestamp();

  await channel.send({ embeds: [embed], files: [attachment] });
}

async function initMongo() {
  if (!MONGO_URI) {
    console.warn('⚠️  MONGO_URI non configurée. Les données de niveau seront en mémoire uniquement.');
    return;
  }
  if (mongoClient) return;

  try {
    console.log('🔗 Tentative de connexion à MongoDB...');
    mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    levelsCollection = db.collection(LEVELS_COLLECTION);
    await levelsCollection.createIndex({ guildId: 1, userId: 1 }, { unique: true });
    console.log('✅ MongoDB connecté avec succès !');
  } catch (error) {
    console.error('❌ Erreur de connexion MongoDB:', error.message);
    mongoClient = null;
    levelsCollection = null;
  }
}

async function getUserLevelData(guildId, userId) {
  if (levelsCollection) {
    try {
      const record = await levelsCollection.findOne({ guildId, userId });
      return record || { xp: 0, level: 1 };
    } catch (error) {
      console.error('❌ Erreur lors de la lecture des données de niveau:', error.message);
    }
  }

  return getUserLevelDataFromFile(levelsFile, guildId, userId);
}

async function saveUserLevelData(guildId, userId, data) {
  if (levelsCollection) {
    try {
      await levelsCollection.updateOne(
        { guildId, userId },
        { $set: { guildId, userId, ...data } },
        { upsert: true }
      );
      return;
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des données de niveau:', error.message);
    }
  }

  saveUserLevelDataToFile(levelsFile, guildId, userId, data);
}

function createProgressBar(current, max, size = 10) {
  const percentage = Math.min(Math.max(current / max, 0), 1);
  const progress = Math.round(size * percentage);
  const emptyProgress = size - progress;
  return '█'.repeat(progress) + '░'.repeat(emptyProgress);
}

async function processLevel(message) {
  if (!message.guild || message.author.bot) return;
  if (xpCooldowns.has(message.author.id)) return;

  await initMongo();
  const userId = message.author.id;
  const guildId = message.guild.id;
  const userData = await getUserLevelData(guildId, userId);
  const xpGained = getXpGainForMessage();

  userData.xp = (userData.xp || 0) + xpGained;

  const target = xpToNextLevel(userData.level || 1);
  if (userData.xp >= target) {
    userData.xp -= target;
    userData.level = (userData.level || 1) + 1;
    await sendLevelUpMessage(message.guild, message.author, userData.level, xpGained);

    const roleName = LEVEL_ROLES[userData.level];
    if (roleName) {
      const member = await message.guild.members.fetch(userId).catch(() => null);
      if (member) {
        const role = message.guild.roles.cache.find((r) => r.name === roleName);
        if (role) {
          const allLevelRoleNames = Object.values(LEVEL_ROLES);
          const rolesToRemove = member.roles.cache.filter((r) => allLevelRoleNames.includes(r.name));
          await member.roles.remove(rolesToRemove).catch(() => null);
          await member.roles.add(role).catch(() => null);
        }
      }
    }
  }

  await saveUserLevelData(guildId, userId, userData);
  xpCooldowns.add(message.author.id);
  setTimeout(() => xpCooldowns.delete(message.author.id), COOLDOWN_TIME);
}

function addWarning(guildIdValue, userId, moderatorId, reason) {
  const warnings = loadWarnings();
  const guildWarnings = warnings[guildIdValue] || {};
  const userWarnings = getUserWarnings(guildWarnings, userId);

  userWarnings.push({
    id: Date.now(),
    userId,
    moderatorId,
    reason: reason || 'Aucune raison fournie',
    date: new Date().toISOString()
  });

  guildWarnings[userId] = userWarnings;
  warnings[guildIdValue] = guildWarnings;
  saveWarnings(warnings);
  return userWarnings;
}

function clearWarnings(guildIdValue, userId) {
  const warnings = loadWarnings();
  const guildWarnings = warnings[guildIdValue] || {};
  delete guildWarnings[userId];
  warnings[guildIdValue] = guildWarnings;
  saveWarnings(warnings);
}

function formatTimestamp(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

async function purgeChannel(channel, maxMessages = null) {
  let deleted = 0;
  let beforeId = null;

  while (true) {
    const options = { limit: 100 };
    if (beforeId) {
      options.before = beforeId;
    }

    const fetched = await channel.messages.fetch(options).catch(() => null);
    if (!fetched || fetched.size === 0) break;

    const messages = Array.from(fetched.values());
    beforeId = messages[messages.length - 1]?.id;

    if (maxMessages !== null && deleted >= maxMessages) break;

    const bulkable = messages.filter((msg) => !msg.pinned && Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
    const toDelete = bulkable.slice(0, maxMessages !== null ? Math.max(0, maxMessages - deleted) : bulkable.length);

    if (toDelete.length > 0) {
      const result = await channel.bulkDelete(toDelete, true).catch(() => null);
      deleted += result?.size || toDelete.length;
    }

    const remaining = messages.filter((msg) => !toDelete.some((target) => target.id === msg.id));
    for (const message of remaining) {
      if (maxMessages !== null && deleted >= maxMessages) break;
      await message.delete().catch(() => {});
      deleted += 1;
    }

    if (messages.length < 100 || (maxMessages !== null && deleted >= maxMessages)) break;
  }

  return deleted;
}

async function sendLog(guild, type, details) {
  const channel = guild.channels.cache.get(logsChannelId) || await guild.channels.fetch(logsChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = buildEmbed({
    title: type === 'delete' ? 'Message supprimé' : 'Message modifié',
    description: details.description,
    color: type === 'delete' ? BOT_COLORS.error : BOT_COLORS.warn,
    footer: 'Elysium • Logs'
  })
    .addFields(
      { name: 'Auteur', value: details.author, inline: true },
      { name: 'Salon', value: details.channel, inline: true },
      { name: 'Heure', value: details.time, inline: true }
    );

  if (details.before) {
    embed.addFields({ name: 'Avant', value: details.before.slice(0, 1000) || 'Vide' });
  }

  if (details.after) {
    embed.addFields({ name: 'Après', value: details.after.slice(0, 1000) || 'Vide' });
  }

  await channel.send({ embeds: [embed] });
}

async function ensureTicketCategory(guild) {
  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === 'tickets');
  if (existing) return existing;

  return guild.channels.create({
    name: 'Tickets',
    type: ChannelType.GuildCategory
  });
}

async function createTicketChannel(guild, user, categoryValue) {
  const category = await ensureTicketCategory(guild);
  const safeName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`;

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      type: 'role',
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
    },
    {
      id: user.id,
      type: 'member',
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    },
    ...adminIds.map((adminId) => ({
      id: adminId,
      type: 'member',
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    }))
  ];

  const channel = await guild.channels.create({
    name: safeName,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites
  });

  const embed = new EmbedBuilder()
      .setColor(BOT_COLORS.default)
      .setTitle(`${EMOJIS.ticket} Ticket ouvert`)
      .setDescription(`Bonjour ${user}, votre ticket a bien été créé pour la demande : **${categoryValue}**.`)
      .addFields({ name: 'Fermeture', value: 'Utilisez `+close` pour fermer ce ticket.', inline: false })
      .setFooter({ text: 'Elysium • Support Ticket' })
      .setTimestamp();

  writeTicketTranscriptHeader(channel, user, categoryValue);

  const claimButton = new ButtonBuilder()
    .setCustomId('claim_ticket')
    .setLabel('Claim')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(claimButton);
  await channel.send({
    content: `<@${user.id}> <@&1533835913065398333> <@&1533499987810324571> <@&1533836673430065282>`,
    embeds: [embed],
    components: [row]
  });
  return channel;
}

async function refreshTicketPanel(guild) {
  if (!guild || !ticketPanelChannelId) return;

  const panelChannel = guild.channels.cache.get(ticketPanelChannelId) || await guild.channels.fetch(ticketPanelChannelId).catch(() => null);
  if (!panelChannel || !panelChannel.isTextBased()) return;

  const panels = loadTicketPanels();
  const existingPanelId = panels[guild.id];
  if (existingPanelId) {
    try {
      const oldMsg = await panelChannel.messages.fetch(existingPanelId);
      await oldMsg.delete();
    } catch {
      // ignore
    }
  }

  const embed = new EmbedBuilder()
    .setColor(BOT_COLORS.default)
    .setTitle(`${EMOJIS.categories} Panel de tickets`)
    .setDescription('Choisis une option ci-dessous pour créer ton ticket. Les admins seront alertés automatiquement.')
    .setFooter({ text: 'Elysium • Ticket System' })
    .setTimestamp();

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_select')
    .setPlaceholder('Sélectionne le type de ticket...')
    .addOptions(TICKET_CATEGORIES.map((item) => ({
      label: item.label,
      value: item.value,
      description: item.label,
      emoji: item.emoji
    })));

  const row = new ActionRowBuilder().addComponents(menu);
  const sent = await panelChannel.send({ embeds: [embed], components: [row] });

  panels[guild.id] = sent.id;
  saveTicketPanels(panels);
  console.log(`🆕 Panneau de tickets rafraîchi dans ${panelChannel.name} (${guild.name}).`);
}

client.once('ready', async () => {
  console.log(`Bot prêt : ${client.user.tag}`);

  await initMongo();

  if (guildId) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn('Serveur introuvable à partir de GUILD_ID.');
      return;
    }

    await refreshTicketPanel(guild);

    setInterval(() => {
      refreshTicketPanel(guild).catch((error) => {
        console.error('❌ Erreur lors du rafraîchissement du panneau de tickets :', error.message);
      });
    }, 30 * 60 * 1000);
  }
});

client.on('guildMemberAdd', async (member) => {
  if (guildId && member.guild.id !== guildId) return;

  const channel = member.guild.channels.cache.get(welcomeChannelId) || await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const attachment = new AttachmentBuilder(path.join(__dirname, 'assets', 'bienvenue.png')).setName('bienvenue.png');
  const embed = buildEmbed({
      title: `${EMOJIS.welcome} Bienvenue sur Elysium`, 
      description: `Salut ${member}, nous sommes ravis de te compter parmi nous ! Commence par découvrir les salons et lire les règles.`, 
      color: BOT_COLORS.success,
      thumbnail: member.displayAvatarURL({ dynamic: true }),
      image: 'attachment://bienvenue.png',
      footer: 'Elysium • Bienvenue'
    });

  await channel.send({ content: `<@${member.id}>`, embeds: [embed], files: [attachment] });
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!oldMessage.guild || oldMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  await sendLog(oldMessage.guild, 'update', {
    description: `Un message a été modifié dans ${oldMessage.channel}.`,
    author: oldMessage.author.tag,
    channel: `#${oldMessage.channel.name}`,
    time: formatTimestamp(new Date()),
    before: oldMessage.content || 'Pas de contenu textuel',
    after: newMessage.content || 'Pas de contenu textuel'
  });
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'claim_ticket') {
    const member = interaction.member;
    if (!member || (!isAdmin(member.user.id) && !hasStaffRole(member))) {
      await interaction.reply({ content: 'Seuls les admins/staff peuvent claim ce ticket.', flags: ['Ephemeral'] });
      return;
    }

    const claimRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('claim_ticket')
        .setLabel('Claimé')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );

    await interaction.message.edit({ components: [claimRow] });
    appendTicketTranscript(interaction.channel, `[${new Date().toISOString()}] SYSTEM: Ticket claimé par ${member.user.tag}`);
    await interaction.reply({ content: `Ticket claimé par ${member.user}.`, flags: ['Ephemeral'] });
    await interaction.channel.send({ content: `${member.user} a claimé ce ticket.` });
    return;
  }

  if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticket_select') return;

  const ticketType = interaction.values[0];
  const item = TICKET_CATEGORIES.find((cat) => cat.value === ticketType);
  if (!item) {
    await interaction.reply({ content: 'Impossible de trouver cette catégorie.', flags: ['Ephemeral'] });
    return;
  }

  await interaction.deferReply({ flags: ['Ephemeral'] });

  const replies = TICKET_REPLIES[item.value] || ['Je prépare ton ticket…'];
  const response = replies[Math.floor(Math.random() * replies.length)];
  await interaction.editReply(`*${response}*`);

  const member = interaction.member?.user || interaction.user;
  const channel = await createTicketChannel(interaction.guild, member, item.label);
  await interaction.followUp({ content: `Ton ticket a été ouvert : ${channel}`, flags: ['Ephemeral'] });
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  if (message.channel.name.startsWith('ticket-') && !message.author.bot) {
    const content = message.content?.trim() || (message.attachments.size ? `[pièce jointe: ${message.attachments.map((attachment) => attachment.name).join(', ')}]` : '[message vide]');
    appendTicketTranscript(message.channel, `[${new Date().toISOString()}] ${message.author.tag}: ${content}`);
  }

  if (message.channel.id === AUTO_DELETE_CHANNEL_ID) {
    const previous = lastMessageByChannel.get(message.channel.id);
    if (previous && previous.id !== message.id) {
      await previous.delete().catch(() => {});
    }
    lastMessageByChannel.set(message.channel.id, message);
  }

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member && !member.permissions.has(PermissionFlagsBits.Administrator)) {
    const now = Date.now();
    const data = spamRecords.get(message.author.id) || { count: 0, last: 0 };

    if (now - data.last > SPAM_WINDOW) {
      data.count = 1;
    } else {
      data.count += 1;
    }

    data.last = now;
    spamRecords.set(message.author.id, data);

    if (data.count >= SPAM_THRESHOLD) {
      try {
        await member.timeout(SPAM_MUTE_DURATION, 'Spam détecté');
        const embed = errorEmbed(`${EMOJIS.error} Mute automatique`, `${member} a été mis en timeout pendant 1 minute pour spam.`)
          .setFooter({ text: 'Elysium • Anti-spam' });
        await message.channel.send({ embeds: [embed] });
      } catch (error) {
        // silently ignore timeout errors if bot permissions are insufficient
      }
      spamRecords.delete(message.author.id);
      return;
    }
  }

  await processLevel(message);

  const parsed = getCommandParts(message.content);
  if (!parsed) return;

  const { command, args } = parsed;
  if (!command) return;

  if (command === 'help') {
    const embed = infoEmbed(
      `${EMOJIS.help} Commandes du bot`,
      `Préfixe utilisé : \`${prefix}\`\nVoici toutes les commandes disponibles pour gérer le serveur et ouvrir des tickets.'
    );
    embed.addFields(
      { name: '🛡️ Modération', value: '`-warn`, `-warnings`, `-ban`, `-kick`, `-purge`' },
      { name: '🎟️ Tickets', value: '`-ticket <type>`, `-setup-ticket-panel`, `-close`' },
      { name: '📜 Info', value: '`-rules`, `-tos`, `-test image`, `-test emoji`' }
    );
    embed.setFooter({ text: 'Elysium • Commandes' });
    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'warn') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const target = message.mentions.members?.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) {
      await message.reply('Veuillez mentionner un utilisateur valide.');
      return;
    }

    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    const updatedWarnings = addWarning(message.guild.id, target.id, message.author.id, reason);

    const embed = warningEmbed(`${EMOJIS.warn} Warn ajouté`, `${target} a reçu un warn.`);
    embed.addFields(
      { name: 'Raison', value: reason, inline: true },
      { name: 'Total', value: `${updatedWarnings.length}`, inline: true }
    );
    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'warnings') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const target = message.mentions.members?.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) {
      await message.reply('Veuillez mentionner un utilisateur valide.');
      return;
    }

    const warnings = loadWarnings()[message.guild.id]?.[target.id] || [];
    const embed = infoEmbed(`${EMOJIS.warn} Warns de ${target.user.tag}`, warnings.length ? 'Voici les warns enregistrés :' : 'Aucun warn enregistré.');

    if (warnings.length) {
      warnings.forEach((warning, index) => {
        embed.addFields({
          name: `Warn ${index + 1}`,
          value: `**Raison :** ${warning.reason}\n**Modérateur :** <@${warning.moderatorId}>\n**Date :** ${warning.date}`
        });
      });
    }

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'clearwarnings') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const target = message.mentions.members?.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) {
      await message.reply('Veuillez mentionner un utilisateur valide.');
      return;
    }

    clearWarnings(message.guild.id, target.id);
    await message.reply(`Les warns de ${target} ont été supprimés.`);
    return;
  }

  if (command === 'ban') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const target = message.mentions.members?.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) {
      await message.reply('Veuillez mentionner un utilisateur valide.');
      return;
    }

    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    await target.ban({ reason });
    await message.channel.send(`${target.user.tag} a été banni. Raison : ${reason}`);
    return;
  }

  if (command === 'unban') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const userId = args[0];
    if (!userId) {
      await message.reply('Veuillez fournir un ID utilisateur.');
      return;
    }

    try {
      await message.guild.members.unban(userId);
      await message.channel.send(`L’utilisateur ${userId} a été débanni.`);
    } catch {
      await message.reply('Impossible de débannir cet utilisateur.');
    }
    return;
  }

  if (command === 'kick') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const target = message.mentions.members?.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) {
      await message.reply('Veuillez mentionner un utilisateur valide.');
      return;
    }

    const reason = args.slice(1).join(' ') || 'Aucune raison fournie';
    await target.kick(reason);
    await message.channel.send(`${target.user.tag} a été expulsé. Raison : ${reason}`);
    return;
  }

  if (command === 'purge') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    if (!message.channel.permissionsFor(message.guild.members.me).has(PermissionFlagsBits.ManageMessages)) {
      await message.reply('Le bot n’a pas la permission de gérer les messages dans ce salon.');
      return;
    }

    const requestedCount = Number.parseInt(args[0], 10);
    const deletedCount = await purgeChannel(message.channel, Number.isNaN(requestedCount) ? null : requestedCount);

    const userMessage = `Purge effectuée dans ${message.channel}.\nMessages supprimés : ${deletedCount}.`;
    try {
      await message.author.send(userMessage);
    } catch {
      await message.reply('La purge est faite, mais le message de confirmation n’a pas pu être envoyé en MP.');
    }

    await message.reply(`Purge terminée. ${deletedCount} message(s) supprimé(s).`);
    return;
  }

  if (command === 'setup-ticket-panel') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const panelChannel = message.channel;
    const embed = infoEmbed(`${EMOJIS.categories} Panel de tickets`, 'Choisis un type de ticket et un salon sera créé automatiquement pour toi. Les admins pourront répondre directement.')
      .setFooter({ text: 'Elysium • Ticket System' });

    const sent = await panelChannel.send({ embeds: [embed] });

    const panels = loadTicketPanels();
    panels[message.guild.id] = sent.id;
    saveTicketPanels(panels);
    await message.reply('Le panel de tickets a été configuré.');
    return;
  }

  if (command === 'ticket') {
    const type = (args[0] || 'aide').toLowerCase();
    const selected = TICKET_CATEGORIES.find((item) => item.value === type || item.label.toLowerCase() === type);
    const value = selected ? selected.label : 'Aide';
    const member = await message.guild.members.fetch(message.author.id);
    const channel = await createTicketChannel(message.guild, member.user, value);
    await message.reply(`Ton ticket a été créé dans ${channel}.`);
    return;
  }

  if (command === 'test' && args[0] === 'image') {
    const imageFiles = ['bienvenue.png', 'reglement.png', 'lvl.png'];
    const embeds = imageFiles.map((fileName) => {
      return new EmbedBuilder()
        .setColor(BOT_COLORS.info)
        .setTitle(`${EMOJIS.info} ${fileName}`)
        .setDescription(`Voici **${fileName}** envoyée par le bot.`)
        .setImage(`attachment://${fileName}`)
        .setFooter({ text: 'Elysium • Images du bot' })
        .setTimestamp();
    });

    const attachments = imageFiles.map((fileName) => new AttachmentBuilder(path.join(__dirname, 'assets', fileName)).setName(fileName));
    await message.channel.send({ content: 'Voici toutes les images du bot :', embeds, files: attachments });
    return;
  }

  if (command === 'test' && args[0] === 'emoji') {
    const emojiList = Object.entries(EMOJIS).map(([key, value]) => `**${key}** : ${value}`).join('\n');
    const embed = infoEmbed(`${EMOJIS.info} Emojis du bot`, emojiList);
    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'rank' || command === 'level') {
    const target = message.mentions.members?.first()?.user || (args[0] ? (await client.users.fetch(args[0]).catch(() => null)) : message.author);
    if (!target) {
      await message.reply('Utilisateur introuvable.');
      return;
    }

    await initMongo();
    const userData = await getUserLevelData(message.guild.id, target.id);
    const currentLevel = userData.level || 1;
    const currentXP = userData.xp || 0;
    const neededXP = xpToNextLevel(currentLevel);
    const progressBar = createProgressBar(currentXP, neededXP);
    const percent = Math.floor((currentXP / neededXP) * 100);

    const embed = infoEmbed(`${EMOJIS.welcome} Niveau de ${target.username}`, 'Voici les statistiques de progression sur **Elysium** :')
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: 'Niveau', value: `**${currentLevel}**`, inline: true },
        { name: 'XP Actuel', value: `**${currentXP}** / ${neededXP} XP`, inline: true },
        { name: 'Progression', value: `\`[${progressBar}]\` **${percent}%**` }
      );

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'leaderboard' || command === 'top') {
    await initMongo();

    let topUsers = [];
    if (levelsCollection) {
      topUsers = await levelsCollection.find({ guildId: message.guild.id })
        .sort({ level: -1, xp: -1 })
        .limit(10)
        .toArray();
    } else {
      const stored = loadLevelsFromFile(levelsFile);
      const guildEntries = stored[message.guild.id] || {};
      topUsers = Object.entries(guildEntries)
        .map(([userId, entry]) => ({ userId, ...entry }))
        .sort((a, b) => (b.level || 1) - (a.level || 1) || (b.xp || 0) - (a.xp || 0))
        .slice(0, 10);
    }

    if (topUsers.length === 0) {
      await message.reply('Aucun classement disponible pour l\'instant.');
      return;
    }

    const leaderboardText = await Promise.all(topUsers.map(async (entry, index) => {
      const user = await client.users.fetch(entry.userId).catch(() => null);
      const username = user ? user.username : 'Utilisateur inconnu';
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
      return `${medal} **#${index + 1}** | **${username}** — Niv. **${entry.level || 1}** (${entry.xp || 0} XP)`;
    }));

    const embed = infoEmbed('🏆 Classement des membres les plus actifs', leaderboardText.join('\n'));
    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'addlevel') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const target = message.mentions.members?.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!target) {
      await message.reply('Veuillez mentionner un utilisateur valide.');
      return;
    }

    const levelsToAdd = Number.parseInt(args[1], 10);
    if (Number.isNaN(levelsToAdd) || levelsToAdd < 1) {
      await message.reply('Veuillez fournir un nombre de niveaux valide (minimum 1).');
      return;
    }

    await initMongo();
    const userData = await getUserLevelData(message.guild.id, target.id);
    userData.level = (userData.level || 1) + levelsToAdd;
    await saveUserLevelData(message.guild.id, target.id, userData);

    const embed = successEmbed(`${EMOJIS.success} Niveaux ajoutés`, `${target} a reçu **+${levelsToAdd}** niveau(x) !\n\n**Nouveau niveau :** ${userData.level}`)
      .setThumbnail(target.displayAvatarURL({ dynamic: true }));

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'close') {
    if (!message.channel.name.startsWith('ticket-')) {
      await message.reply('Cette commande ne fonctionne que dans un salon de ticket.');
      return;
    }

    appendTicketTranscript(message.channel, `[${new Date().toISOString()}] SYSTEM: Ticket fermé par ${message.author.tag}`);
    await message.channel.delete();
    return;
  }

  if (command === 'tos') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const embed = infoEmbed(`${EMOJIS.tos} Conditions générales`, 'Retrouve ici les principaux réseaux sociaux de la communauté et contacte-nous en privé si besoin.')
      .addFields(
        { name: 'TikTok', value: '@Elysium.Zen.Ashu', inline: true },
        { name: 'Instagram', value: '@Elysium.Zen.Ashu', inline: true },
        { name: 'Gmail', value: 'Elysium.dsd@gmail.com', inline: true }
      )
      .setFooter({ text: 'Elysium • Contact' });

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'rules') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const attachment = new AttachmentBuilder(path.join(__dirname, 'assets', 'reglement.png')).setName('reglement.png');
    const embed = buildEmbed({
      title: '🌌 • Règlement d’Elysium',
      description: 'Bienvenue sur Elysium ! @everyone\n\nNotre objectif est simple : créer une communauté où chacun peut discuter, jouer, rencontrer de nouvelles personnes et passer un bon moment dans une ambiance conviviale.\n\nMerci de respecter les quelques règles suivantes.',
      color: BOT_COLORS.default,
      thumbnail: 'https://cdn.discordapp.com/embed/avatars/0.png',
      image: 'attachment://reglement.png',
      footer: 'Elysium • Règlement'
    })
      .addFields(
        { name: '🤝 • Respect', value: '• Respectez tous les membres du serveur.\n• Les insultes, le harcèlement, les discriminations et les provocations répétées n’ont pas leur place sur Elysium.' },
        { name: '💬 • Utilisez les bons salons', value: '• Merci d’envoyer vos messages dans le salon correspondant.\n• Prenez quelques secondes pour vérifier où vous écrivez afin de garder le serveur organisé.' },
        { name: '📢 • Spam & Publicité', value: '• Le spam, le flood et les mentions abusives sont interdits.\n• Toute publicité ou recrutement pour un autre serveur est interdit sans l’accord d’un membre du staff.' },
        { name: '🖼️ • Contenus', value: 'Merci de ne pas partager :\n• Des contenus choquants ou inappropriés.\n• Des contenus à caractère sexuel.\n• Des liens malveillants ou destinés à nuire aux autres membres.' },
        { name: '🎙️ • Salons vocaux', value: '• Respectez les personnes présentes.\n• Évitez les cris, les nuisances sonores et les comportements dérangeants.' },
        { name: '💡 • Suggestions', value: 'Une idée pour améliorer Elysium ?\nN’hésitez pas à utiliser le salon <#1533505450690085036>.' },
        { name: '🌟 • L’esprit d’Elysium', value: 'Elysium est avant tout une communauté basée sur le respect, la bonne humeur et le partage.\nMerci de contribuer à faire d’Elysium un endroit agréable pour tous. 💙' }
      )
      .setImage('attachment://reglement.png');

    await message.channel.send({ embeds: [embed], files: [attachment] });
    return;
  }

  await message.reply(`Commande inconnue. Tapez +help pour voir la liste.`);
});

const port = Number(process.env.PORT) || 3000;
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'elysium-bot' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Elysium bot is running.');
});

healthServer.listen(port, () => {
  console.log(`Health server listening on port ${port}`);
});

client.login(process.env.TOKEN || process.env.BOT_TOKEN);
