import { ethers } from "ethers";

// === Proof contract addresses (Linea) ===
const DUST_ADDRESS = "0xF312Ec9f8087C87fbF3439B0369eA233a1EE4A7D";
const DUSTCLAIMV3_ADDRESS = "0xBB45cc85B5e6505Ad1C8403227Da68ba0F13357B";

// Events (must match txReedem.js)
const DUST_ABI_EVENTS = [
  "event Claimed(address indexed user, uint256 amount, uint256 timestamp)",
];

const DUSTCLAIM_ABI_EVENTS = [
  "event DustClaimed(address indexed user, address indexed token, uint256 amountIn, uint256 ethOut)",
];

const dustIface = new ethers.Interface(DUST_ABI_EVENTS);
const claimIface = new ethers.Interface(DUSTCLAIM_ABI_EVENTS);

// ERC1155 relics: read nonce
const RELICS_READ_ABI = [
  "function nonces(address) view returns (uint256)",
];

// ---------------------------------------
// IMPORTANT: deterministic rarity by txHash
// MUST match frontend thresholds exactly.
// ---------------------------------------
function rarityFromTxHash(txHash) {
  const h = ethers.keccak256(ethers.getBytes(txHash));
  const n = Number(BigInt(h.slice(0, 10))); // first 4 bytes
  const pct = n / 0xffffffff;

  if (pct > 0.92) return 4; // EMERALD
  if (pct > 0.75) return 3; // DIAMOND
  if (pct > 0.45) return 2; // GOLD
  return 1; // SILVER
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(204, { ok: true });

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, reason: "Method not allowed" });
    }

    const { txHash, expectedUser, nftContract } = JSON.parse(event.body || "{}");

    const tx = String(txHash || "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(tx)) {
      return json(400, { ok: false, reason: "Invalid txHash" });
    }
    if (!expectedUser || !ethers.isAddress(expectedUser)) {
      return json(400, { ok: false, reason: "Invalid expectedUser" });
    }
    if (!nftContract || !ethers.isAddress(nftContract)) {
      return json(400, { ok: false, reason: "Invalid nftContract" });
    }

    // ENV must be present in Netlify site settings
    const rpcUrl = process.env.LINEA_RPC_URL;
    const signerPk = process.env.MINT_SIGNER_PRIVATE_KEY;

    if (!rpcUrl) return json(500, { ok: false, reason: "Missing LINEA_RPC_URL" });
    if (!signerPk) return json(500, { ok: false, reason: "Missing MINT_SIGNER_PRIVATE_KEY" });

    // Logging (safe)
    console.log("[mintAuth] request", {
      txHash: tx.slice(0, 10) + "...",
      expectedUser,
      nftContract,
    });

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Fetch receipt for proof tx on Linea
    const receipt = await provider.getTransactionReceipt(tx);
    if (!receipt) {
      return json(400, { ok: false, reason: "Transaction not found yet (pending or wrong hash)." });
    }
    if (receipt.status !== 1) {
      return json(400, { ok: false, reason: "Transaction failed." });
    }

    const expected = expectedUser.toLowerCase();

    // Parse proof events
    let proof = null;

    for (const log of receipt.logs) {
      const addr = log.address.toLowerCase();

      // Daily claim proof
      if (addr === DUST_ADDRESS.toLowerCase()) {
        try {
          const parsed = dustIface.parseLog(log);
          if (parsed?.name !== "Claimed") continue;

          const user = String(parsed.args.user);
          if (user.toLowerCase() !== expected) {
            return json(400, { ok: false, reason: "This tx was not made by the connected wallet." });
          }

          proof = { kind: "DUST_DAILY", user };
          break;
        } catch {}
      }

      // Sweep proof
      if (addr === DUSTCLAIMV3_ADDRESS.toLowerCase()) {
        try {
          const parsed = claimIface.parseLog(log);
          if (parsed?.name !== "DustClaimed") continue;

          const user = String(parsed.args.user);
          if (user.toLowerCase() !== expected) {
            return json(400, { ok: false, reason: "This tx was not made by the connected wallet." });
          }

          proof = { kind: "SWEEP", user };
          break;
        } catch {}
      }
    }

    if (!proof) {
      return json(400, { ok: false, reason: "No valid proof event found in this transaction." });
    }

    // Deterministic rarity (same as frontend)
    const rarityId = rarityFromTxHash(tx);
    const amount = 1;
    const txHash32 = tx.toLowerCase();

    // Read nonce from ERC1155 contract
    const relicsRead = new ethers.Contract(nftContract, RELICS_READ_ABI, provider);
    const nonce = await relicsRead.nonces(expectedUser);

    const signer = new ethers.Wallet(signerPk);

    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;

    // Must match contract domain exactly
    const domain = {
      name: "DustRelics1155",
      version: "1",
      chainId: 59144,
      verifyingContract: nftContract,
    };

    // Must match Solidity typehash exactly
    const types = {
      Mint: [
        { name: "to", type: "address" },
        { name: "id", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "txHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const value = {
      to: expectedUser,
      id: rarityId,
      amount,
      txHash: txHash32,
      nonce: nonce.toString(),
      deadline,
    };

    const signature = await signer.signTypedData(domain, types, value);

    console.log("[mintAuth] signed", {
      kind: proof.kind,
      rarityId,
      nonce: nonce.toString(),
      deadline,
    });

    return json(200, {
      ok: true,
      kind: proof.kind,
      rarityId,
      amount,
      txHash32,
      nonce: nonce.toString(),
      deadline,
      signature,
    });
  } catch (e) {
    console.log("[mintAuth] error", e?.message || e);
    return json(500, { ok: false, reason: e?.message || "Server error" });
  }
}
