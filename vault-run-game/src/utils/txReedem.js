// src/utils/txReedem.js
import { ethers } from "ethers";

// -----------------------------
// Linea Mainnet Addresses
// -----------------------------
export const DUST_ADDRESS = "0xF312Ec9f8087C87fbF3439B0369eA233a1EE4A7D";
export const DUSTCLAIMV3_ADDRESS = "0xBB45cc85B5e6505Ad1C8403227Da68ba0F13357B";

// -----------------------------
// DustRelics1155 (ERC1155) config
// IMPORTANT: set this in .env to avoid hardcoding:
// VITE_DUSTRELICS1155_ADDRESS="0x..."
// -----------------------------
export const DUSTRELICS1155_ADDRESS = import.meta.env.VITE_DUSTRELICS1155_ADDRESS || "";

// Rarity IDs (MUST match the contract)
export const RELIC_ID = {
  SILVER: 1, // Common
  GOLD: 2, // Rare
  DIAMOND: 3, // Epic
  EMERALD: 4, // Legendary
};

// Chest roll mapping (MUST match VaultRunGame.jsx text)
export const CHEST_RARITY_TO_ID = {
  "Common Relic": RELIC_ID.SILVER,
  "Rare Relic": RELIC_ID.GOLD,
  "Epic Relic": RELIC_ID.DIAMOND,
  "Legendary Relic": RELIC_ID.EMERALD,
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

// ERC1155 Relics: helpful for on-chain verification / UX
const RELICS1155_ABI_READ = [
  "function minted(uint256 id) view returns (uint256)",
  "function usedTxHash(bytes32 txHash) view returns (bool)",
  "function nonces(address user) view returns (uint256)",
  "function MAX_SUPPLY_PER_ID() view returns (uint256)",
  "function signer() view returns (address)",
  "function mintingEnabled() view returns (bool)",
  "event RelicMinted(address indexed to, uint256 indexed id, uint256 amount, bytes32 indexed txHash)",
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
  // tx hash is already 32 bytes hex string
  return h;
}

export function getExplorerTxUrl(chainMetaOrUrl, txHash) {
  if (!txHash) return "";
  const base =
    typeof chainMetaOrUrl === "string"
      ? chainMetaOrUrl
      : chainMetaOrUrl?.explorer || "";
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/tx/${txHash}`;
}

function normAddr(a) {
  return (a || "").toLowerCase();
}

async function safeGetReceipt(provider, txHash) {
  try {
    return await provider.getTransactionReceipt(txHash);
  } catch (e) {
    // Provider can throw on malformed hashes / rate limits
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
    return { ok: false, reason: "Transaction not found yet (still pending or wrong hash)." };
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
        amount: parsed.args.amount, // BigInt
        timestamp: Number(parsed.args.timestamp),
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch {
      // ignore non-matching logs
    }
  }

  return { ok: false, reason: "No Dust Claimed event found in this transaction." };
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
    return { ok: false, reason: "Transaction not found yet (still pending or wrong hash)." };
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
        amountIn: parsed.args.amountIn, // BigInt
        ethOut: parsed.args.ethOut, // BigInt
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch {
      // ignore non-matching logs
    }
  }

  return { ok: false, reason: "No DustClaimed event found in this transaction." };
}

// -----------------------------
// Relics (ERC1155) helpers for the UI/backend flow
// NOTE: the actual mint requires a SERVER signature, so this file focuses on:
// - checking whether a txHash is already used on-chain
// - reading the user nonce for signing
// - reading minted supply / caps for displaying "sold out"
// -----------------------------
export function getRelicsContract(providerOrSigner) {
  if (!DUSTRELICS1155_ADDRESS) return null;
  if (!providerOrSigner) return null;
  return new ethers.Contract(DUSTRELICS1155_ADDRESS, RELICS1155_ABI_READ, providerOrSigner);
}

export async function getRelicsMintStatus({ provider, txHash, user, id }) {
  const c = getRelicsContract(provider);
  if (!c) {
    return {
      ok: false,
      reason: "Relics contract not configured. Set VITE_DUSTRELICS1155_ADDRESS.",
    };
  }

  const out = {
    ok: true,
    mintingEnabled: null,
    signer: null,
    maxSupplyPerId: null,
    minted: null,
    usedTxHash: null,
    nonce: null,
  };

  try {
    const bytes32Hash = toBytes32TxHash(txHash);
    const [enabled, signerAddr, maxSupply, mintedCount, used, nonce] = await Promise.all([
      c.mintingEnabled(),
      c.signer(),
      c.MAX_SUPPLY_PER_ID(),
      typeof id === "number" ? c.minted(id) : Promise.resolve(null),
      c.usedTxHash(bytes32Hash),
      user ? c.nonces(user) : Promise.resolve(null),
    ]);

    out.mintingEnabled = Boolean(enabled);
    out.signer = signerAddr;
    out.maxSupplyPerId = maxSupply; // BigInt
    out.minted = mintedCount; // BigInt | null
    out.usedTxHash = Boolean(used);
    out.nonce = nonce; // BigInt | null

    return out;
  } catch (e) {
    return { ok: false, reason: e?.message || "Failed to read Relics contract." };
  }
}

// Parse RelicMinted event from a receipt (optional UX)
export function parseRelicMintedFromReceipt(receipt) {
  if (!receipt || !receipt.logs) return null;
  const iface = new ethers.Interface([
    "event RelicMinted(address indexed to, uint256 indexed id, uint256 amount, bytes32 indexed txHash)",
  ]);

  for (const log of receipt.logs) {
    try {
      const p = iface.parseLog(log);
      if (p?.name !== "RelicMinted") continue;
      return {
        to: p.args.to,
        id: Number(p.args.id),
        amount: p.args.amount, // BigInt
        txHash: p.args.txHash, // bytes32
      };
    } catch {
      // ignore
    }
  }
  return null;
}