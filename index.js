require('dotenv').config(); // Load environment variables from a .env file
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const fs = require('fs').promises; // Fix: Import fs module
const path = require('path');
const schedule = require('node-schedule');
const startCommandHandler = require('./startCommandHandler'); // Import /start handler
const { loadChatIds, saveChatIds } = require('./utils'); // Import utility functions

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN; // Set this in your .env file
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // Set this in your .env file
const RANGE = 'Sheet1!B2:C30'; // Adjust range to include both dates (B) and data (C)

if (!BOT_TOKEN || !SPREADSHEET_ID) {
  throw new Error('Missing BOT_TOKEN or SPREADSHEET_ID in environment variables.');
}

const bot = new Telegraf(BOT_TOKEN);

// OAuth2-related paths
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Google OAuth: Load saved credentials
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf8');
    return google.auth.fromJSON(JSON.parse(content));
  } catch (err) {
    return null;
  }
}

// Google OAuth: Save credentials
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

// Google OAuth: Authorize
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (!client) {
    client = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
    await saveCredentials(client);
  }
  return client;
}

// Google Sheets: Fetch data
async function fetchGoogleSheetData(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });

  const data = res.data.values || [];
  return data.map(row => {
    const date = row[0] ? row[0].trim() : ''; // Date from column B
    const entry = row[1] ? row[1].trim() : ''; // Data from column C
    return { date, entry }; // Return an object with both date and entry
  });
}

// Google Sheets: Clear range
async function clearGoogleSheet(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });
}

// Telegram: Handle /start command (using extracted handler)
bot.start(startCommandHandler);

// Telegram: Handle /fetch command
bot.command('fetch', async (ctx) => {
  try {
    const auth = await authorize();
    const entries = await fetchGoogleSheetData(auth);

    if (!entries.length) {
      return ctx.reply('Дані не знайдено в таблиці.');
    }

    const formatted = entries
      .map((entry, i) => {
        const date = entry.date ? entry.date : 'Дата відсутня'; // Display date if available
        return `${i + 1}. ${entry.entry} (Дата посту: ${date})`; // Include date in the response
      })
      .join('\n');

    await ctx.reply(`Підсумки постів з таблиці:\n\n${formatted}`);
  } catch (err) {
    console.error(err);
    await ctx.reply('Сталася помилка при запиті даних.');
  }
});

// Weekly Updates: Scheduled Task
schedule.scheduleJob('0 9 * * 1', async () => {
  console.log('Запуск щотижневого апдейту...');
  const chatIds = await loadChatIds();
  if (!chatIds.length) {
    console.log('Не знайдено жодних чат-айді, пропускаю щотижневий апдейт.');
    return;
  }

  try {
    const auth = await authorize();
    const entries = await fetchGoogleSheetData(auth);

    const formatted =
      entries.length > 0
        ? entries
            .map((entry, i) => {
              const date = entry.date ? entry.date : 'Дата відсутня'; // Display date if available
              return `${i + 1}. ${entry.entry} (Дата посту: ${date})`; // Include date in the update
            })
            .join('\n')
        : 'Нема доступних даних в таблиці.';

    for (const chatId of chatIds) {
      try {
        console.log(`Надсилаю щотижневний апдейт на чат-айді: ${chatId}`);
        await bot.telegram.sendMessage(chatId, `Щотижневий Апдейт:\n\n${formatted}`);
      } catch (err) {
        console.error(`Помилка надсилання на чат-айді ${chatId}:`, err.message);
      }
    }

    // Clear the spreadsheet after sending updates
    console.log('Очищую дані таблиці...');
    await clearGoogleSheet(auth);
    console.log('Таблиця успішно очищена.');
  } catch (err) {
    console.error('Помилка під час щотижневого апдейту:', err.message);
  }
});

// Start the bot
bot.launch();
console.log('Бот працює...');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
