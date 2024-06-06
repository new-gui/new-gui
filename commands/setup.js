const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Sets up the server with specified category and roles.')
    .addStringOption(option =>
      option
        .setName('category')
        .setDescription('The category where setup will be configured. You can provide the category name or ID.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('roles')
        .setDescription('The roles to consider for assigning ranges. Mention or provide role IDs separated by /')
        .setRequired(true)
    ),
  async execute(interaction) {
    try {
      await interaction.deferReply();

      const db = global.mongoClient.db('discordBot');
      const setupCollection = db.collection('setup');

      const categoryIdOrName = interaction.options.getString('category');
      const selectedRolesInput = interaction.options.getString('roles');

      const category = interaction.guild.channels.cache.find(channel => channel.type === 'GUILD_CATEGORY' && (channel.name === categoryIdOrName || channel.id === categoryIdOrName));
      if (!category) {
        return await interaction.followUp('Could not find the specified category.');
      }
      const categoryId = category.id;

      const selectedRoleIds = selectedRolesInput.split('/').map(role => {
        const roleName = role.trim().replace(/<@&|>/g, '');
        const foundRole = interaction.guild.roles.cache.find(guildRole => guildRole.name === roleName || guildRole.id === roleName);
        return foundRole ? foundRole.id : null;
      }).filter(roleId => roleId !== null);

      if (selectedRoleIds.length === 0) {
        return await interaction.followUp('No valid roles found.');
      }

      await interaction.guild.members.fetch();

      const roleRanges = {};
      const excludedRoles = [];

      interaction.guild.roles.cache.forEach(role => {
        if (selectedRoleIds.includes(role.id)) {
          const memberCount = role.members.size;
          let rangeKey;
          if (memberCount < 100) {
            rangeKey = '0-100';
          } else if (memberCount < 300) {
            rangeKey = '100-300';
          } else if (memberCount < 500) {
            rangeKey = '300-500';
          } else if (memberCount < 800) {
            rangeKey = '500-800';
          } else if (memberCount < 1000) {
            rangeKey = '800-1000';
          } else if (memberCount < 1500) {
            rangeKey = '1000-1500';
          } else {
            rangeKey = '1500+';
          }

          if (!roleRanges[rangeKey] || roleRanges[rangeKey].memberCount < memberCount) {
            if (roleRanges[rangeKey]) {
              excludedRoles.push(roleRanges[rangeKey].roleId);
            }
            roleRanges[rangeKey] = { roleId: role.id, memberCount: memberCount };
          } else {
            excludedRoles.push(role.id);
          }
        }
      });

      const setupType = (await setupCollection.findOne({ guildId: interaction.guildId })) ? 'Update' : 'New';

      await setupCollection.updateOne(
        { guildId: interaction.guildId },
        { $set: { categoryId: categoryId, roleRanges: roleRanges } },
        { upsert: true }
      );

      const embed = new MessageEmbed()
        .setColor('#0099ff')
        .setTitle(`${setupType} Server Setup Configuration`)
        .addField('Category Chosen', category.name)
        .addField('Roles Chosen', Object.values(roleRanges).map(roleRange => `<@&${roleRange.roleId}> (${Object.keys(roleRanges).find(key => roleRanges[key].roleId === roleRange.roleId)})`).join('\n'))
        .addField('Roles Excluded', excludedRoles.length ? excludedRoles.map(roleId => `<@&${roleId}>`).join('\n') : 'None')
      	.setDescription('||*If there is more than a role with same range, 1 is saved and rest are excluded*||')
        .setTimestamp();

      await interaction.followUp({ embeds: [embed] });

    } catch (error) {
      console.error(error);
      const errorEmbed = new MessageEmbed()
        .setColor('#ff0000')
        .setTitle('Error executing setup command')
        .setDescription(`\`\`\`${error}\`\`\``)
        .setTimestamp();
      await interaction.followUp({ embeds: [errorEmbed] });
    }
  }
};
