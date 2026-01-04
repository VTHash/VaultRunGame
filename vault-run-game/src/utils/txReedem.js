import { ethers } from "ethers";

export const DUST_ADDRESS = "0xF312Ec9f8087C87fbF3439B0369eA233a1EE4A7D";
export const DUSTCLAIMV3_ADDRESS = "0xBB45cc85B5e6505Ad1C8403227Da68ba0F13357B";

const DUST_ABI_EVENTS = [
  "event Claimed(address indexed user, uint256 amount, uint256 timestamp)"
];

const DUSTCLAIM_ABI_EVENTS = [
  "event DustClaimed(address indexed user, address indexed token, uint256 amountIn, uint256 ethOut)"
];

const dustIface = new ethers.Interface(DUST_ABI_EVENTS);
const claimIface = new ethers.Interface(DUSTCLAIM_ABI_EVENTS);

export async function verifyDustClaimTx({ provider, txHash, expectedUser }) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { ok: false, reason: "Transaction not found yet (still pending or wrong hash)." };
  if (receipt.status !== 1) return { ok: false, reason: "Transaction failed." };

  const expected = expectedUser?.toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== DUST_ADDRESS.toLowerCase()) continue;

    try {
      const parsed = dustIface.parseLog(log);
      if (parsed?.name !== "Claimed") continue;

      const user = parsed.args.user;
      if (expected && user.toLowerCase() !== expected) {
        return { ok: false, reason: "This tx was not made by the connected wallet." };
      }

      return {
        ok: true,
        kind: "DUST_DAILY",
        user,
        amount: parsed.args.amount,
        timestamp: Number(parsed.args.timestamp),
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      };
    } catch {
      // ignore non-matching logs
    }
  }

  return { ok: false, reason: "No Dust Claimed event found in this transaction." };
}

export async function verifySweepTx({ provider, txHash, expectedUser }) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { ok: false, reason: "Transaction not found yet (still pending or wrong hash)." };
  if (receipt.status !== 1) return { ok: false, reason: "Transaction failed." };

  const expected = expectedUser?.toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== DUSTCLAIMV3_ADDRESS.toLowerCase()) continue;

    try {
      const parsed = claimIface.parseLog(log);
      if (parsed?.name !== "DustClaimed") continue;

      const user = parsed.args.user;
      if (expected && user.toLowerCase() !== expected) {
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
        blockNumber: receipt.blockNumber
      };
    } catch {
      // ignore non-matching logs
    }
  }

  return { ok: false, reason: "No DustClaimed event found in this transaction." };
}

