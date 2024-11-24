const { loadChatIds, saveChatIds } = require('./utils'); // Assuming these functions are in utils.js

/**
 * Handle /start command for the bot.
 * @param {object} ctx - The Telegraf context object for the incoming message.
 */
async function startCommandHandler(ctx) {
  const chatId = ctx.chat.id;
  const chatIds = await loadChatIds();
  
  // If the chat ID doesn't exist, add it
  if (!chatIds.includes(chatId)) {
    chatIds.push(chatId);
    await saveChatIds(chatIds);
  }

  const userFirstName = ctx.from.first_name || 'there'; // Use the user's first name if available
  await ctx.reply(
    `Вітаю, ${userFirstName}! 👋 Використайте /fetch щоб отримати дані з гугл таблиці.\n` +
      `Також ви отримуватиме апдейти щотижнево.`
  );
}

module.exports = startCommandHandler;
