require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const fs = require('fs');
const http = require('http'); 

// Support for file downloads in restock
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// --- RAILWAY MONITORING SERVER ---
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Will Bot is Online');
}).listen(port, '0.0.0.0');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const cooldowns = new Map();
const COOLDOWN_TIME = 600000; // 10 minutes

// --- SERVICES LIST ---
const services = [
    { name: 'Minecraft', value: 'minecraft' },
    { name: 'Discord Nitro (Link)', value: 'nitro' },
    { name: 'Crunchyroll', value: 'crunchyroll' }
];

const getPath = (s) => `./${s}.txt`;

// --- SLASH COMMANDS DEFINITION ---
const commands = [
    new SlashCommandBuilder()
        .setName('gen')
        .setDescription('Generate a random account or link')
        .addStringOption(opt => opt.setName('service').setDescription('Select the service').setRequired(true).addChoices(...services)),
    
    new SlashCommandBuilder().setName('stock').setDescription('Check current stock status'),
    new SlashCommandBuilder().setName('help').setDescription('Display available commands'),
    
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear all stock from a service (Staff only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt => opt.setName('service').setDescription('Service to clear').setRequired(true).addChoices(...services)),

    new SlashCommandBuilder()
        .setName('restock')
        .setDescription('Add stock via text or file (Staff only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt => opt.setName('service').setDescription('Target service').setRequired(true).addChoices(...services))
        .addStringOption(opt => opt.setName('data').setDescription('Account/Link (Optional if file provided)').setRequired(false))
        .addAttachmentOption(opt => opt.setName('file').setDescription('Upload a .txt file').setRequired(false))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
    client.user.setPresence({ status: 'dnd' });
    console.log(`✅ Will Bot is Online: ${client.user.tag}`);
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('🚀 Commands registered successfully.');
    } catch (e) { console.error(e); }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, user, member } = interaction;

    // --- HELP COMMAND ---
    if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('🤖 Will Bot - Help Menu')
            .setColor(0xFF0000)
            .setDescription('Here are the available commands:')
            .addFields(
                { name: '`/gen`', value: 'Generate an account or link (Sent to DMs).' },
                { name: '`/stock`', value: 'Check how many accounts are available.' },
                { name: '`/help`', value: 'Show this menu.' },
                { name: '`/restock`', value: 'Add more accounts using text or .txt files (Staff).' },
                { name: '`/clear`', value: 'Wipe all stock for a specific service (Staff).' }
            )
            .setFooter({ text: 'Will Bot V2 • Powered by Tomato Tech' });
        return interaction.reply({ embeds: [helpEmbed] });
    }

    // --- CLEAR COMMAND ---
    if (commandName === 'clear') {
        const service = options.getString('service');
        const path = getPath(service);
        if (!fs.existsSync(path)) return interaction.reply({ content: `❌ Error: ${service}.txt not found.`, ephemeral: true });
        fs.writeFileSync(path, ''); 
        return interaction.reply({ content: `✅ All stock for **${service}** has been cleared!`, ephemeral: true });
    }

    // --- GEN COMMAND ---
    if (commandName === 'gen') {
        const service = options.getString('service');
        
        if (cooldowns.has(user.id)) {
            const exp = cooldowns.get(user.id) + COOLDOWN_TIME;
            if (Date.now() < exp) {
                const wait = Math.ceil((exp - Date.now()) / 60000);
                return interaction.reply({ content: `❌ Cooldown active. Please wait **${wait} minutes**.`, ephemeral: true });
            }
        }

        const path = getPath(service);
        if (!fs.existsSync(path)) return interaction.reply({ content: `❌ Error: Database file for ${service} is missing.`, ephemeral: true });
        
        let data = fs.readFileSync(path, 'utf8').trim().split(/\n+/).filter(x => x.trim());

        if (data.length > 0) {
            const item = data.shift();
            fs.writeFileSync(path, data.join('\n'));

            const embed = new EmbedBuilder()
                .setTitle('🤖 Will Generator')
                .setColor(0xFF0000)
                .addFields(
                    { name: 'Service', value: service.toUpperCase(), inline: true },
                    { name: service === 'nitro' ? 'Link' : 'Account', value: `\`${item}\``, inline: true }
                )
                .setFooter({ text: 'Enjoy your reward!' });

            try {
                await user.send({ embeds: [embed] });
                cooldowns.set(user.id, Date.now());
                await interaction.reply({ content: `✅ **${service}** generated! Check your DMs.` });
            } catch {
                await interaction.reply({ content: '❌ I cannot send you DMs. Please open your privacy settings.', ephemeral: true });
            }
        } else {
            await interaction.reply({ content: `❌ Out of stock for **${service}**. Come back later!` });
        }
    }

    // --- STOCK COMMAND ---
    if (commandName === 'stock') {
        const embed = new EmbedBuilder().setTitle('📊 Stock Status').setColor(0xFF0000);
        services.forEach(s => {
            const path = getPath(s.value);
            const count = fs.existsSync(path) ? fs.readFileSync(path, 'utf8').trim().split(/\n+/).filter(x => x.trim()).length : 0;
            embed.addFields({ name: s.name, value: `\`${count}\` items`, inline: true });
        });
        await interaction.reply({ embeds: [embed] });
    }

    // --- RESTOCK COMMAND ---
    if (commandName === 'restock') {
        if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: "❌ You don't have permission to do that.", ephemeral: true });

        const service = options.getString('service');
        const inputData = options.getString('data');
        const file = options.getAttachment('file');
        const path = getPath(service);
        let contentToAdd = '';

        if (file) {
            const response = await fetch(file.url);
            const text = await response.text();
            contentToAdd = `\n${text.trim()}`;
        } else if (inputData) {
            contentToAdd = `\n${inputData.trim()}`;
        } else {
            return interaction.reply({ content: "❌ Provide either text data or a .txt file.", ephemeral: true });
        }

        fs.appendFileSync(path, contentToAdd);
        return interaction.reply({ content: `✅ Stock for **${service}** has been updated successfully!`, ephemeral: true });
    }
});

client.login(TOKEN);
  
