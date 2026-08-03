require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
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

const prefix = '+';
const adminIds = (process.env.ADMIN_IDS || '1497279403619647648,827492150760570883')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const EMOJIS = {
  success: '<a:VerifySecu:1533785371983351808>',
  error: '<a:error:1533785725542076577>',
  warn: '<a:Warning:1533786003695734794>',
  info: '<:Info:1533786220486983754>',
  ticket: '<:ticket:1533786391576838194>',
  close: '🔒',
  purge: '🧹',
  rules: '📜',
  tos: '📧',
  welcome: '<:welcome:1533787702389117070>',
  mod: '<:discord_moderator:1533787574882140193>',
  logs: '📝',
  categories: '📂',
  help: '<:Discord_Helper:1191360487963775038>'
};

const BOT_COLORS = {
  default: '#5B6CFF',
  success: '#3BA55D',
  warn: '#F3C53D',
  error: '#FF4D4D',
  info: '#C9C9FF'
};

const LEVEL_CHANNEL_ID = process.env.LEVEL_CHANNEL_ID || '1533511740183019550';
const LEVEL_IMAGE_NAME = 'lvl.png';
const XP_PER_MESSAGE = 8;

const guildId = process.env.GUILD_ID || null;
const welcomeChannelId = process.env.WELCOME_CHANNEL_ID || '1533505331177590814';
const logsChannelId = process.env.LOGS_CHANNEL_ID || '1533505620836220998';
const ticketPanelChannelId = process.env.TICKET_PANEL_CHANNEL_ID || null;

const dataDir = path.join(__dirname, 'data');
const warningsFile = path.join(dataDir, 'warnings.json');
const ticketPanelFile = path.join(dataDir, 'ticket-panel.json');
const levelsFile = path.join(dataDir, 'levels.json');

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

const TICKET_CATEGORIES = [
  { emoji: '💰', value: 'aide-economie', label: 'Aide économie' },
  { emoji: '🛠️', value: 'aide', label: 'Aide' },
  { emoji: '🎁', value: 'giveaway', label: 'Giveaway' },
  { emoji: '📌', value: 'claim', label: 'Claim' }
];

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

async function sendLevelUpMessage(guild, user, level) {
  const channel = guild.channels.cache.get(LEVEL_CHANNEL_ID) || await guild.channels.fetch(LEVEL_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const attachment = new AttachmentBuilder(path.join(__dirname, 'assets', LEVEL_IMAGE_NAME)).setName(LEVEL_IMAGE_NAME);
  const embed = new EmbedBuilder()
    .setColor(BOT_COLORS.success)
    .setTitle(`${EMOJIS.success} Niveau supérieur !`)
    .setDescription(`Bravo **${user.tag}** ! Tu viens de passer niveau **${level}**.`)
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: 'XP gagnée', value: `+${XP_PER_MESSAGE} XP`, inline: true },
      { name: 'Nouveau niveau', value: `Niveau ${level}`, inline: true }
    )
    .setFooter({ text: 'Elysium • Progression' })
    .setImage(`attachment://${LEVEL_IMAGE_NAME}`)
    .setTimestamp();

  await channel.send({ embeds: [embed], files: [attachment] });
}

async function processLevel(message) {
  if (!message.guild || message.author.bot) return;

  const levels = loadLevels();
  if (!levels[message.guild.id]) {
    levels[message.guild.id] = {};
  }

  const userId = message.author.id;
  const userData = levels[message.guild.id][userId] || { xp: 0, level: 1 };
  userData.xp += XP_PER_MESSAGE;

  const target = xpToNextLevel(userData.level);
  if (userData.xp >= target) {
    userData.xp -= target;
    userData.level += 1;
    await sendLevelUpMessage(message.guild, message.author, userData.level);
  }

  levels[message.guild.id][userId] = userData;
  saveLevels(levels);
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

  const embed = new EmbedBuilder()
    .setColor(type === 'delete' ? '#ff4d4d' : '#f3c53d')
    .setTitle(type === 'delete' ? 'Message supprimé' : 'Message modifié')
    .setDescription(details.description)
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

  const channel = await guild.channels.create({
    name: safeName,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
      },
      {
        id: user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      ...adminIds.map((adminId) => ({
        id: adminId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }))
    ]
  });

  const embed = new EmbedBuilder()
      .setColor(BOT_COLORS.default)
      .setTitle(`${EMOJIS.ticket} Ticket ouvert`)
      .setDescription(`Bonjour ${user}, votre ticket a bien été créé pour la demande : **${categoryValue}**.`)
      .addFields({ name: 'Fermeture', value: 'Utilisez `+close` pour fermer ce ticket.', inline: false })
      .setFooter({ text: 'Elysium • Support Ticket' })
      .setTimestamp();
  await channel.send({ content: `<@${user.id}>`, embeds: [embed] });
  return channel;
}

client.once('ready', async () => {
  console.log(`Bot prêt : ${client.user.tag}`);

  if (guildId) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn('Serveur introuvable à partir de GUILD_ID.');
      return;
    }

    const panelChannel = ticketPanelChannelId ? (guild.channels.cache.get(ticketPanelChannelId) || await guild.channels.fetch(ticketPanelChannelId).catch(() => null)) : null;
    if (panelChannel && panelChannel.isTextBased()) {
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
    }
  }
});

client.on('guildMemberAdd', async (member) => {
  if (guildId && member.guild.id !== guildId) return;

  const channel = member.guild.channels.cache.get(welcomeChannelId) || await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const attachment = new AttachmentBuilder(path.join(__dirname, 'assets', 'bienvenue.png')).setName('bienvenue.png');
  const embed = new EmbedBuilder()
    .setColor(BOT_COLORS.success)
    .setTitle(`${EMOJIS.welcome} Bienvenue sur Elysium`)
    .setDescription(`Salut ${member}, bienvenue dans la famille Elysium ! Nous sommes ravis de te voir ici.`)
    .setThumbnail(member.displayAvatarURL({ dynamic: true }))
    .setImage('attachment://bienvenue.png')
    .setFooter({ text: 'Elysium • Bienvenue' })
    .setTimestamp();

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
  if (!interaction.isStringSelectMenu() || interaction.customId !== 'ticket_select') return;

  const ticketType = interaction.values[0];
  const item = TICKET_CATEGORIES.find((cat) => cat.value === ticketType);
  if (!item) {
    await interaction.reply({ content: 'Impossible de trouver cette catégorie.', ephemeral: true });
    return;
  }

  const replies = TICKET_REPLIES[item.value] || ['Je prépare ton ticket…'];
  const response = replies[Math.floor(Math.random() * replies.length)];
  await interaction.reply({ content: `*${response}*`, ephemeral: true });

  const member = interaction.member?.user || interaction.user;
  const channel = await createTicketChannel(interaction.guild, member, item.label);
  await interaction.followUp({ content: `Ton ticket a été ouvert : ${channel}`, ephemeral: true });
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  await processLevel(message);

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (!command) return;

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(BOT_COLORS.default)
      .setTitle(`${EMOJIS.help} Commandes du bot`)
      .setDescription('Préfixe utilisé : `+`')
      .addFields(
        { name: '+warn @user raison', value: 'Ajoute un warn à un utilisateur.' },
        { name: '+warnings @user', value: 'Affiche tous les warns d’un utilisateur.' },
        { name: '+ban @user raison', value: 'Bannit un utilisateur.' },
        { name: '+kick @user raison', value: 'Expulse un utilisateur.' },
        { name: '+mute @member durée raison', value: 'Mute un membre (si ajouté plus tard).' },
        { name: '+unmute @member', value: 'Démute un membre (si ajouté plus tard).' },
        { name: '+purge <1-100>', value: 'Supprime les messages du salon et envoie un résumé en MP.' },
        { name: '+rules', value: 'Affiche le règlement du serveur.' },
        { name: '+tos', value: 'Affiche les réseaux sociaux du serveur.' },
        { name: '+ticket <type>', value: 'Ouvre un ticket pour aide, giveaway, claim, aide-économie.' },
        { name: '+setup-ticket-panel', value: 'Affiche de nouveau le panneau de tickets.' },
        { name: '+test image', value: 'Envoie toutes les images du bot.' },
        { name: '+test emoji', value: 'Affiche tous les emojis utilisés par le bot.' }
      )
      .setFooter({ text: 'Elysium • Bot de modération' })
      .setTimestamp();
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

    const embed = new EmbedBuilder()
      .setColor('#f3c53d')
      .setTitle('Warn ajouté')
      .setDescription(`${target} a reçu un warn.`)
      .addFields({ name: 'Raison', value: reason }, { name: 'Total', value: `${updatedWarnings.length}` });

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
    const embed = new EmbedBuilder()
      .setColor(BOT_COLORS.info)
      .setTitle(`${EMOJIS.warn} Warns de ${target.user.tag}`)
      .setDescription(warnings.length ? 'Voici les warns enregistrés :' : 'Aucun warn enregistré.')
      .setFooter({ text: 'Historique des sanctions' })
      .setTimestamp();

    if (warnings.length) {
      warnings.forEach((warning, index) => {
        embed.addFields({
          name: `Warn ${index + 1}`,
          value: `Raison : ${warning.reason}\nModérateur : <@${warning.moderatorId}>\nDate : ${warning.date}`
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
    const embed = new EmbedBuilder()
      .setColor(BOT_COLORS.default)
      .setTitle(`${EMOJIS.categories} Panel de tickets`)
      .setDescription('Pour ouvrir un ticket, utilise la commande : `+ticket <type>`\nExemple : `+ticket aide`\nSi tu veux un ticket pour un giveaway ou un claim, utilise `+ticket giveaway` ou `+ticket claim`.')
      .setFooter({ text: 'Elysium • Ticket System' })
      .setTimestamp();

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
    const attachments = [
      new AttachmentBuilder(path.join(__dirname, 'assets', 'bienvenue.png')).setName('bienvenue.png'),
      new AttachmentBuilder(path.join(__dirname, 'assets', 'regles.png')).setName('regles.png'),
      new AttachmentBuilder(path.join(__dirname, 'assets', 'lvl.png')).setName('lvl.png')
    ];
    await message.channel.send({ content: 'Voici toutes les images du bot :', files: attachments });
    return;
  }

  if (command === 'test' && args[0] === 'emoji') {
    const emojiList = Object.entries(EMOJIS).map(([key, value]) => `**${key}** : ${value}`).join('\n');
    const embed = new EmbedBuilder()
      .setColor(BOT_COLORS.info)
      .setTitle(`${EMOJIS.info} Emojis du bot`)
      .setDescription(emojiList)
      .setFooter({ text: 'Elysium • Emoji list' })
      .setTimestamp();
    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'close') {
    if (!message.channel.name.startsWith('ticket-')) {
      await message.reply('Cette commande ne fonctionne que dans un salon de ticket.');
      return;
    }

    await message.channel.delete();
    return;
  }

  if (command === 'tos') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(BOT_COLORS.info)
      .setTitle(`${EMOJIS.tos} Conditions générales`)
      .setDescription('Voici nos coordonnées et réseaux sociaux.')
      .addFields(
        { name: 'TikTok', value: '@Elysium.Zen.Ashu', inline: true },
        { name: 'Instagram', value: '@Elysium.Zen.Ashu', inline: true },
        { name: 'Gmail', value: 'Elysium.dsd@gmail.com', inline: true }
      )
      .setFooter({ text: 'Elysium • Contact' })
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === 'rules') {
    if (!isAdmin(message.author.id)) {
      await message.reply('Seules les personnes autorisées peuvent utiliser cette commande.');
      return;
    }

    const attachment = new AttachmentBuilder(path.join(__dirname, 'assets', 'regles.png')).setName('regles.png');
    const embed = new EmbedBuilder()
      .setColor('#5B6CFF')
      .setTitle('🌌 • Règlement d’Elysium')
      .setDescription('Bienvenue sur Elysium ! @everyone\n\nNotre objectif est simple : créer une communauté où chacun peut discuter, jouer, rencontrer de nouvelles personnes et passer un bon moment dans une ambiance conviviale.\n\nMerci de respecter les quelques règles suivantes.')
      .setThumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
      .addFields(
        { name: '🤝 • Respect', value: '• Respectez tous les membres du serveur.\n• Les insultes, le harcèlement, les discriminations et les provocations répétées n’ont pas leur place sur Elysium.' },
        { name: '💬 • Utilisez les bons salons', value: '• Merci d’envoyer vos messages dans le salon correspondant.\n• Prenez quelques secondes pour vérifier où vous écrivez afin de garder le serveur organisé.' },
        { name: '📢 • Spam & Publicité', value: '• Le spam, le flood et les mentions abusives sont interdits.\n• Toute publicité ou recrutement pour un autre serveur est interdit sans l’accord d’un membre du staff.' },
        { name: '🖼️ • Contenus', value: 'Merci de ne pas partager :\n• Des contenus choquants ou inappropriés.\n• Des contenus à caractère sexuel.\n• Des liens malveillants ou destinés à nuire aux autres membres.' },
        { name: '🎙️ • Salons vocaux', value: '• Respectez les personnes présentes.\n• Évitez les cris, les nuisances sonores et les comportements dérangeants.' },
        { name: '💡 • Suggestions', value: 'Une idée pour améliorer Elysium ?\nN’hésitez pas à utiliser le salon <#1533505450690085036>.' },
        { name: '🌟 • L’esprit d’Elysium', value: 'Elysium est avant tout une communauté basée sur le respect, la bonne humeur et le partage.\nMerci de contribuer à faire d’Elysium un endroit agréable pour tous. 💙' }
      )
      .setImage('attachment://regles.png');

    await message.channel.send({ embeds: [embed], files: [attachment] });
    return;
  }

  await message.reply(`Commande inconnue. Tapez +help pour voir la liste.`);
});

client.login(process.env.TOKEN || process.env.BOT_TOKEN);
