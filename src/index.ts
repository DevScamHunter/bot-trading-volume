import 'dotenv/config';
import { OstiumVolumeBot } from './bot.js';

const bot = new OstiumVolumeBot();

process.on('SIGINT', async () => {
  await bot.stopAndReport();
});

process.on('SIGTERM', async () => {
  await bot.stopAndReport();
});

bot.start();
