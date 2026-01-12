export const OSTIUM_ABI = [
  {
    "type": "function",
    "name": "openTrade",
    "stateMutability": "nonpayable",
    "inputs": [
      { "name": "pairId", "type": "uint256" },
      { "name": "isLong", "type": "bool" },
      { "name": "collateral", "type": "uint256" },
      { "name": "leverage", "type": "uint256" },
      { "name": "orderType", "type": "uint8" }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "closeTrade",
    "stateMutability": "nonpayable",
    "inputs": [
      { "name": "tradeId", "type": "uint256" }
    ],
    "outputs": []
  },
  {
    "type": "event",
    "name": "TradeOpened",
    "inputs": [
      {
        "name": "tradeId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "trader",
        "type": "address",
        "indexed": true
      },
      {
        "name": "pairId",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  }
];
