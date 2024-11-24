const fs = require('fs').promises;
const path = require('path');

const CHAT_IDS_FILE = path.join(process.cwd(), 'chat_ids.json');

/**
 * Load stored chat IDs.
 */
async function loadChatIds() {
  try {
    const content = await fs.readFile(CHAT_IDS_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return []; // No file means no chat IDs
    throw new Error(`Error loading chat IDs: ${err.message}`);
  }
}

/**
 * Save chat IDs to file.
 */
async function saveChatIds(chatIds) {
  try {
    await fs.writeFile(CHAT_IDS_FILE, JSON.stringify(chatIds, null, 2));
  } catch (err) {
    throw new Error(`Error saving chat IDs: ${err.message}`);
  }
}

module.exports = { loadChatIds, saveChatIds };
