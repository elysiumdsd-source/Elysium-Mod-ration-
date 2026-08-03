require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  AttachmentBuilder,
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

const guildId = process.env.GUILD_ID || null;
const welcomeChannelId = process.env.WELCOME_CHANNEL_ID || '1533505331177590814';
const logsChannelId = process.env.LOGS_CHANNEL_ID || '1533505620836220998';
const ticketPanelChannelId = process.env.TICKET_PANEL_CHANNEL_ID || null;

const dataDir = path.join(__dirname, 'data');
const warningsFile = path.join(dataDir, 'warnings.json');
const ticketPanelFile = path.join(dataDir, 'ticket-panel.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(warningsFile)) {
  fs.writeFileSync(warningsFile, JSON.stringify({}, null, 2));
}

if (!fs.existsSync(ticketPanelFile)) {
  fs.writeFileSync(ticketPanelFile, JSON.stringify({}, null, 2));
}

const ticketEmojiMap = [
  { emoji: '💰', value: 'aide-economie', label: 'Aide économie' },
  { emoji: '🛠️', value: 'aide', label: 'Aide' },
  { emoji: '🎁', value: 'giveaway', label: 'Giveaway' },
  { emoji: '📌', value: 'claim', label: 'Claim' }
];

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

function getUserWarnings(guildWarnings, userId) {
  return guildWarnings[userId] || [];
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
    .setColor('#5B6CFF')
    .setTitle('Ticket ouvert')
    .setDescription(`Bonjour ${user}, votre ticket a bien été créé pour la demande : **${categoryValue}**.`)
    .addFields({ name: 'Commande de fermeture', value: 'Utilisez `+close` pour fermer ce ticket.' });

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
        .setColor('#5B6CFF')
        .setTitle('Panel de tickets')
        .setDescription('Réagis avec l’émoticône correspondant à ton besoin pour ouvrir un ticket.')
        .addFields(...ticketEmojiMap.map((item) => ({ name: `${item.emoji} ${item.label}`, value: item.value, inline: true })));

      const sent = await panelChannel.send({ embeds: [embed] });
      for (const item of ticketEmojiMap) {
        await sent.react(item.emoji);
      }

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
    .setColor('#5B6CFF')
    .setTitle('Bienvenue sur Elysium')
    .setDescription(`Bienvenue ${member} sur Elysium ! Nous sommes heureux de te compter parmi nous.`)
    .setImage('attachment://bienvenue.png');

  await channel.send({ content: `<@${member.id}>`, embeds: [embed], files: [attachment] });
});

client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot) return;
  await sendLog(message.guild, 'delete', {
    description: `Le contenu suivant a été supprimé dans ${message.channel}.`,
    author: message.author.tag,
    channel: `#${message.channel.name}`,
    time: formatTimestamp(new Date()),
    before: message.content || 'Pas de contenu textuel'
  });
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

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  const panels = loadTicketPanels();
  const guildIdValue = reaction.message.guildId;
  const panelMessageId = panels[guildIdValue];

  if (!panelMessageId || reaction.message.id !== panelMessageId) return;

  const item = ticketEmojiMap.find((entry) => entry.emoji === reaction.emoji.name || entry.emoji === reaction.emoji.toString());
  if (!item) return;

  try {
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const channel = await createTicketChannel(guild, member.user, item.label);
    await reaction.users.remove(user.id);
    await channel.send({ content: `Ticket ouvert pour ${member.user}.` });
  } catch (error) {
    console.error(error);
  }
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;
  if (!message.guild) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  if (!command) return;

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#5B6CFF')
      .setTitle('Commandes du bot')
      .setDescription('Préfixe utilisé : `+`')
      .addFields(
        { name: '+warn @user raison', value: 'Ajoute un warn à un utilisateur.' },
        { name: '+warnings @user', value: 'Affiche tous les warns d’un utilisateur.' },
        { name: '+ban @user raison', value: 'Bannit un utilisateur.' },
        { name: '+kick @user raison', value: 'Expulse un utilisateur.' },
        { name: '+purge', value: 'Supprime tous les messages du salon et envoie un résumé en MP.' },
        { name: '+rules', value: 'Affiche le règlement du serveur.' },
        { name: '+tos', value: 'Affiche les réseaux sociaux du serveur.' },
        { name: '+ticket <type>', value: 'Ouvre un ticket pour aide, giveaway, claim, aide-economie.' }
      );
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
      .setColor('#5B6CFF')
      .setTitle(`Warns de ${target.user.tag}`)
      .setDescription(warnings.length ? 'Liste des anciens warns :' : 'Aucun warn enregistré.');

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
      .setColor('#5B6CFF')
      .setTitle('Panel de tickets')
      .setDescription('Réagis avec l’émoticône correspondant à ton besoin pour ouvrir un ticket.')
      .addFields(...ticketEmojiMap.map((item) => ({ name: `${item.emoji} ${item.label}`, value: item.value, inline: true })));

    const sent = await panelChannel.send({ embeds: [embed] });
    for (const item of ticketEmojiMap) {
      await sent.react(item.emoji);
    }

    const panels = loadTicketPanels();
    panels[message.guild.id] = sent.id;
    saveTicketPanels(panels);
    await message.reply('Le panel de tickets a été configuré.');
    return;
  }

  if (command === 'ticket') {
    const type = (args[0] || 'aide').toLowerCase();
    const selected = ticketEmojiMap.find((item) => item.value === type || item.label.toLowerCase() === type);
    const value = selected ? selected.label : 'Aide';
    const member = await message.guild.members.fetch(message.author.id);
    const channel = await createTicketChannel(message.guild, member.user, value);
    await message.reply(`Ton ticket a été créé dans ${channel}.`);
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
      .setColor('#5B6CFF')
      .setTitle('Conditions générales')
      .setDescription('Voici nos coordonnées et réseaux sociaux.')
      .addFields(
        { name: 'TikTok', value: '@Elysium.Zen.Ashu', inline: true },
        { name: 'Instagram', value: '@Elysium.Zen.Ashu', inline: true },
        { name: 'Gmail', value: 'Elysium.dsd@gmail.com', inline: true }
      );

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
