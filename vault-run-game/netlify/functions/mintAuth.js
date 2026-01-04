import { ethers } from "ethers";

// === Proof contract addresses (Linea versions) ===
// Keep these aligned with your frontend txReedem.js
const DUST_ADDRESS = "0xF312Ec9f8087C87fbF3439B0369eA233a1EE4A7D";
const DUSTCLAIMV3_ADDRESS = "0xBB45cc85B5e6505Ad1C8403227Da68ba0F13357B";

// Events must match your txReedem.js
const DUST_ABI_EVENTS = [
  "event Claimed(address indexed user, uint256 amount, uint256 timestamp)"
];

const DUSTCLAIM_ABI_EVENTS = [
  "event DustClaimed(address indexed user, address indexed token, uint256 amountIn, uint256 ethOut)"
];

const dustIface = new ethers.Interface(DUST_ABI_EVENTS);
const claimIface = new ethers.Interface(DUSTCLAIM_ABI_EVENTS);

// ERC1155 relics contract: only need nonces(to)
const RELICS_READ_ABI = [
  "function nonces(address) view returns (uint256)"
];

// Rarity IDs (must match DustRelics1155.sol)
const RELIC = {
  SILVER: 1,
  GOLD: 2,
  DIAMOND: 3,
  EMERALD: 4
};

// Tune rarity logic here
function computeRarityFromProof({ kind, ethOut }) {
  if (kind === "DUST_DAILY") return RELIC.SILVER;

  // Sweep: rarity based on ETH out (wei)
  const eth = Number(ethers.formatEther(ethOut || 0n));

  // Example thresholds (adjust to taste)
  if (eth >= 0.02) return RELIC.EMERALD;
  if (eth >= 0.01) return RELIC.DIAMOND;
  if (eth >= 0.004) return RELIC.GOLD;
  return RELIC.SILVER;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        body: "",
      };
    }

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

    // Linea RPC (mint chain + proof chain if you are enforcing Linea-only proofs)
    const rpcUrl = process.env.LINEA_RPC_URL;
    if (!rpcUrl) return json(500, { ok: false, reason: "Missing LINEA_RPC_URL" });

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

    // Parse proof events exactly like frontend
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

          proof = {
            ok: true,
            kind: "DUST_DAILY",
            user,
            amount: parsed.args.amount,
            timestamp: Number(parsed.args.timestamp),
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
          };
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

          proof = {
            ok: true,
            kind: "SWEEP",
            user,
            token: parsed.args.token,
            amountIn: parsed.args.amountIn,
            ethOut: parsed.args.ethOut,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
          };
          break;
        } catch {}
      }
    }

    if (!proof?.ok) {
      return json(400, { ok: false, reason: "No valid proof event found in this transaction." });
    }

    // Rarity
    const rarityId = computeRarityFromProof({
      kind: proof.kind,
      ethOut: proof.ethOut,
    });

    // One mint per proof
    const amount = 1;

    // txHash is already bytes32 formatted
    const txHash32 = tx.toLowerCase();

    // Read nonce from the ERC1155 contract on Linea
    const relicsRead = new ethers.Contract(nftContract, RELICS_READ_ABI, provider);
    const nonce = await relicsRead.nonces(expectedUser);

    // Signer key
    const signerPk = process.env.MINT_SIGNER_PRIVATE_KEY;
    if (!signerPk) return json(500, { ok: false, reason: "Missing MINT_SIGNER_PRIVATE_KEY" });

    const signer = new ethers.Wallet(signerPk);

    const deadline = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minutes

    // Must match: EIP712("DustRelics1155","1")
    const domain = {
      name: "DustRelics1155",
      version: "1",
      chainId: 59144,
      verifyingContract: nftContract,
    };

    // Must match Solidity typehash string exactly:
    // "Mint(address to,uint256 id,uint256 amount,bytes32 txHash,uint256 nonce,uint256 deadline)"
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

    return json(200, {
      ok: true,
      kind: proof.kind,
      rarityId,
      amount,
      txHash32,
      nonce: nonce.toString(),
      deadline,
      signature,
      proof: {
        kind: proof.kind,
        txHash: proof.txHash,
        blockNumber: proof.blockNumber,
        user: proof.user,
        ...(proof.kind === "DUST_DAILY"
          ? { amount: proof.amount.toString(), timestamp: proof.timestamp }
          : { token: proof.token, amountIn: proof.amountIn.toString(), ethOut: proof.ethOut.toString() }),
      },
    });
  } catch (e) {
    return json(500, { ok: false, reason: e?.message || "Server error" });
  }
}