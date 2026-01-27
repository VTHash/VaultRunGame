// src/utils/txReedem.js
import { ethers } from "ethers";

// -----------------------------
// Linea Mainnet Addresses
// -----------------------------
export const DUST_ADDRESS = "0xF312Ec9f8087C87fbF3439B0369eA233a1EE4A7D";
export const DUSTCLAIMV3_ADDRESS = "0x3Cef985383FE054Bb43152480484fA28fC942A06";

// -----------------------------
// DustRelics1155 (ERC1155) config
// -----------------------------
export const DUSTRELICS1155_ADDRESS =
  import.meta.env.VITE_DUSTRELICS1155_ADDRESS ||
  import.meta.env.VITE_DUST_RELICS_ADDRESS || // fallback if you used older key
  "";

// Rarity IDs (MUST match the contract)
export const RELIC_ID = {
  SILVER: 1,
  GOLD: 2,
  DIAMOND: 3,
  EMERALD: 4,
};

// -----------------------------
// Event ABIs (minimal, fast)
// -----------------------------
const DUST_ABI_EVENTS = [
  "event Claimed(address indexed user, uint256 amount, uint256 timestamp)",
];

const DUSTCLAIM_ABI_EVENTS = [
  "event DustClaimed(address indexed user, address indexed token, uint256 amountIn, uint256 ethOut)",
];

const dustIface = new ethers.Interface(DUST_ABI_EVENTS);
const claimIface = new ethers.Interface(DUSTCLAIM_ABI_EVENTS);

// -----------------------------
// Helpers
// -----------------------------
export function isLikelyTxHash(s) {
  return /^0x([A-Fa-f0-9]{64})$/.test((s || "").trim());
}

export function toBytes32TxHash(txHash) {
  const h = (txHash || "").trim();
  if (!isLikelyTxHash(h)) throw new Error("Invalid tx hash");
  return h.toLowerCase();
}

function normAddr(a) {
  return (a || "").toLowerCase();
}

async function safeGetReceipt(provider, txHash) {
  try {
    return await provider.getTransactionReceipt(txHash);
  } catch {
    return null;
  }
}

// -----------------------------
// Verify Dust daily claim tx (Claimed event)
// -----------------------------
export async function verifyDustClaimTx({ provider, txHash, expectedUser }) {
  const hash = (txHash || "").trim();
  if (!isLikelyTxHash(hash)) {
    return { ok: false, reason: "Invalid tx hash format." };
  }

  const receipt = await safeGetReceipt(provider, hash);
  if (!receipt) {
    return { ok: false, reason: "Transaction not found yet (pending / wrong hash / wrong network)." };
  }
  if (receipt.status !== 1) return { ok: false, reason: "Transaction failed." };

  const expected = expectedUser ? normAddr(expectedUser) : null;

  for (const log of receipt.logs || []) {
    if (normAddr(log.address) !== normAddr(DUST_ADDRESS)) continue;

    try {
      const parsed = dustIface.parseLog(log);
      if (!parsed || parsed.name !== "Claimed") continue;

      const user = parsed.args.user;
      if (expected && normAddr(user) !== expected) {
        return { ok: false, reason: "This tx was not made by the connected wallet." };
      }

      return {
        ok: true,
        kind: "DUST_DAILY",
        user,
        amount: parsed.args.amount,
        timestamp: Number(parsed.args.timestamp),
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch {
      // ignore
    }
  }

  // FIX: message previously said "Dust Claimed event" (wrong wording)
  return { ok: false, reason: "No Claimed event found in this transaction." };
}

// -----------------------------
// Verify DustClaimV3 sweep tx (DustClaimed event)
// -----------------------------
export async function verifySweepTx({ provider, txHash, expectedUser }) {
  const hash = (txHash || "").trim();
  if (!isLikelyTxHash(hash)) {
    return { ok: false, reason: "Invalid tx hash format." };
  }

  const receipt = await safeGetReceipt(provider, hash);
  if (!receipt) {
    return { ok: false, reason: "Transaction not found yet (pending / wrong hash / wrong network)." };
  }
  if (receipt.status !== 1) return { ok: false, reason: "Transaction failed." };

  const expected = expectedUser ? normAddr(expectedUser) : null;

  for (const log of receipt.logs || []) {
    if (normAddr(log.address) !== normAddr(DUSTCLAIMV3_ADDRESS)) continue;

    try {
      const parsed = claimIface.parseLog(log);
      if (!parsed || parsed.name !== "DustClaimed") continue;

      const user = parsed.args.user;
      if (expected && normAddr(user) !== expected) {
        return { ok: false, reason: "This tx was not made by the connected wallet." };
      }

      return {
        ok: true,
        kind: "SWEEP",
        user,
        token: parsed.args.token,
        amountIn: parsed.args.amountIn,
        ethOut: parsed.args.ethOut,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch {
      // ignore
    }
  }

  return { ok: false, reason: "No DustClaimed event found in this transaction." };
}
