const { SlashCommandBuilder } = require('@discordjs/builders');
const { Permissions, MessageEmbed } = require('discord.js');
const fs = require('fs');
const path = require('path');

const queues = new Map();

const blockedWordsFile = path.join(__dirname, 'blockedWords.json');
const blockedWords = JSON.parse(fs.readFileSync(blockedWordsFile, 'utf8')).blocked_words;

const blockedWordsRegex = new RegExp(blockedWords.map(word => {
  const spacedWord = word.split('').join('[^a-zA-Z]*');
  return `\\b${spacedWord}\\b`;
}).join('|'), 'i');

const pingRegex = /<@!?&?\d+>|@everyone|@here/g;
const linkRegex = /https?:\/\/(?!discord\.gg\/)\S+/g;

async function processQueue(userId) {
  if (!queues.has(userId)) return;

  const queue = queues.get(userId);
  while (queue.length > 0) {
    const { interaction, channelName, adMessage, setups, totalMemberCount, serverIds } = queue.shift();
    try {
      const confirmationResults = await getConfirmations(serverIds, interaction, adMessage, totalMemberCount);

      if (!confirmationResults) {
        await interaction.followUp('Ad posting canceled due to lack of confirmations.');
        continue;
      }

      let createdCount = 0;

      for (const setup of setups) {
        const guild = interaction.client.guilds.cache.get(setup.guildId);
        if (guild && setup.categoryId) {
          const category = guild.channels.cache.get(setup.categoryId);
          if (category && category.permissionsFor(guild.me).has(Permissions.FLAGS.MANAGE_CHANNELS)) {
            const interactionGuildMemberCount = interaction.guild.memberCount;
            let interactionRangeKey;

            if (interactionGuildMemberCount < 100) {
              interactionRangeKey = '0-100';
            } else if (interactionGuildMemberCount < 300) {
              interactionRangeKey = '100-300';
            } else if (interactionGuildMemberCount < 500) {
              interactionRangeKey = '300-500';
            } else if (interactionGuildMemberCount < 800) {
              interactionRangeKey = '500-800';
            } else if (interactionGuildMemberCount < 1000) {
              interactionRangeKey = '800-1000';
            } else if (interactionGuildMemberCount < 1500) {
              interactionRangeKey = '1000-1500';
            } else {
              interactionRangeKey = '1500+';
            }

            let roleToPing = setup.roleRanges[interactionRangeKey]?.roleId;
            if (!roleToPing) {
              roleToPing = Object.values(setup.roleRanges).find(range => {
                const [min, max] = range.range.split('-').map(Number);
                return interactionGuildMemberCount >= min && (max ? interactionGuildMemberCount <= max : true);
              })?.roleId;
              if (!roleToPing) {
                continue;
              }
            }

            if (roleToPing) {
              try {
                const channel = await guild.channels.create(channelName, { type: 'GUILD_TEXT', parent: category });
                createdCount++;
                await channel.send(`<@&${roleToPing}> ${adMessage}`);
              } catch (error) {
                console.error(`Failed to create channel in guild ${guild.name}:`, error);
              }
            }
          }
        }
      }

      const resultEmbed = new MessageEmbed()
        .setColor('#0099ff')
        .setTitle('Ad Posting Results')
        .setDescription(`The channel '${channelName}' has been posted to ${createdCount} servers with your ad message.`);

      await interaction.followUp({ embeds: [resultEmbed] });
      await interaction.user.send({ embeds: [resultEmbed] });
    } catch (error) {
      console.error(error);
      await interaction.user.send('An error occurred while posting the channel.');
      await interaction.followUp({ content: 'There was an error executing the command.', ephemeral: true });
    }
  }

  queues.delete(userId);
}

async function getConfirmations(serverIds, interaction, adMessage, totalMemberCount) {
  const ownerMap = new Map();

  for (const serverId of serverIds) {
    if (serverId === interaction.guild.id) continue; 

    const guild = interaction.client.guilds.cache.get(serverId);
    if (guild) {
      const owner = await guild.fetchOwner();
      if (owner) {
        if (!ownerMap.has(owner.id)) {
          ownerMap.set(owner.id, { owner, servers: [] });
        }
        ownerMap.get(owner.id).servers.push(guild);
      } else {
        await interaction.followUp(`Owner of server with ID ${serverId} not found.`);
        return false;
      }
    } else {
      await interaction.followUp(`Server with ID ${serverId} not found.`);
      return false;
    }
  }

  let confirmations = 0;
  const confirmationsNeeded = ownerMap.size;

  for (const { owner, servers } of ownerMap.values()) {
    let serverList = '';
    servers.forEach(guild => {
      serverList += `**${guild.name}** (Member Count: ${guild.memberCount})\n`;
    });

    const confirmationEmbed = new MessageEmbed()
      .setColor('#0099ff')
      .setTitle('Ad Confirmation Required')
      .setDescription(`Do you approve the following ad message for your servers? Reply with **"yes"** or **"no"**.\n\n**Ad Message:**\n${adMessage}`)
      .addField('Servers:', serverList)
      .addField('Total Member Count:', `${totalMemberCount}`);

    try {
      const dm = await owner.send({ embeds: [confirmationEmbed] });

      const filter = response => response.author.id === owner.id && ['yes', 'no'].includes(response.content.toLowerCase());
      const collector = dm.channel.createMessageCollector({ filter, time: 60000, max: 1 });

      const confirmed = await new Promise(resolve => {
        collector.on('collect', message => {
          resolve(message.content.toLowerCase() === 'yes');
        });

        collector.on('end', collected => {
          if (collected.size === 0) {
            resolve(false);
          }
        });
      });

      if (confirmed) {
        confirmations++;
      } else {
        await interaction.followUp(`Ad was not approved by the owner of the server(s) ${serverList}`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to send DM to the owner of guild(s) ${serverList}:`, error);
      return false;
    }
  }

  return confirmations === confirmationsNeeded;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spree11')
    .setDescription('Creates a channel in servers associated with the specified spree setup.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('post')
        .setDescription('Posts a new channel to servers associated with the specified spree setup.')
        .addStringOption(option =>
          option
            .setName('channel_name')
            .setDescription('The name of the channel to create.')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('servers')
            .setDescription('IDs of servers associated with the spree setup, separated by "/" (e.g., "123456789/987654321").')
            .setRequired(true)
        )
    ),
  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
      const channelName = interaction.options.getString('channel_name');
      const serverIds = interaction.options.getString('servers').split('/').map(id => id.trim());

      if (serverIds.includes(interaction.guildId)) {
        await interaction.followUp('The interaction server cannot be included in the server list.');
        return;
      }

      if (new Set(serverIds).size !== serverIds.length) {
        await interaction.followUp('Duplicate server IDs are not allowed.');
        return;
      }

      const db = global.mongoClient.db('discordBot');
      const setupCollection = db.collection('setup');

      const interactionGuildSetup = await setupCollection.findOne({ guildId: interaction.guildId });

      if (!interactionGuildSetup) {
        await interaction.followUp('The interaction guild does not have a valid setup.');
        return;
      }

      const setups = await setupCollection.find({}).toArray();

      const invalidServers = [];
      let totalMemberCount = interaction.guild.memberCount;

      for (const serverId of serverIds) {
        const server = interaction.client.guilds.cache.get(serverId);
        const setup = setups.find(setup => setup.guildId === serverId);
        if (server) {
          if (!setup) {
            invalidServers.push(`${server.name} (${serverId})`);
          } else {
            const missingRoles = [];
            for (const rangeKey in setup.roleRanges) {
              const roleId = setup.roleRanges[rangeKey].roleId;
              const role = server.roles.cache.get(roleId);
              if (!role) {
                missingRoles.push(`Role ID ${roleId} not found in server ${server.name}`);
              }
            }
            if (missingRoles.length > 0) {
              await interaction.followUp(`The following roles are missing in server ${server.name}:\n${missingRoles.join('\n')}`);
              return;
            }

            const category = server.channels.cache.get(setup.categoryId);
            if (!category || category.type !== 'GUILD_CATEGORY') {
              await interaction.followUp(`Category ID ${setup.categoryId} not found or invalid in server ${server.name}`);
              return;
            }

            totalMemberCount += server.memberCount;
          }
        } else {
          await interaction.followUp(`Server with ID ${serverId} not found.`);
          return;
        }
      }

      if (invalidServers.length > 0) {
        await interaction.followUp(`The following servers do not have a valid setup:\n${invalidServers.join('\n')}`);
        return;
      }

      await interaction.followUp('Please send your ad in one message within 60 seconds.');

      const filter = response => response.author.id === interaction.user.id;
      const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

      collector.on('collect', async message => {
        const adMessage = message.content;

        if (blockedWordsRegex.test(adMessage)) {
          const matchedWord = adMessage.match(blockedWordsRegex)[0];
          await interaction.followUp(`Your ad contains a blocked word: "${matchedWord}". Ad posting canceled.`);
          return;
        }

        if (pingRegex.test(adMessage)) {
          await interaction.followUp('Your ad contains pings. Ad posting canceled.');
          return;
        }

        if (linkRegex.test(adMessage)) {
          await interaction.followUp('Your ad contains invalid links. Only discord.gg links are allowed. Ad posting canceled.');
          return;
        }

        const confirmationEmbed = new MessageEmbed()
          .setColor('#0099ff')
          .setTitle('Confirmation Required')
          .setDescription('Are you sure you want to proceed with this ad message? Reply with **"yes"** or **"no"**.');

        await interaction.followUp({
          embeds: [confirmationEmbed],
          content: `**Ad Message:**\n${adMessage}`
        });

        const confirmationCollector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

        confirmationCollector.on('collect', async confirmation => {
          if (confirmation.content.toLowerCase() === 'yes') {
            if (!queues.has(interaction.user.id)) {
              queues.set(interaction.user.id, []);
            }
            queues.get(interaction.user.id).push({
              interaction,
              channelName,
              adMessage,
              setups,
              totalMemberCount,
              serverIds
            });

            await processQueue(interaction.user.id);
          } else {
            await interaction.followUp('Ad posting canceled.');
          }
        });
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          interaction.followUp('You did not provide an ad message in time.');
        }
      });
    } catch (error) {
      console.error(error);
      await interaction.followUp('An error occurred while executing the command.');
    }
  }
};
