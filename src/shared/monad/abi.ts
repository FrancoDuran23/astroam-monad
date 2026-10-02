// Hand-written to match contracts/src/AstroAmEscrow.sol. viem uses this both
// in the mission API's typed data and in scripts/deploy-monad-escrow.ts.
export const astroAmEscrowAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "usdc_", type: "address" },
      { name: "payee_", type: "address" },
      { name: "timeoutSeconds_", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "topUp",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "close",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "cumulativeAmount", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "escrows",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [
      { name: "traveler", type: "address" },
      { name: "openedAt", type: "uint96" },
      { name: "deposit", type: "uint256" },
      { name: "settled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "voucherHash",
    stateMutability: "view",
    inputs: [
      { name: "escrowId", type: "bytes32" },
      { name: "cumulativeAmount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "payee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "timeoutSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "usdcDecimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
