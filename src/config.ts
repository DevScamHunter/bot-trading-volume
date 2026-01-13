export const BOT_CONFIG = {
  collateralUsd: 10,      // tiền vào mỗi lệnh
  holdTimeMs: 1500,      //  giữ lệnh 10s
  retryDelayMs: 1_000,
  maxRetries: 2,
  usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  minEthToTrade: 0.0003
};
export const OSTIUM_PAIRS = [
  { id: 1, name: 'BTC/USD', maxLeverage: 50 },
  { id: 2, name: 'ETH/USD', maxLeverage: 100 },
  { id: 3, name: 'XAU/USD', maxLeverage: 150 },
  { id: 4, name: 'XAG/USD', maxLeverage: 50 }
];