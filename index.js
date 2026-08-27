const { Client, GatewayIntentBits, Events, EmbedBuilder, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const mongoose = require('mongoose');
const config = require('./config');
const powers = require('./powers');
const Economy = require('./economy');
const CooldownManager = require('./cooldowns');
const miningData = require('./miningData');
const emojis = require('./emojis');
const CooldownModel = require('./Cooldown');
const http = require('http');

process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught Exception:', error));

// Vérification du token et guild ID
console.log('TOKEN LU :', config.token ? 'OUI (' + config.token.slice(0, 10) + '...)' : 'NON (vide)');
console.log('GUILD LU :', config.guildId ? 'OUI' : 'NON (vide)');

const ANARCHIE_MUTE_ROLE_ID = '1533505253608263681';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration]
});

const economy = new Economy();
const cooldowns = new CooldownManager();
const activeBingos = new Map();
const miningSessions = new Map();
const afkIntervals = new Map();
const miningInvites = new Map();
const miningTeams = new Map();
const activeTrades = new Map();

function createEmbed(title, description, color = config.embedColor) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}

async function sendEmbed(channel, member, title, description, gifUrl = null, color = config.embedColor) {
  const avatarURL = member.user ? member.user.displayAvatarURL({ dynamic: true }) : member.displayAvatarURL({ dynamic: true });
  const name = member.displayName || member.username;
  const embed = new EmbedBuilder().setColor(color).setAuthor({ name, iconURL: avatarURL }).setTitle(title).setDescription(description).setThumbnail(avatarURL).setTimestamp().setFooter({ text: 'Pouvoir activé' });
  if (gifUrl) embed.setImage(gifUrl);
  return channel.send({ embeds: [embed] });
}

async function logAction(guild, description) {
  const logChannel = guild.channels.cache.get(config.logChannelId);
  if (logChannel) {
    const embed = new EmbedBuilder().setColor('#3498db').setTitle(`${emojis.info} Action`).setDescription(description).setTimestamp();
    logChannel.send({ embeds: [embed] }).catch(() => {});
  }
}

function calculateOreHP(floor, difficulty) {
  const diff = miningData.difficulties[difficulty];
  if (!diff) return 100;
  return Math.floor(diff.hpBase * Math.pow(diff.hpGrowth, floor - 1));
}

function buildMineEmbed(session, pickaxe) {
  const maxHP = session.currentOreMaxHP;
  const currentHP = Math.max(0, session.currentOreHP);
  const percent = maxHP > 0 ? currentHP / maxHP : 0;
  const barLength = 20;
  const filled = Math.round(percent * barLength);
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percentDisplay = Math.round(percent * 100);

  const embed = new EmbedBuilder()
    .setColor(miningData.difficulties[session.difficulty]?.color || '#FFA500')
    .setTitle(`${emojis.ore} ${session.currentOreName}`)
    .addFields(
      { name: '❤️ Points de vie', value: `${currentHP} / ${maxHP}`, inline: false },
      { name: 'Barre de vie', value: `${bar} ${percentDisplay}%`, inline: false },
      { name: 'Étage', value: `${session.floor}`, inline: true },
      { name: 'Difficulté', value: `${session.difficulty}`, inline: true },
      { name: 'Pioche', value: `${pickaxe.name} (${pickaxe.damageMin}-${pickaxe.damageMax} dmg)`, inline: true },
      { name: 'Journal', value: session.lastActionLog.slice(0, 5).join('\n') || 'Aucune action récente.', inline: false }
    )
    .setFooter({ text: 'Boutons : Attaquer | Actualiser | Butin | Récupérer | Auto | Arrêter' });

  return embed;
}

mongoose.connect(config.mongoURI).then(() => console.log('✅ Connecté à MongoDB')).catch(err => console.error('❌ Erreur MongoDB:', err));

client.once(Events.ClientReady, async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  const logChannel = client.channels.cache.get(config.logChannelId);
  if (logChannel) sendEmbed(logChannel, client.user, 'Bot en ligne', 'Le bot est prêt à gérer les pouvoirs.');

  const commands = [
    new SlashCommandBuilder().setName('test').setDescription('Vérifier que le bot répond.'),
    new SlashCommandBuilder().setName('testapi').setDescription('Retire 500 Élys à un membre (test API).').addUserOption(option => option.setName('membre').setDescription('Le membre à qui retirer 500 Élys.').setRequired(true)),
    new SlashCommandBuilder().setName('prix').setDescription('Affiche la liste des pouvoirs et prix.'),
    new SlashCommandBuilder().setName('guide').setDescription('Affiche le guide des commandes.'),
    new SlashCommandBuilder().setName('cmdp').setDescription('Voir les commandes des pouvoirs.'),
    new SlashCommandBuilder().setName('bank').setDescription('Gérer ta banque')
      .addSubcommand(sub => sub.setName('deposit').setDescription('Déposer de l\'argent (taxe 20%).').addIntegerOption(opt => opt.setName('montant').setDescription('Montant à déposer.').setRequired(true)))
      .addSubcommand(sub => sub.setName('withdraw').setDescription('Retirer de l\'argent.').addIntegerOption(opt => opt.setName('montant').setDescription('Montant à retirer.').setRequired(true)))
      .addSubcommand(sub => sub.setName('balance').setDescription('Voir ton solde bancaire.'))
      .addSubcommand(sub => sub.setName('pret').setDescription('Faire un prêt (max 50 000 Élys, 2 jours max).').addIntegerOption(opt => opt.setName('montant').setDescription('Montant à emprunter.').setRequired(true)).addIntegerOption(opt => opt.setName('jours').setDescription('Durée de remboursement (max 2).').setRequired(true)))
      .addSubcommand(sub => sub.setName('dette').setDescription('Voir tes dettes.'))
      .addSubcommand(sub => sub.setName('rembourser').setDescription('Rembourser une partie ou toute ta dette.').addIntegerOption(opt => opt.setName('montant').setDescription('Montant à rembourser.').setRequired(true))),
    new SlashCommandBuilder().setName('pioche').setDescription('Gérer ta pioche.').addSubcommand(sub => sub.setName('info').setDescription('Voir les stats de ta pioche.')).addSubcommand(sub => sub.setName('upgrade').setDescription('Améliorer ta pioche.')),
    new SlashCommandBuilder().setName('mine').setDescription('Lancer une session de minage').addUserOption(option => option.setName('membre').setDescription('Inviter un membre à rejoindre ton équipe (optionnel)').setRequired(false)),
    new SlashCommandBuilder().setName('craft').setDescription('Fabriquer un objet').addStringOption(option => option.setName('objet').setDescription('Objet à fabriquer').setRequired(true).addChoices({ name: 'Auto-Mine Pass', value: 'auto_mine_pass' })),
    new SlashCommandBuilder().setName('inventaire').setDescription('Voir ton inventaire.'),
    new SlashCommandBuilder().setName('afk').setDescription('Aller en zone AFK pour gagner des Aure.'),
    new SlashCommandBuilder().setName('trade').setDescription('Échanger des objets avec un autre membre').addUserOption(opt => opt.setName('membre').setDescription('Le membre avec qui échanger').setRequired(true)),
    new SlashCommandBuilder().setName('pileouface').setDescription('Jouer à pile ou face contre un membre.').addUserOption(opt => opt.setName('adversaire').setDescription('Adversaire.').setRequired(true)).addIntegerOption(opt => opt.setName('mise').setDescription('Mise en Élys.').setRequired(true)),
    new SlashCommandBuilder().setName('bingo').setDescription('Lance un bingo avec une récompense personnalisée').addStringOption(opt => opt.setName('recompense').setDescription('Description de la récompense').setRequired(true)).addIntegerOption(opt => opt.setName('duree').setDescription('Durée en secondes (défaut 60)').setRequired(false)),
    new SlashCommandBuilder().setName('cooldowns').setDescription('Voir tes cooldowns.'),
    new SlashCommandBuilder().setName('etat').setDescription('Voir ton état.'),
    new SlashCommandBuilder().setName('historique').setDescription('Voir tes 10 dernières transactions.'),
    new SlashCommandBuilder().setName('stats').setDescription('Voir tes statistiques.'),
    new SlashCommandBuilder().setName('resetcd').setDescription('Réinitialiser les cooldowns d\'un membre (admin).').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(true)),
    new SlashCommandBuilder().setName('seirei').setDescription('Activer le pouvoir Elys.'),
    new SlashCommandBuilder().setName('kama').setDescription('Tenter de voler tout l\'Élys d\'un membre.').addUserOption(opt => opt.setName('cible').setDescription('Cible').setRequired(true)),
    new SlashCommandBuilder().setName('tsuiseki').setDescription('Défier un membre en pile ou face.').addUserOption(opt => opt.setName('adversaire').setDescription('Adversaire').setRequired(true)).addIntegerOption(opt => opt.setName('mise').setDescription('Mise').setRequired(true)),
    new SlashCommandBuilder().setName('ishii').setDescription('Transférer le malus d\'un joueur à un autre.').addUserOption(opt => opt.setName('source').setDescription('Source').setRequired(true)).addUserOption(opt => opt.setName('cible').setDescription('Cible').setRequired(true)),
    new SlashCommandBuilder().setName('bunri').setDescription('Retirer tous tes malus.'),
    new SlashCommandBuilder().setName('fuuin').setDescription('Débloquer le rôle de revenu quotidien.'),
    new SlashCommandBuilder().setName('yoroi').setDescription('Doubler ta balance.'),
    new SlashCommandBuilder().setName('honoo').setDescription('Brûler 5% de l\'Élys d\'un membre.').addUserOption(opt => opt.setName('cible').setDescription('Cible').setRequired(true)),
    new SlashCommandBuilder().setName('konton').setDescription('Anarchie : malus -5000 Élys à tous.'),
    new SlashCommandBuilder().setName('anarchie_mute').setDescription('Anarchie : mute local 1 minute.'),
    new SlashCommandBuilder().setName('hanamai').setDescription('Activer Danse des fleurs.')
  ];

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    console.log('Enregistrement des commandes slash...');
    await rest.put(Routes.applicationGuildCommands(client.user.id, config.guildId), { body: commands });
    console.log('✅ Commandes slash enregistrées.');
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement des commandes slash:', error);
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const guild = newMember.guild;
  if (guild.id !== config.guildId) return;
  const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
  for (const role of addedRoles.values()) {
    const power = powers.find(p => p.roleId === role.id);
    if (!power) continue;
    if (!power.autoTrigger) {
      const channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased());
      if (channel) sendEmbed(channel, newMember, `Pouvoir ${power.name} obtenu`, `Utilisez la commande correspondante pour activer ce pouvoir.`);
      continue;
    }
    if (power.cooldownDays > 0 && await cooldowns.isOnCooldown(newMember.id, power.name, power.cooldownDays)) {
      const remaining = await cooldowns.getRemaining(newMember.id, power.name, power.cooldownDays);
      await newMember.roles.remove(role).catch(() => {});
      await newMember.send({ embeds: [createEmbed('Cooldown actif', `Le pouvoir **${power.name}** est encore en cooldown.\nTemps restant : ${cooldowns.formatRemaining(remaining)}`)] }).catch(() => {});
      continue;
    }
    try {
      const result = await power.execute(newMember, guild, { economy, cooldowns, config });
      const channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased());
      if (channel) await sendEmbed(channel, newMember, `${power.emoji} ${power.name}`, result.message, power.gifUrl, power.color || config.embedColor);
      if (power.cooldownDays > 0 && result.success) await cooldowns.setCooldown(newMember.id, power.name);
      if (power.usage === 'consommable') await newMember.roles.remove(role).catch(() => {});
      if (result.success) {
        await economy.incrementPowerUsage(newMember.id);
        await logAction(guild, `${newMember.user.tag} a utilisé le pouvoir ${power.name} (auto).`);
      }
    } catch (error) {
      console.error(`Erreur pour ${power.name}:`, error);
    }
  }
});client.on(Events.InteractionCreate, async (interaction) => {
  // --- Gestion du Trade interactif (corrigé) ---
  if (interaction.isButton() && interaction.customId.startsWith('trade_')) {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const tradeId = parts[2];
    const trade = activeTrades.get(tradeId);
    if (!trade) return interaction.reply({ content: "Cet échange n'existe plus.", flags: MessageFlags.Ephemeral });

    const isUser1 = interaction.user.id === trade.user1;
    const isUser2 = interaction.user.id === trade.user2;
    if (!isUser1 && !isUser2) return interaction.reply({ content: "Tu ne participes pas à cet échange.", flags: MessageFlags.Ephemeral });

    const currentUserKey = isUser1 ? 'offer1' : 'offer2';
    const currentValidKey = isUser1 ? 'validated1' : 'validated2';

    if (action === 'pickaxe') {
      const pickLevel = await economy.getPickaxeLevel(interaction.user.id);
      const pick = miningData.pickaxeLevels.find(p => p.level === pickLevel);
      trade[currentUserKey] = trade[currentUserKey].filter(item => item.type !== 'pioche');
      trade[currentUserKey].push({ type: 'pioche', name: pick.name, value: pick.level });
      trade[currentValidKey] = false;
    }

    if (action === 'materials') {
      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`trade_select_${tradeId}`).setPlaceholder('Choisis un matériau').addOptions(
          Object.entries(miningData.resources).map(([key, res]) => new StringSelectMenuOptionBuilder().setLabel(res.name).setValue(key))
        )
      );
      return interaction.reply({ content: 'Choisis un matériau à ajouter :', components: [selectRow], flags: MessageFlags.Ephemeral });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('trade_select_')) {
      const resKey = interaction.values[0];
      const resInfo = miningData.resources[resKey];
      const resCount = await economy.getResource(interaction.user.id, resKey);
      if (resCount <= 0) return interaction.reply({ content: "Tu n'as pas ce matériau.", flags: MessageFlags.Ephemeral });
      trade[currentUserKey].push({ type: 'materiaux', name: resInfo.name, value: 1, resourceKey: resKey });
      trade[currentValidKey] = false;
    }

    if (action === 'validate') {
      trade[currentValidKey] = true;
      if (trade.validated1 && trade.validated2) {
        activeTrades.delete(tradeId);
        for (const item of trade.offer1) {
          if (item.type === 'pioche') await economy.setPickaxeLevel(trade.user2, item.value);
          else if (item.type === 'materiaux') { await economy.removeResource(trade.user1, item.resourceKey, item.value); await economy.addResource(trade.user2, item.resourceKey, item.value); }
        }
        for (const item of trade.offer2) {
          if (item.type === 'pioche') await economy.setPickaxeLevel(trade.user1, item.value);
          else if (item.type === 'materiaux') { await economy.removeResource(trade.user2, item.resourceKey, item.value); await economy.addResource(trade.user1, item.resourceKey, item.value); }
        }
        return interaction.update({ content: 'Échange réussi !', embeds: [], components: [] });
      } else {
        return interaction.reply({ content: "Ton offre est validée ! Attends l'autre joueur.", flags: MessageFlags.Ephemeral });
      }
    }

    if (action === 'cancel') {
      activeTrades.delete(tradeId);
      return interaction.update({ content: 'Échange annulé.', embeds: [], components: [] });
    }

    if (action === 'clear') {
      trade[currentUserKey] = [];
      trade[currentValidKey] = false;
    }

    const offer1Text = trade.offer1.length ? trade.offer1.map(i => `- ${i.name}`).join('\n') : '*(rien pour le moment)*';
    const offer2Text = trade.offer2.length ? trade.offer2.map(i => `- ${i.name}`).join('\n') : '*(rien pour le moment)*';
    const validationText = `Validation : <@${trade.user1}> ${trade.validated1 ? 'Validé' : 'en attente'} · <@${trade.user2}> ${trade.validated2 ? 'Validé' : 'en attente'}`;

    const updatedEmbed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('Échange')
      .setDescription(`Chacun ajoute ce qu'il veut (Pioche, Matériaux) puis clique Valider.`)
      .addFields(
        { name: `<@${trade.user1}> donne`, value: offer1Text, inline: false },
        { name: `<@${trade.user2}> donne`, value: offer2Text, inline: false },
        { name: 'Validation', value: validationText, inline: false }
      );

    await interaction.update({ embeds: [updatedEmbed] });
    return;
  }

  // --- MINE (Select Menu) ---
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('mine_select_')) {
      const difficulty = interaction.values[0];
      const userId = interaction.customId.split('_')[2];
      if (interaction.user.id !== userId) return interaction.reply({ content: "Ce n'est pas ta session.", flags: MessageFlags.Ephemeral });
      const diff = miningData.difficulties[difficulty];
      if (!diff) return interaction.reply({ content: 'Difficulté inconnue.', flags: MessageFlags.Ephemeral });
      const team = miningTeams.get(userId) || [];
      miningTeams.delete(userId);
      const floor = 1;
      const hp = calculateOreHP(floor, difficulty);
      const rewardMin = Math.floor(diff.minReward * (1 + floor * 0.1));
      const rewardMax = Math.floor(diff.maxReward * (1 + floor * 0.1));
      const reward = Math.floor(Math.random() * (rewardMax - rewardMin + 1)) + rewardMin;
      const oreName = miningData.oreNames[difficulty][Math.floor(Math.random() * miningData.oreNames[difficulty].length)];
      const session = { userId: interaction.user.id, difficulty, floor, currentOreName: oreName, currentOreHP: hp, currentOreMaxHP: hp, currentOreReward: reward, loot: [], autoMine: false, autoMineInterval: null, lastActionLog: [], message: null, teamMembers: team };
      const pickaxeLevel = await economy.getPickaxeLevel(interaction.user.id);
      const pickaxe = miningData.pickaxeLevels.find(p => p.level === pickaxeLevel) || { name: "Inconnue", rarity: "?", damageMin: 1, damageMax: 1 };
      const embed = buildMineEmbed(session, pickaxe);
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mine_attack_${interaction.user.id}`).setLabel('Attaquer').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`mine_refresh_${interaction.user.id}`).setLabel('Actualiser').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`mine_loot_${interaction.user.id}`).setLabel('Butin').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`mine_claim_${interaction.user.id}`).setLabel('Récupérer').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`mine_auto_${interaction.user.id}`).setLabel('Auto').setStyle(ButtonStyle.Primary)
      );
      const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mine_stop_${interaction.user.id}`).setLabel('Arrêter').setStyle(ButtonStyle.Danger));
      const sentMessage = await interaction.channel.send({ embeds: [embed], components: [row1, row2] });
      session.message = sentMessage;
      miningSessions.set(sentMessage.id, session);
      return interaction.reply({ embeds: [createEmbed('Session lancée', 'La session de minage a commencé.')], flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // --- BOUTONS DE LA MINE ---
  if (interaction.isButton()) {
    const [action, userId] = interaction.customId.split('_');

    if (interaction.customId.startsWith('mine_accept_') || interaction.customId.startsWith('mine_refuse_')) {
      const parts = interaction.customId.split('_');
      const type = parts[1];
      const inviterId = parts[2];
      const inviteeId = parts[3];
      if (interaction.user.id !== inviteeId) return interaction.reply({ content: "Cette invitation ne t'est pas destinée.", flags: MessageFlags.Ephemeral });
      const invite = miningInvites.get(inviteeId);
      if (!invite) return interaction.reply({ content: "Cette invitation n'existe plus.", flags: MessageFlags.Ephemeral });
      const inviter = await client.users.fetch(inviterId).catch(() => null);
      if (!inviter) return interaction.reply({ content: "L'inviteur est introuvable.", flags: MessageFlags.Ephemeral });
      if (type === 'accept') {
        if (!miningTeams.has(inviterId)) miningTeams.set(inviterId, []);
        const team = miningTeams.get(inviterId);
        if (!team.includes(inviteeId)) team.push(inviteeId);
        miningTeams.set(inviterId, team);
        miningInvites.delete(inviteeId);
        await interaction.update({ content: 'Invitation acceptée !', components: [] });
        await inviter.send({ content: `${interaction.user} a accepté ton invitation pour la session de minage.` }).catch(() => {});
      } else {
        miningInvites.delete(inviteeId);
        await interaction.update({ content: 'Invitation refusée.', components: [] });
        await inviter.send({ content: `${interaction.user} a refusé ton invitation.` }).catch(() => {});
      }
      return;
    }

    const session = miningSessions.get(interaction.message.id);
    if (!session) return interaction.reply({ content: "Cette session de minage est terminée.", flags: MessageFlags.Ephemeral });
    const isLeader = interaction.user.id === session.userId;
    const isTeamMember = session.teamMembers.includes(interaction.user.id);
    if (!isLeader && !isTeamMember) return interaction.reply({ content: "Tu ne fais pas partie de cette session.", flags: MessageFlags.Ephemeral });

    if (interaction.customId.startsWith('mine_attack_')) {
      await interaction.deferUpdate();
      try {
        const attackerId = interaction.user.id;
        const pickaxeLevel = await economy.getPickaxeLevel(attackerId);
        const pickaxe = miningData.pickaxeLevels.find(p => p.level === pickaxeLevel) || { damageMin: 1, damageMax: 1, name: "Inconnue", rarity: "?" };
        let damage = Math.floor(Math.random() * (pickaxe.damageMax - pickaxe.damageMin + 1)) + pickaxe.damageMin;
        if (Math.random() < 0.1) { damage *= 2; session.lastActionLog.unshift('Coup critique !'); }
        session.currentOreHP -= damage;
        session.lastActionLog.unshift(`${interaction.user.username} a infligé ${damage} dégâts au ${session.currentOreName}.`);
        if (session.currentOreHP <= 0) {
          const reward = session.currentOreReward;
          session.loot.push({ type: 'aure', name: 'Aure', amount: reward });
          await economy.addAure(session.userId, reward);
          session.lastActionLog.unshift(`${session.currentOreName} détruit ! ${reward} Aure ajoutées au butin.`);
          for (const [resName, resData] of Object.entries(miningData.resources)) {
            if (Math.random() < resData.dropChance) {
              session.loot.push({ type: 'resource', name: resData.name, amount: 1 });
              await economy.addResource(session.userId, resName, 1);
              session.lastActionLog.unshift(`${resData.name} obtenu !`);
            }
          }
          session.floor += 1;
          if (session.floor > 50) session.floor = 50;
          session.currentOreMaxHP = calculateOreHP(session.floor, session.difficulty);
          session.currentOreHP = session.currentOreMaxHP;
          const diff = miningData.difficulties[session.difficulty];
          const rewardMin = Math.floor(diff.minReward * (1 + session.floor * 0.1));
          const rewardMax = Math.floor(diff.maxReward * (1 + session.floor * 0.1));
          session.currentOreReward = Math.floor(Math.random() * (rewardMax - rewardMin + 1)) + rewardMin;
          session.currentOreName = miningData.oreNames[session.difficulty][Math.floor(Math.random() * miningData.oreNames[session.difficulty].length)];
        }
        const embed = buildMineEmbed(session, pickaxe);
        if (session.message) await session.message.edit({ embeds: [embed] }).catch(() => {});
      } catch (error) { console.error('Erreur bouton attaque mine:', error); }
      return;
    }

    if (interaction.customId.startsWith('mine_refresh_')) {
      await interaction.deferUpdate();
      try {
        const pickaxeLevel = await economy.getPickaxeLevel(interaction.user.id);
        const pickaxe = miningData.pickaxeLevels.find(p => p.level === pickaxeLevel) || { damageMin: 1, damageMax: 1, name: "Inconnue", rarity: "?" };
        const embed = buildMineEmbed(session, pickaxe);
        if (session.message) await session.message.edit({ embeds: [embed] }).catch(() => {});
      } catch (error) { console.error('Erreur bouton actualiser mine:', error); }
      return;
    }

    if (interaction.customId.startsWith('mine_loot_')) {
      const lootSummary = session.loot.map(item => `- ${item.name}: ${item.amount}`).join('\n') || 'Aucun butin.';
      await interaction.reply({ embeds: [createEmbed('Butin actuel', lootSummary)], flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId.startsWith('mine_claim_')) {
      if (!isLeader) return interaction.reply({ content: "Seul le leader peut récupérer le butin.", flags: MessageFlags.Ephemeral });
      const lootSummary = session.loot.map(item => `- ${item.name}: ${item.amount}`).join('\n') || 'Aucun butin.';
      try {
        await interaction.user.send({ embeds: [createEmbed('Butin récupéré', lootSummary)] });
        session.loot = [];
        await interaction.reply({ content: 'Butin envoyé en MP.', flags: MessageFlags.Ephemeral });
      } catch { await interaction.reply({ content: 'Impossible d\'envoyer le MP.', flags: MessageFlags.Ephemeral }); }
      return;
    }

    if (interaction.customId.startsWith('mine_auto_')) {
      if (!isLeader) return interaction.reply({ content: "Seul le leader peut activer l'auto-mine.", flags: MessageFlags.Ephemeral });
      const hasPass = await economy.getAutoMinePass(interaction.user.id);
      if (!hasPass) return interaction.reply({ content: "Auto-Mine Pass requis.", flags: MessageFlags.Ephemeral });
      session.autoMine = !session.autoMine;
      if (session.autoMine) {
        session.autoMineInterval = setInterval(async () => {
          try {
            const pickaxeLevel = await economy.getPickaxeLevel(session.userId);
            const pickaxe = miningData.pickaxeLevels.find(p => p.level === pickaxeLevel) || { damageMin: 1, damageMax: 1 };
            let damage = Math.floor(Math.random() * (pickaxe.damageMax - pickaxe.damageMin + 1)) + pickaxe.damageMin;
            session.currentOreHP -= damage;
            session.lastActionLog.unshift(`[Auto] ${damage} dégâts.`);
            if (session.currentOreHP <= 0) {
              const reward = session.currentOreReward;
              session.loot.push({ type: 'aure', name: 'Aure', amount: reward });
              await economy.addAure(session.userId, reward);
              for (const [resName, resData] of Object.entries(miningData.resources)) {
                if (Math.random() < resData.dropChance) { session.loot.push({ type: 'resource', name: resData.name, amount: 1 }); await economy.addResource(session.userId, resName, 1); }
              }
              session.floor += 1;
              session.currentOreMaxHP = calculateOreHP(session.floor, session.difficulty);
              session.currentOreHP = session.currentOreMaxHP;
              const diff = miningData.difficulties[session.difficulty];
              const rewardMin = Math.floor(diff.minReward * (1 + session.floor * 0.1));
              const rewardMax = Math.floor(diff.maxReward * (1 + session.floor * 0.1));
              session.currentOreReward = Math.floor(Math.random() * (rewardMax - rewardMin + 1)) + rewardMin;
              session.currentOreName = miningData.oreNames[session.difficulty][Math.floor(Math.random() * miningData.oreNames[session.difficulty].length)];
            }
            const embed = buildMineEmbed(session, pickaxe);
            if (session.message) await session.message.edit({ embeds: [embed] }).catch(() => {});
          } catch (error) { console.error('Erreur auto-mine:', error); clearInterval(session.autoMineInterval); session.autoMine = false; }
        }, 5000);
      } else { clearInterval(session.autoMineInterval); session.autoMineInterval = null; }
      await interaction.reply({ content: `Auto-mine ${session.autoMine ? 'activé' : 'désactivé'}.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId.startsWith('mine_stop_')) {
      if (!isLeader) return interaction.reply({ content: "Seul le leader peut arrêter la session.", flags: MessageFlags.Ephemeral });
      if (session.autoMineInterval) clearInterval(session.autoMineInterval);
      miningSessions.delete(interaction.message.id);
      if (session.message) await session.message.delete().catch(() => {});
      await interaction.reply({ content: 'Session arrêtée.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId.startsWith('duel_')) {
      const parts = interaction.customId.split('_');
      const type = parts[1];
      const challengerId = parts[2];
      const targetId = parts[3];
      const mise = parseInt(parts[4]);
      if (interaction.user.id !== challengerId) return interaction.reply({ content: "Seul l'initiateur peut choisir.", flags: MessageFlags.Ephemeral });
      const guild = interaction.guild;
      const target = guild.members.cache.get(targetId);
      if (!target) return interaction.reply({ content: "Cible introuvable.", flags: MessageFlags.Ephemeral });
      const challengerTotal = await economy.getTotalBalance(challengerId);
      const targetTotal = await economy.getTotalBalance(targetId);
      if (challengerTotal < mise || targetTotal < mise) return interaction.update({ content: "Un des participants n'a plus assez de solde total.", embeds: [], components: [] });
      const choice = type === 'pile' ? 0 : 1;
      const result = Math.random() < 0.5 ? 0 : 1;
      let winnerId, loserId;
      if (choice === result) { winnerId = challengerId; loserId = targetId; } else { winnerId = targetId; loserId = challengerId; }
      await economy.deductFromTotal(loserId, mise);
      await economy.addToCash(winnerId, mise);
      await economy.addTransaction(winnerId, `Traque gagnée contre ${target.user.username}`, mise);
      await economy.addTransaction(loserId, `Traque perdue contre ${interaction.user.username}`, -mise);
      await logAction(guild, `${interaction.user.username} a gagné ${mise} Élys contre ${target.user.username}`);
      const resultEmbed = new EmbedBuilder().setColor('#f1c40f').setTitle('Résultat de la Traque').setDescription(`Le choix : ${choice === 0 ? 'Pile' : 'Face'}\nLe résultat : ${result === 0 ? 'Pile' : 'Face'}\n\n<@${winnerId}> gagne **${mise} Élys** !`).setTimestamp();
      await interaction.update({ embeds: [resultEmbed], components: [] });
      return;
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guild.id !== config.guildId) return;

  const { commandName, options, user, member, guild } = interaction;
  await economy.incrementCommandUsage(user.id);

  try {
    if (commandName === 'test') return interaction.reply({ embeds: [createEmbed('Bot en ligne', 'Le bot fonctionne parfaitement !')] });
    if (commandName === 'testapi') {
      const target = options.getUser('membre');
      const targetMember = guild.members.cache.get(target.id);
      if (!targetMember) return interaction.reply({ embeds: [createEmbed('Erreur', 'Membre introuvable.')], flags: MessageFlags.Ephemeral });
      await economy.addBalance(target.id, -500);
      await logAction(guild, `${user.tag} a utilisé /testapi sur ${target.tag} (-500 Élys).`);
      return interaction.reply({ embeds: [createEmbed('Test réussi', `${target} a perdu 500 Élys.`)] });
    }

    if (commandName === 'prix') {
      const priceEmbed = new EmbedBuilder().setColor(config.embedColor).setTitle('Liste des pouvoirs et prix').setDescription('Voici tous les pouvoirs disponibles dans le shop :')
        .addFields(powers.map(p => ({ name: `${p.emoji} ${p.name} - ${p.price ? `${p.price} Élys` : 'Événement'}`, value: p.description, inline: false }))).setTimestamp();
      return interaction.reply({ embeds: [priceEmbed] });
    }

    if (commandName === 'guide') {
      const embed = new EmbedBuilder().setColor(config.embedColor).setTitle('Guide des commandes').setDescription('**Bienvenue !** Voici la liste des commandes disponibles.')
        .addFields(
          { name: 'Général', value: '`/prix` : Liste des pouvoirs.\n`/cmdp` : Commandes des pouvoirs.\n`/guide` : Ce guide.', inline: false },
          { name: 'Banque', value: '`/bank deposit <montant>` : Déposer (taxe 20%).\n`/bank withdraw <montant>` : Retirer.\n`/bank balance` : Solde.\n`/bank pret <montant> <jours>` : Faire un prêt (max 2 jours).\n`/bank dette` : Voir tes dettes.\n`/bank rembourser <montant>` : Rembourser.', inline: false },
          { name: 'Minage', value: '`/mine` : Lancer une session.\n`/pioche info` : Stats de ta pioche.\n`/pioche upgrade` : Améliorer.\n`/craft auto_mine_pass` : Fabriquer pass.\n`/inventaire` : Voir ressources.', inline: false },
          { name: 'Jeux', value: '`/pileouface @adv <mise>` : Pile ou face.\n`/bingo <récompense> [durée]` : Bingo.', inline: false },
          { name: 'Infos', value: '`/cooldowns` : Cooldowns.\n`/etat` : Ton état.\n`/historique` : Transactions.\n`/stats` : Statistiques.', inline: false },
          { name: 'Pouvoirs', value: '`/seirei`, `/kama @cible`, `/tsuiseki @adv <mise>`, `/ishii @source @cible`, `/bunri`, `/fuuin`, `/yoroi`, `/honoo @cible`, `/konton`, `/anarchie_mute`, `/hanamai`', inline: false },
          { name: 'AFK', value: '`/afk` : Zone AFK (20 Aure / 30 sec, max 5h/jour).', inline: false },
          { name: 'Trade', value: '`/trade @membre` : Échanger des objets avec un autre membre.', inline: false }
        ).setFooter({ text: 'Pour plus d\'aide, contacte un administrateur.' }).setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'cmdp') {
      const embed = new EmbedBuilder().setColor(config.embedColor).setTitle('Commandes des pouvoirs').setDescription('Voici les commandes pour activer les pouvoirs :')
        .addFields(
          { name: 'Elys', value: '`/seirei` ou `+seirei`', inline: true },
          { name: 'La faux', value: '`/kama @cible` ou `+kama @cible`', inline: true },
          { name: 'Traque', value: '`/tsuiseki @adversaire <mise>` ou `+tsuiseki @adversaire <mise>`', inline: true },
          { name: 'Surgeon', value: '`/ishii @source @cible` ou `+ishii @source @cible`', inline: true },
          { name: 'Séparateur', value: '`/bunri` ou `+bunri`', inline: true },
          { name: 'Armure d\'Élys', value: '`/yoroi` ou `+yoroi`', inline: true },
          { name: 'Flamme éternelle', value: '`/honoo @cible` ou `+honoo @cible`', inline: true },
          { name: 'Anarchie (malus)', value: '`/konton` ou `+konton`', inline: true },
          { name: 'Anarchie (mute local)', value: '`/anarchie_mute` ou `+anarchie_mute`', inline: true },
          { name: 'Danse des fleurs', value: '`/hanamai` ou `+hanamai`', inline: true }
        ).setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'bank') {
      const sub = options.getSubcommand(); const montant = options.getInteger('montant');
      if (sub === 'deposit') {
        if (montant <= 0) return interaction.reply({ embeds: [createEmbed('Erreur', 'Montant invalide.')], flags: MessageFlags.Ephemeral });
        const cash = await economy.getBalance(user.id);
        if (cash < montant) return interaction.reply({ embeds: [createEmbed('Erreur', 'Tu n\'as pas assez d\'Élys en cash.')], flags: MessageFlags.Ephemeral });
        const tax = Math.floor(montant * 0.20); const deposit = montant - tax;
        await economy.addBalance(user.id, -montant); await economy.addBank(user.id, deposit); await economy.addTransaction(user.id, `Dépôt banque (taxe ${tax})`, deposit);
        return interaction.reply({ embeds: [createEmbed('Banque', `Tu as déposé ${deposit} Élys en banque (taxe ${tax} Élys).`)] });
      }
      if (sub === 'withdraw') {
        if (montant <= 0) return interaction.reply({ embeds: [createEmbed('Erreur', 'Montant invalide.')], flags: MessageFlags.Ephemeral });
        const bank = await economy.getBank(user.id);
        if (bank < montant) return interaction.reply({ embeds: [createEmbed('Erreur', 'Tu n\'as pas assez en banque.')], flags: MessageFlags.Ephemeral });
        await economy.addBank(user.id, -montant); await economy.addBalance(user.id, montant); await economy.addTransaction(user.id, 'Retrait banque', montant);
        return interaction.reply({ embeds: [createEmbed('Banque', `Tu as retiré ${montant} Élys de ta banque.`)] });
      }
      if (sub === 'balance') {
        const bank = await economy.getBank(user.id); const cash = await economy.getBalance(user.id);
        return interaction.reply({ embeds: [createEmbed('Solde', `Cash : ${cash} Élys\nBanque : ${bank} Élys`)] });
      }
      if (sub === 'pret') {
        // Vérifier qu'il n'y a pas déjà un prêt en cours
        const existingLoans = await economy.getLoans(user.id);
        if (existingLoans.length > 0) {
          return interaction.reply({ embeds: [createEmbed('Erreur', 'Tu as déjà un prêt en cours ! Rembourse-le avant d\'en demander un nouveau.')], flags: MessageFlags.Ephemeral });
        }
        const jours = options.getInteger('jours');
        if (!jours || jours <= 0) return interaction.reply({ embeds: [createEmbed('Erreur', 'Durée invalide.')], flags: MessageFlags.Ephemeral });
        if (jours > 2) return interaction.reply({ embeds: [createEmbed('Erreur', 'La durée maximale de remboursement est de 2 jours.')], flags: MessageFlags.Ephemeral });
        if (montant <= 0 || montant > 50000) return interaction.reply({ embeds: [createEmbed('Erreur', 'Le montant doit être entre 1 et 50 000 Élys.')], flags: MessageFlags.Ephemeral });
        const interest = Math.floor(montant * 0.10 * jours); const total = montant + interest;
        await economy.addLoan(user.id, montant, total, jours, interest); await economy.addBalance(user.id, montant); await economy.addTransaction(user.id, `Prêt bancaire (${montant} Élys sur ${jours} jours)`, montant);
        return interaction.reply({ embeds: [createEmbed('Prêt accordé', `Tu as emprunté ${montant} Élys.\nÀ rembourser : ${total} Élys (intérêt ${interest} Élys).\nÉchéance : ${jours} jour(s).`)] });
      }
      if (sub === 'dette') {
        const loans = await economy.getLoans(user.id);
        if (!loans.length) return interaction.reply({ embeds: [createEmbed('Dettes', 'Tu n\'as aucune dette en cours.')] });
        const fields = loans.map((loan, idx) => ({ name: `Dette #${idx + 1}`, value: `Montant restant : ${loan.remaining} Élys\nÉchéance : ${loan.dueDate.toLocaleDateString('fr-FR')} (${loan.days} jours)\nIntérêt : ${loan.interest} Élys`, inline: false }));
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('Tes dettes').addFields(fields)] });
      }
      if (sub === 'rembourser') {
        const loans = await economy.getLoans(user.id);
        if (!loans.length) return interaction.reply({ embeds: [createEmbed('Erreur', 'Tu n\'as aucune dette à rembourser.')], flags: MessageFlags.Ephemeral });
        const loan = loans[0];
        const debt = loan.remaining;
        const cash = await economy.getBalance(user.id);
        if (montant <= 0) return interaction.reply({ embeds: [createEmbed('Erreur', 'Montant invalide.')], flags: MessageFlags.Ephemeral });
        if (cash < montant) return interaction.reply({ embeds: [createEmbed('Erreur', `Tu n'as pas assez de cash pour rembourser ${montant} Élys.`)], flags: MessageFlags.Ephemeral });

        const actualPayment = Math.min(montant, debt);
        await economy.repayLoan(user.id, 0, actualPayment);
        await economy.addBalance(user.id, -actualPayment);
        await economy.addTransaction(user.id, 'Remboursement prêt', -actualPayment);

        const remainingDebt = debt - actualPayment;
        if (remainingDebt <= 0) {
          return interaction.reply({ embeds: [createEmbed('Remboursé', `Tu as remboursé ${actualPayment} Élys. Toute ta dette est soldée ! <a:VerifFonda:1533806937282449559>`)] });
        } else {
          return interaction.reply({ embeds: [createEmbed('Remboursé', `Tu as remboursé ${actualPayment} Élys. Il reste ${remainingDebt} Élys à payer. <a:VerifFonda:1533806937282449559>`)] });
        }
      }
    }

    if (commandName === 'pioche') {
      const sub = options.getSubcommand(); const lvl = await economy.getPickaxeLevel(user.id); const cur = miningData.pickaxeLevels.find(p => p.level === lvl);
      if (sub === 'info') {
        const embed = new EmbedBuilder().setColor('#8E44AD').setTitle('Ta pioche').addFields({ name: 'Nom', value: cur.name, inline: true }, { name: 'Rareté', value: cur.rarity, inline: true }, { name: 'Niveau', value: `${lvl}`, inline: true }, { name: 'Dégâts', value: `${cur.damageMin}-${cur.damageMax}`, inline: true });
        if (lvl < 20) { const next = miningData.pickaxeLevels.find(p => p.level === lvl + 1); embed.addFields({ name: 'Prochaine pioche', value: `${next.name} (${next.rarity})`, inline: false }); }
        return interaction.reply({ embeds: [embed] });
      }
      if (sub === 'upgrade') {
        if (lvl >= 20) return interaction.reply({ embeds: [createEmbed('Pioche', 'Tu as la meilleure pioche !')] });
        const next = miningData.pickaxeLevels.find(p => p.level === lvl + 1); const aure = await economy.getAure(user.id);
        if (aure < next.upgradeCost) return interaction.reply({ embeds: [createEmbed("Pas assez d'Aure", `Il te faut ${next.upgradeCost} Aure.`)], flags: MessageFlags.Ephemeral });
        for (const [resName, amount] of Object.entries(next.upgradeResources)) { const count = await economy.getResource(user.id, resName); if (count < amount) { const rn = miningData.resources[resName]?.name || resName; return interaction.reply({ embeds: [createEmbed('Matériaux manquants', `Il te faut ${amount} ${rn}.`)], flags: MessageFlags.Ephemeral }); } }
        await economy.addAure(user.id, -next.upgradeCost); for (const [resName, amount] of Object.entries(next.upgradeResources)) await economy.removeResource(user.id, resName, amount); await economy.setPickaxeLevel(user.id, next.level); await economy.addTransaction(user.id, `Achat pioche ${next.name}`, -next.upgradeCost);
        return interaction.reply({ embeds: [createEmbed('Pioche améliorée', `Tu as maintenant ${next.name} (${next.rarity}) avec ${next.damageMin}-${next.damageMax} dégâts.`)] });
      }
    }

    if (commandName === 'mine') {
      const invited = options.getUser('membre');
      if (invited) {
        if (invited.id === user.id) return interaction.reply({ embeds: [createEmbed('Erreur', 'Tu ne peux pas t\'inviter toi-même.')], flags: MessageFlags.Ephemeral });
        if (miningInvites.has(invited.id)) return interaction.reply({ embeds: [createEmbed('Erreur', 'Ce membre a déjà une invitation en attente.')], flags: MessageFlags.Ephemeral });
        miningInvites.set(invited.id, { inviterId: user.id, guildId: guild.id, status: 'pending' });
        const embed = new EmbedBuilder().setColor(config.embedColor).setTitle('Invitation à rejoindre une équipe de minage').setDescription(`${user} t'invite à rejoindre sa session de minage.`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mine_accept_${user.id}_${invited.id}`).setLabel('Accepter').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`mine_refuse_${user.id}_${invited.id}`).setLabel('Refuser').setStyle(ButtonStyle.Danger));
        try { await invited.send({ embeds: [embed], components: [row] }); return interaction.reply({ embeds: [createEmbed('Invitation envoyée', `Invitation envoyée à ${invited}.`)], flags: MessageFlags.Ephemeral }); }
        catch { miningInvites.delete(invited.id); return interaction.reply({ embeds: [createEmbed('Erreur', 'Impossible d\'envoyer un MP à ce membre.')], flags: MessageFlags.Ephemeral }); }
      }
      if ([...miningSessions.values()].some(s => s.userId === user.id)) return interaction.reply({ embeds: [createEmbed('Erreur', 'Tu as déjà une session de minage active.')], flags: MessageFlags.Ephemeral });
      const team = miningTeams.get(user.id) || [];
      const selectOptions = Object.entries(miningData.difficulties).map(([dn, dd]) => { let emoji; switch(dn) { case 'Facile': emoji = '🌱'; break; case 'Moyen': emoji = '🌊'; break; case 'Dur': emoji = '🟣'; break; case 'Extreme': emoji = '🟠'; break; case 'Enfer': emoji = '🔥'; break; case 'Cauchemar': emoji = '👹'; break; default: emoji = '⛏️'; } return new StringSelectMenuOptionBuilder().setLabel(`${emoji} ${dn}`).setValue(dn).setDescription(`${dd.minReward}-${dd.maxReward} Aure / étage`); });
      const selectRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`mine_select_${user.id}`).setPlaceholder('Choisis une difficulté...').addOptions(selectOptions));
      const desc = team.length > 0 ? `**Équipe :** ${team.map(id => `<@${id}>`).join(', ')}\n\nSélectionne une difficulté pour lancer la session.` : 'Sélectionne une difficulté pour commencer à miner.';
      return interaction.reply({ embeds: [createEmbed('Choisis ta difficulté', desc)], components: [selectRow] });
    }

    if (commandName === 'craft') {
      const item = options.getString('objet');
      if (item === 'auto_mine_pass') {
        const frag = await economy.getResource(user.id, 'fragment_ame'); const eclat = await economy.getResource(user.id, 'eclat_lune');
        if (frag < 10 || eclat < 5) return interaction.reply({ embeds: [createEmbed('Matériaux manquants', 'Il te faut 10 fragments d\'âme et 5 éclats de lune.')], flags: MessageFlags.Ephemeral });
        await economy.removeResource(user.id, 'fragment_ame', 10); await economy.removeResource(user.id, 'eclat_lune', 5); await economy.setAutoMinePass(user.id, true);
        return interaction.reply({ embeds: [createEmbed('Craft réussi', 'Tu as fabriqué un Auto-Mine Pass !')] });
      }
    }

    if (commandName === 'inventaire') {
      const aure = await economy.getAure(user.id); const lvl = await economy.getPickaxeLevel(user.id); const pick = miningData.pickaxeLevels.find(p => p.level === lvl); const pass = await economy.getAutoMinePass(user.id) ? 'Oui' : 'Non';
      const res = {}; for (const rn of Object.keys(miningData.resources)) res[rn] = await economy.getResource(user.id, rn);
      const embed = new EmbedBuilder().setColor('#3498db').setTitle('Inventaire').addFields({ name: 'Aure', value: `${aure}`, inline: true }, { name: 'Pioche', value: `${pick.name} (Niv. ${lvl})`, inline: true }, { name: 'Auto-Mine Pass', value: pass, inline: true });
      for (const [key, val] of Object.entries(res)) embed.addFields({ name: miningData.resources[key]?.name || key, value: `${val}`, inline: true });
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'afk') {
      const can = await economy.canClaimAfk(user.id); if (!can) return interaction.reply({ embeds: [createEmbed('Limite AFK atteinte', 'Tu as déjà utilisé tes 5h d\'AFK aujourd\'hui.')], flags: MessageFlags.Ephemeral });
      if (afkIntervals.has(user.id)) return interaction.reply({ embeds: [createEmbed('Déjà en AFK', 'Tu es déjà en zone AFK.')], flags: MessageFlags.Ephemeral });
      const interval = setInterval(async () => { const still = await economy.canClaimAfk(user.id); if (!still) { clearInterval(interval); afkIntervals.delete(user.id); return; } await economy.claimAfk(user.id); }, 30000);
      afkIntervals.set(user.id, interval);
      return interaction.reply({ embeds: [createEmbed('Zone AFK activée', 'Tu gagnes 20 Aure toutes les 30 secondes (max 5h/jour).')], flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'trade') {
      const target = options.getUser('membre');
      if (!target || target.id === user.id) return interaction.reply({ embeds: [createEmbed('Erreur', 'Membre invalide.')], flags: MessageFlags.Ephemeral });
      const tradeId = `T${Date.now()}${Math.floor(Math.random() * 10000)}`;
      const trade = { id: tradeId, user1: user.id, user2: target.id, offer1: [], offer2: [], validated1: false, validated2: false, message: null };
      activeTrades.set(tradeId, trade);
      const embed = new EmbedBuilder().setColor('#3498db').setTitle('Échange').setDescription(`Chacun ajoute ce qu'il veut (Pioche, Matériaux) puis clique Valider. L'échange se fait quand vous avez validé tous les deux.`).addFields(
        { name: `${user.username} donne`, value: '*(rien pour le moment)*', inline: false },
        { name: `${target.username} donne`, value: '*(rien pour le moment)*', inline: false },
        { name: 'Validation', value: `<@${user.id}> en attente · <@${target.id}> en attente`, inline: false }
      );
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`trade_pickaxe_${tradeId}`).setLabel('Ajouter Pioche').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`trade_materials_${tradeId}`).setLabel('Ajouter Matériaux').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`trade_validate_${tradeId}`).setLabel('Valider mon offre').setStyle(ButtonStyle.Success));
      const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`trade_cancel_${tradeId}`).setLabel('Annuler').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`trade_clear_${tradeId}`).setLabel('Vider mon offre').setStyle(ButtonStyle.Secondary));
      await interaction.reply({ embeds: [embed], components: [row, row2] });
      return;
    }

    if (commandName === 'pileouface') {
      const target = options.getUser('adversaire'); const mise = options.getInteger('mise');
      const targetMember = guild.members.cache.get(target.id);
      if (!targetMember) return interaction.reply({ embeds: [createEmbed('Erreur', 'Membre introuvable.')], flags: MessageFlags.Ephemeral });
      if (mise <= 0) return interaction.reply({ embeds: [createEmbed('Erreur', 'Mise invalide.')], flags: MessageFlags.Ephemeral });
      const memberTotal = await economy.getTotalBalance(user.id); const targetTotal = await economy.getTotalBalance(target.id);
      if (memberTotal < mise) return interaction.reply({ embeds: [createEmbed('Erreur', 'Tu n\'as pas assez de solde total.')], flags: MessageFlags.Ephemeral });
      if (targetTotal < mise) return interaction.reply({ embeds: [createEmbed('Erreur', `${target} n'a pas assez de solde total.`)], flags: MessageFlags.Ephemeral });
      const win = Math.random() < 0.5;
      if (win) { await economy.deductFromTotal(target.id, mise); await economy.addToCash(user.id, mise); await economy.addTransaction(user.id, `Pile ou face gagné contre ${target.username}`, mise); await economy.addTransaction(target.id, `Pile ou face perdu contre ${user.username}`, -mise); return interaction.reply({ embeds: [createEmbed('Pile ou face', `${user} gagne ${mise} Élys contre ${target} !`)] }); }
      else { await economy.deductFromTotal(user.id, mise); await economy.addToCash(target.id, mise); await economy.addTransaction(user.id, `Pile ou face perdu contre ${target.username}`, -mise); await economy.addTransaction(target.id, `Pile ou face gagné contre ${user.username}`, mise); return interaction.reply({ embeds: [createEmbed('Pile ou face', `${target} gagne ${mise} Élys contre ${user} !`)] }); }
    }

    if (commandName === 'bingo') {
      const rewardText = options.getString('recompense'); const duration = options.getInteger('duree') || 60;
      if (!rewardText || rewardText.trim().length === 0) return interaction.reply({ embeds: [createEmbed('Erreur', 'La récompense ne peut pas être vide.')], flags: MessageFlags.Ephemeral });
      const targetNumber = Math.floor(Math.random() * 100) + 1; const channel = interaction.channel; const bingoKey = `${guild.id}_${user.id}`;
      activeBingos.set(bingoKey, { number: targetNumber, rewardText, creatorId: user.id, channelId: channel.id, guildId: guild.id });
      await interaction.reply({ embeds: [new EmbedBuilder().setColor('#9b59b6').setTitle('Bingo lancé !').setDescription(`Récompense : **${rewardText}**\nDevinez le nombre entre 1 et 100.\nEnvoyez simplement votre nombre dans ce salon.\nTemps : ${duration} secondes.`).setTimestamp()] });
      const filter = m => !m.author.bot && m.guild && m.guild.id === guild.id && m.channel.id === channel.id && /^\d+$/.test(m.content);
      const collector = channel.createMessageCollector({ filter, time: duration * 1000, max: 100 });
      collector.on('collect', async (m) => { const guess = parseInt(m.content); if (guess < 1 || guess > 100) return; const bingo = activeBingos.get(bingoKey); if (!bingo) return; if (guess === targetNumber) { collector.stop(); activeBingos.delete(bingoKey); await logAction(guild, `${m.author.tag} a gagné le bingo de ${user.tag} (récompense : ${rewardText}).`); await m.reply({ embeds: [createEmbed('Bingo gagné !', `${m.author} a trouvé le nombre ${targetNumber} et remporte : **${rewardText}** !`)] }); } else { if (guess < targetNumber) m.reply({ content: 'Plus haut !' }); else m.reply({ content: 'Plus bas !' }); } });
      collector.on('end', (collected, reason) => { if (reason === 'time') { const bingo = activeBingos.get(bingoKey); if (bingo && bingo.creatorId === user.id) { activeBingos.delete(bingoKey); channel.send({ embeds: [createEmbed('Bingo terminé', `Personne n'a trouvé le nombre ${targetNumber}.`)] }); } } });
      return;
    }

    if (commandName === 'resetcd') {
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ embeds: [createEmbed('Accès refusé', 'Seuls les administrateurs peuvent utiliser cette commande.')], flags: MessageFlags.Ephemeral });
      const tu = options.getUser('membre'); const tm = guild.members.cache.get(tu.id);
      if (!tm) return interaction.reply({ embeds: [createEmbed('Erreur', 'Membre introuvable.')], flags: MessageFlags.Ephemeral });
      await CooldownModel.deleteMany({ userId: tu.id }); await logAction(guild, `${user.tag} a réinitialisé les cooldowns de ${tu.tag}.`);
      return interaction.reply({ embeds: [createEmbed('Cooldowns réinitialisés', `Les cooldowns de ${tm} ont été réinitialisés.`)] });
    }

    if (commandName === 'cooldowns') {
      const all = await cooldowns.getAllCooldowns(user.id);
      if (!all.length) return interaction.reply({ embeds: [createEmbed('Cooldowns', 'Aucun cooldown actif.')] });
      const activeCooldowns = [];
      for (const rec of all) { const p = powers.find(p => p.name === rec.powerName); if (!p) continue; const cd = p.cooldownDays || 0; const rem = await cooldowns.getRemaining(user.id, rec.powerName, cd); if (rem > 0) activeCooldowns.push({ powerName: p.name, emoji: p.emoji, command: p.command, remaining: rem }); }
      if (!activeCooldowns.length) return interaction.reply({ embeds: [createEmbed('Cooldowns', 'Aucun cooldown actif.')] });
      const embed = new EmbedBuilder().setColor(config.embedColor).setTitle('Tes cooldowns').addFields(activeCooldowns.map(cd => ({ name: `${cd.emoji} ${cd.powerName}`, value: `Commande : \`/${cd.command}\`\nTemps restant : ${cooldowns.formatRemaining(cd.remaining)}`, inline: false })));
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'etat') {
      const inv = await economy.isInvulnerable(user.id); const cr = guild.roles.cache.find(r => r.name === 'Camouflé'); const hc = cr && member.roles.cache.has(cr.id);
      const bank = await economy.getBank(user.id); const aure = await economy.getAure(user.id); const pl = await economy.getPickaxeLevel(user.id); const cash = await economy.getBalance(user.id);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('Ton état').addFields({ name: 'Cash', value: `${cash} Élys`, inline: true }, { name: 'Banque', value: `${bank} Élys`, inline: true }, { name: 'Aure', value: `${aure}`, inline: true }, { name: 'Pioche', value: `Niveau ${pl}`, inline: true }, { name: 'Invulnérable', value: inv ? 'Oui' : 'Non', inline: true }, { name: 'Camouflé', value: hc ? 'Oui' : 'Non', inline: true })] });
    }

    if (commandName === 'historique') {
      const tx = await economy.getTransactions(user.id);
      if (!tx.length) return interaction.reply({ embeds: [createEmbed('Historique', 'Aucune transaction enregistrée.')] });
      const fields = tx.slice(-10).reverse().map(t => ({ name: `${t.date.toLocaleString('fr-FR')}`, value: `${t.description} : ${t.amount > 0 ? '+' : ''}${t.amount} Élys`, inline: false }));
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('Tes 10 dernières transactions').addFields(fields)] });
    }

    if (commandName === 'stats') {
      const ud = await economy.getUser(user.id); const st = ud.stats;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('Tes statistiques').addFields({ name: 'Pouvoirs utilisés', value: `${st.powersUsed}`, inline: true }, { name: 'Commandes utilisées', value: `${st.commandsUsed}`, inline: true }, { name: 'Dernière activité', value: st.lastUsed ? st.lastUsed.toLocaleString('fr-FR') : 'Jamais', inline: false })] });
    }

    const powerMap = { seirei: 'Elys', kama: 'La faux', ishii: 'Surgeon', bunri: 'Séparateur', fuuin: 'Sceau de fleur', yoroi: 'Armure d\'Élys', honoo: 'Flamme éternelle', konton: 'Anarchie', hanamai: 'Danse des fleurs' };
    const powerName = powerMap[commandName];
    if (powerName) {
      const p = powers.find(p => p.name === powerName);
      if (!p) return interaction.reply({ embeds: [createEmbed('Erreur', 'Pouvoir inconnu.')], flags: MessageFlags.Ephemeral });
      if (!member.roles.cache.has(p.roleId)) return interaction.reply({ embeds: [createEmbed('Accès refusé', 'Tu n\'as pas le rôle nécessaire pour utiliser ce pouvoir.')], flags: MessageFlags.Ephemeral });
      if (p.cooldownDays > 0 && await cooldowns.isOnCooldown(user.id, p.name, p.cooldownDays)) { const rem = await cooldowns.getRemaining(user.id, p.name, p.cooldownDays); return interaction.reply({ embeds: [createEmbed('Cooldown actif', `Temps restant : ${cooldowns.formatRemaining(rem)}`)], flags: MessageFlags.Ephemeral }); }
      let t1, t2;
      if (p.name === 'Surgeon') { t1 = guild.members.cache.get(options.getUser('source')?.id); t2 = guild.members.cache.get(options.getUser('cible')?.id); }
      else if (p.name === 'Flamme éternelle' || p.name === 'La faux') t1 = guild.members.cache.get(options.getUser('cible')?.id);
      try {
        const result = await p.execute(member, guild, { economy, cooldowns, config }, t1, t2);
        if (result.success) { await sendEmbed(interaction.channel, member, `${p.emoji} ${p.name}`, result.message, p.gifUrl, p.color || config.embedColor); if (p.cooldownDays > 0) await cooldowns.setCooldown(user.id, p.name); if (p.usage === 'consommable') await member.roles.remove(p.roleId).catch(() => {}); await economy.incrementPowerUsage(user.id); await logAction(guild, `${user.tag} a utilisé le pouvoir ${p.name} (slash /${commandName}).`); return interaction.reply({ embeds: [createEmbed('Succès', 'Pouvoir utilisé.')] }); }
        else return interaction.reply({ embeds: [createEmbed('Erreur', result.message)], flags: MessageFlags.Ephemeral });
      } catch (e) { console.error(`Erreur pouvoir ${p.name}:`, e); return interaction.reply({ embeds: [createEmbed('Erreur', 'Une erreur est survenue.')], flags: MessageFlags.Ephemeral }); }
    }

    if (commandName === 'tsuiseki') {
      const target = options.getUser('adversaire'); const mise = options.getInteger('mise');
      if (!target || !mise || mise <= 0) return interaction.reply({ embeds: [createEmbed('Erreur', 'Utilisation : /tsuiseki @adversaire <mise>')], flags: MessageFlags.Ephemeral });
      const p = powers.find(p => p.name === 'Traque');
      if (p.cooldownDays > 0 && await cooldowns.isOnCooldown(user.id, p.name, p.cooldownDays)) { const rem = await cooldowns.getRemaining(user.id, p.name, p.cooldownDays); return interaction.reply({ embeds: [createEmbed('Cooldown actif', `Temps restant : ${cooldowns.formatRemaining(rem)}`)], flags: MessageFlags.Ephemeral }); }
      const mt = await economy.getTotalBalance(user.id); const tt = await economy.getTotalBalance(target.id);
      if (mt < mise) return interaction.reply({ embeds: [createEmbed('Erreur', 'Tu n\'as pas assez de solde total.')], flags: MessageFlags.Ephemeral });
      if (tt < mise) return interaction.reply({ embeds: [createEmbed('Erreur', `${target} n'a pas assez de solde total.`)], flags: MessageFlags.Ephemeral });
      const embed = new EmbedBuilder().setColor(p.color || config.embedColor).setTitle('Duel de Traque').setDescription(`${user} défie ${target} pour **${mise} Élys**.\nChoisis Pile ou Face !`).setImage(p.gifUrl || null);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`duel_pile_${user.id}_${target.id}_${mise}`).setLabel('Pile').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`duel_face_${user.id}_${target.id}_${mise}`).setLabel('Face').setStyle(ButtonStyle.Danger));
      await interaction.reply({ embeds: [embed], components: [row] });
      if (p.cooldownDays > 0) await cooldowns.setCooldown(user.id, p.name);
      return;
    }

    if (commandName === 'anarchie_mute') {
      const p = powers.find(p => p.name === 'Anarchie');
      if (!member.roles.cache.has(p.roleId)) return interaction.reply({ embeds: [createEmbed('Accès refusé', 'Tu n\'as pas le rôle Anarchie.')], flags: MessageFlags.Ephemeral });
      if (await cooldowns.isOnCooldown(user.id, 'AnarchieMute', 3)) { const rem = await cooldowns.getRemaining(user.id, 'AnarchieMute', 3); return interaction.reply({ embeds: [createEmbed('Cooldown actif', `Temps restant : ${cooldowns.formatRemaining(rem)}`)], flags: MessageFlags.Ephemeral }); }
      const mr = guild.roles.cache.get(ANARCHIE_MUTE_ROLE_ID);
      if (!mr) return interaction.reply({ embeds: [createEmbed('Erreur', 'Rôle de mute introuvable.')], flags: MessageFlags.Ephemeral });
      const ch = interaction.channel;
      if (!ch.isTextBased()) return interaction.reply({ embeds: [createEmbed('Erreur', 'Salon invalide.')], flags: MessageFlags.Ephemeral });
      try {
        await ch.permissionOverwrites.edit(mr, { SendMessages: false });
        setTimeout(async () => { await ch.permissionOverwrites.edit(mr, { SendMessages: null }).catch(() => {}); }, 60000);
        await cooldowns.setCooldown(user.id, 'AnarchieMute');
        return interaction.reply({ embeds: [createEmbed('Anarchie Mute', `Le rôle ${mr} ne peut plus parler ici pendant 1 minute.`)] });
      } catch (e) { console.error('Erreur mute local:', e); return interaction.reply({ embeds: [createEmbed('Erreur', 'Je n\'ai pas la permission.')], flags: MessageFlags.Ephemeral }); }
    }

    return interaction.reply({ embeds: [createEmbed('Erreur', 'Commande inconnue.')], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('Erreur interaction:', error);
    try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ embeds: [createEmbed('Erreur', 'Une erreur est survenue.')], flags: MessageFlags.Ephemeral }); else await interaction.followUp({ embeds: [createEmbed('Erreur', 'Une erreur est survenue.')], flags: MessageFlags.Ephemeral }); } catch (e) { console.error(e); }
  }
});

// --- Commandes textuelles + ---
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || message.guild.id !== config.guildId) return;
  if (!message.content.startsWith('+')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  await economy.incrementCommandUsage(message.author.id);
  try {
    switch (command) {
      case 'test': return message.channel.send({ embeds: [createEmbed('Bot en ligne', 'Le bot fonctionne parfaitement !')] });
      case 'prix': { const priceEmbed = new EmbedBuilder().setColor(config.embedColor).setTitle('Liste des pouvoirs et prix').setDescription('Voici tous les pouvoirs disponibles dans le shop :').addFields(powers.map(p => ({ name: `${p.emoji} ${p.name} - ${p.price ? `${p.price} Élys` : 'Événement'}`, value: p.description, inline: false }))).setTimestamp(); return message.channel.send({ embeds: [priceEmbed] }); }
      default: return;
    }
  } catch (error) { console.error('Erreur commande texte:', error); message.channel.send({ embeds: [createEmbed('Erreur', 'Une erreur est survenue.')] }); }
});

// --- Serveur HTTP ---
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Bot is alive!'); });
server.listen(process.env.PORT || 3000, () => console.log(`✅ Serveur HTTP écoute sur le port ${process.env.PORT || 3000}`));

// Connexion Discord
console.log('✅ Le serveur est prêt, tentative de connexion à Discord...');
client.login(config.token).catch(err => {
  console.error('❌ ERREUR DE CONNEXION DISCORD :', err.message || err);
});
