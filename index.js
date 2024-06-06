const { Client, Intents, MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const os = require('os');

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_PRESENCES,
    Intents.FLAGS.MESSAGE_CONTENT,
    Intents.FLAGS.DIRECT_MESSAGES
  ],
  partials: [
    'MESSAGE', 
    'CHANNEL', 
    'REACTION'
  ],
  maxListeners: 20
});

const uri = 'URI';

const commands = fs.readdirSync('./commands')
    .filter(file => file.endsWith('.js'))
    .map(file => require(path.join(__dirname, 'commands', file)));

const cooldowns = new Map();

async function connectToMongoDB() {
    const mongoClient = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        await mongoClient.connect();
        console.log('Connected to the MongoDB cluster');
        global.mongoClient = mongoClient;
    } catch (error) {
        console.error('Error occurred during MongoDB connection:', error);
        process.exit(1);
    }
}

async function registerCommands() {
    try {
        await client.application.commands.set(commands.map(command => command.data));
        console.log('Successfully registered global application (/) commands.');
    } catch (error) {
        console.error('Error registering global application (/) commands:', error);
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await connectToMongoDB();
    await registerCommands();
    updateActivity(client);
    global.mongoClient = mongoClient;
    logServerCount(client);
    const db = global.mongoClient.db('discordBot');
    const collection = db.collection('setup');

});

function logServerCount(client) {
    const serverCount = client.guilds.cache.size;
    console.log(`The bot is in ${serverCount} servers.`);
}


client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    const command = commands.find(cmd => cmd.data.name === commandName);

    if (command) {
        // Check cooldown
        if (!cooldowns.has(commandName)) {
            cooldowns.set(commandName, new Map());
        }

        const now = Date.now();
        const timestamps = cooldowns.get(commandName);
        const cooldownAmount = 10 * 1000;

        if (timestamps.has(interaction.user.id)) {
            const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

            if (now < expirationTime) {
                const timeLeft = (expirationTime - now) / 1000;
                return interaction.reply({ content: `Please wait ${timeLeft.toFixed(1)} more seconds before reusing the \`${commandName}\` command.`, ephemeral: true });
            }
        }

        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error('Error executing command:', error);
            await interaction.reply({ content: 'An error occurred while executing this command.', ephemeral: true });
        }
    }
});

async function fetchBanData() {
    try {
        const db = global.mongoClient.db('discordBot');
        const collection = db.collection('bans');
        const banData = await collection.findOne({});
        return banData;
    } catch (error) {
        console.error('Error fetching ban data:', error);
        return null;
    }
}
async function updateActivity(client) {
    async function getGrinderCount() {
        const db = global.mongoClient.db('discordBot');
        const grinderCollection = db.collection('grinders');
        return await grinderCollection.countDocuments({});
    }
    function getServerAndMemberCount() {
        return {
            serverCount: client.guilds.cache.size,
            memberCount: client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0)
        };
    }

    let currentIndex = 0;

    const update = async () => {
        const grinderCount = await getGrinderCount();
        const { serverCount, memberCount } = getServerAndMemberCount();

        const statuses = [
            { text: '/help', type: 'LISTENING', time: 6 },
            { text: `${serverCount} servers & ${memberCount} members`, type: 'WATCHING', time: 6 },
            { text: `${grinderCount} Grinders`, type: 'WATCHING', time: 6 }
        ];

        const status = statuses[currentIndex];
        client.user.setActivity(status.text, { type: status.type });
        setTimeout(update, status.time * 1000);
        currentIndex = (currentIndex + 1) % statuses.length;
    };

    update();
}

client.on('messageCreate', async message => {
    if (message.content === 'stats') {
        let totalSeconds = (client.uptime / 1000);
        const days = Math.floor(totalSeconds / 86400);
        totalSeconds %= 86400;
        const hours = Math.floor(totalSeconds / 3600);
        totalSeconds %= 3600;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        const ramUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const ramTotal = (os.totalmem() / 1024 / 1024).toFixed(2);

        const cpus = os.loadavg(); // 1, 5, and 15 minute load averages

        const userCount = client.users.cache.size;
        const serverCount = client.guilds.cache.size;
        const channelCount = client.channels.cache.size;

        const statsMessage = '```asciidoc\n' +
            `= Statistics = \n`+
            ` • Uptime    :: ${days}d ${hours}h ${minutes}m ${seconds.toFixed(0)}s \n`+
            ` • RAM Usage :: ${ramUsage}MB / ${ramTotal}MB \n`+
            ` • CPU Usage :: ${cpus[0].toFixed(2)} (1m) / ${cpus[1].toFixed(2)} (5m) / ${cpus[2].toFixed(2)} (15m)\n`+
            ` • Users     :: ${userCount}\n`+
            ` • Servers:  :: ${serverCount}\n`+
            ` • Channels  :: ${channelCount}\n`+
        '```';

        await message.channel.send(statsMessage);
    }
});

client.login('token');
