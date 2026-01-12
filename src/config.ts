export const BOT_CONFIG = {
  collateralUsd: 1,      // tiền vào mỗi lệnh
  holdTimeMs: 10_000,      //  giữ lệnh 10s
  retryDelayMs: 3_000,
  maxRetries: 5,
  usdcAddress: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
};
export const OSTIUM_PAIRS = [
  { id: 1, name: 'BTC/USD', maxLeverage: 100 },
  { id: 2, name: 'ETH/USD', maxLeverage: 100 },
  { id: 3, name: 'XAU/USD', maxLeverage: 150 },
  { id: 4, name: 'XAG/USD', maxLeverage: 50 }
];