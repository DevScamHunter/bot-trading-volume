export const OSTIUM_ABI = [
  // ===== OPEN =====
  {
    type: 'function',
    name: 'openTrade',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pairId', type: 'uint256' },
      { name: 'isLong', type: 'bool' },
      { name: 'collateral', type: 'uint256' },
      { name: 'leverage', type: 'uint256' },
      { name: 'orderType', type: 'uint8' }
    ],
    outputs: []
  },

  // ===== CLOSE =====
  {
    type: 'function',
    name: 'closeTrade',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tradeId', type: 'uint256' }
    ],
    outputs: []
  },

  // ===== EVENTS =====
  {
    type: 'event',
    name: 'TradeOpened',
    anonymous: false,
    inputs: [
      { name: 'tradeId', type: 'uint256', indexed: true },
      { name: 'trader', type: 'address', indexed: true },
      { name: 'pairId', type: 'uint256', indexed: false }
    ]
  },

  {
    type: 'event',
    name: 'TradeClosed',
    anonymous: false,
    inputs: [
      { name: 'tradeId', type: 'uint256', indexed: true },
      { name: 'trader', type: 'address', indexed: true }
    ]
  }
];
