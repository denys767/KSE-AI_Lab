require('dotenv').config(); // Load environment variables from a .env file
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const fs = require('fs').promises;
const path = require('path');
const schedule = require('node-schedule');
const { loadChatIds, saveChatIds } = require('./utils'); // Utility functions

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN; // Set this in your .env file
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // Set this in your .env file
const RANGE = 'Sheet1!B2:D30';

if (!BOT_TOKEN || !SPREADSHEET_ID) {
  throw new Error('Missing BOT_TOKEN or SPREADSHEET_ID in environment variables.');
}

const bot = new Telegraf(BOT_TOKEN);

// OAuth2-related paths
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Load saved credentials
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf8');
    return google.auth.fromJSON(JSON.parse(content));
  } catch (err) {
    return null;
  }
}

// Save credentials
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

// Authorize
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (!client) {
    client = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
    await saveCredentials(client);
  }
  return client;
}

// Process text to extract links and replace them with placeholders
function processText(entryText) {
  const linkRegex = /(https?:\/\/[^\s]+)/g;
  const links = [];
  let counter = 1;

  const processedText = entryText.replace(linkRegex, (match) => {
    links.push(`[${counter}]: ${match}`);
    return `***[${counter++}]***`; // Replace link with placeholder
  });

  return { text: processedText, links };
}

// Fetch data from Google Sheets (with links from column D)
async function fetchGoogleSheetData(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });

  const data = res.data.values || [];
  return data.map(row => {
    const date = row[0] ? row[0].trim() : ''; // Date from column B
    const entry = row[1] ? row[1].trim() : ''; // Text from column C
    const links = row[2] ? row[2].trim().split(/\s*,\s*/) : []; // Links from column D (split by commas)
    return { date, entry, links };
  });
}

// Function to clear data in Google Sheets
async function clearGoogleSheet(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE, // Clear the same range used for fetching data
    });
    console.log('Гугл-таблиця успішно очищена.');
  } catch (err) {
    console.error('Помилка очищення гугл-таблиці:', err);
  }
}


const formatLinks = (links) => {
  return links.length
    ? `Список посилань:\n${links.map((link) => `${link}`).join('\n')}\n`
    : '';
};

// Send summaries to users and clear the table
async function sendSummaries() {
  try {
    const auth = await authorize();
    const entries = await fetchGoogleSheetData(auth);
    const chatIds = await loadChatIds();

    if (!entries.length) return;

    const message = entries
      .map((entry) => {
        const date = entry.date || 'Дата відсутня';
        const linksText = formatLinks(entry.links);

        return `(Дата: ${date})\n${linksText}\n${entry.entry}`;
      })
      .join('\n\n'); // Separate entries with double spacing

    for (const chatId of chatIds) {
      await bot.telegram.sendMessage(chatId, `Підсумки за тиждень:\n\n${message}`, {
        parse_mode: 'Markdown',
      });
    }

    // Clear the table after sending summaries
    await clearGoogleSheet(auth);
  } catch (err) {
    console.error('Помилка надсилання дайджесту:', err);
  }
}
// Handle /start command
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const chatIds = await loadChatIds();

  if (!chatIds.includes(chatId)) {
    chatIds.push(chatId);
    await saveChatIds(chatIds);
  }

  ctx.reply('Ласкаво просимо! Ви отримуватимете щотижневі підсумки.');
});

// Handle /fetch command
bot.command('fetch', async (ctx) => {
  try {
    const auth = await authorize();
    const entries = await fetchGoogleSheetData(auth);

    if (!entries.length) {
      return ctx.reply('Дані не знайдено в таблиці.');
    }

    const message = entries
      .map((entry) => {
        const date = entry.date || 'Дата відсутня';
        const linksText = formatLinks(entry.links);

        return `(Дата: ${date})\n${linksText}\n${entry.entry}`;
      })
      .join('\n\n'); // Separate entries with double spacing

    ctx.replyWithMarkdown(`Дайджест за тиждень (отримано вручну):\n\n${message}`);
  } catch (err) {
    console.error(err);
    ctx.reply('Сталася помилка при запиті даних.');
  }
});

// Schedule weekly summaries at 9:00 AM Monday
schedule.scheduleJob('0 9 * * 1', sendSummaries); // Cron syntax: '0 9 * * 1' Monday at 9:00 AM

// Start the bot
bot.launch();
console.log('Бот працює...');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
