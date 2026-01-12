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

console.log({
  RPC: process.env.ARB_RPC,
  PK: process.env.PRIVATE_KEY?.length,
  CONTRACT: process.env.OSTIUM_CONTRACT
});