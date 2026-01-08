// src/components/VaultRunGame.jsx
// PERFECT ALIGNMENT with:
// - DustRelics1155.sol (mintWithSig + nonce-based EIP712)
// - mintAuth.js (Netlify) returning: { ok, rarityId, amount, txHash32, nonce, deadline, signature }
// - txReedem.js verifyDustClaimTx / verifySweepTx
//
// Key behavior:
// 1) User redeems a proof txHash => Keys + XP are granted locally (persisted).
// 2) Mint consumes 1 Key ONLY after on-chain mint success.
// 3) Rarity is deterministic from proof txHash (prevents reroll abuse).
// 4) Frontend sends rarityId + amount to mintAuth, and enforces server matches them.
// 5) Every button uses type="button" to prevent form-submit issues.
//
// Wallet behavior (APP-OWNED):
// - Connect Wallet button calls onConnectWallet() (Reown AppKit modal) (works on mobile + desktop).
// - For minting, we use walletProvider (EIP-1193) passed from App if available,
// otherwise fallback to injected provider if present.
// - We auto-switch to Linea Mainnet before minting.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import "./VaultRunGame.css";
import {
  DUST_ADDRESS,
  DUSTCLAIMV3_ADDRESS,
  verifyDustClaimTx,
  verifySweepTx
} from "../utils/txReedem";

const RUN_SECONDS = 90;
const START_ENERGY = 5;
const VAULT_COUNT = 12;
const COMBO_WINDOW_MS = 8000;

const LS_KEY = "dustclaim_vault_run_state_v2"; // bump version to avoid old/broken state

const REWARD = {
  daily: { keys: 1, xp: 250 },
  sweep: { maxKeys: 10, minKeys: 1, xpBase: 250 }
};

const RISK = {
  LOW: { key: "LOW", label: "Low", success: 0.92, timeCostMs: 800 },
  MED: { key: "MED", label: "Med", success: 0.82, timeCostMs: 1200 },
  HIGH: { key: "HIGH", label: "High", success: 0.68, timeCostMs: 1600 }
};

const TIERS = {
  TINY: { key: "TINY", label: "Tiny", baseUsd: [0.05, 0.5] },
  SMALL: { key: "SMALL", label: "Small", baseUsd: [0.5, 3.0] },
  MED: { key: "MED", label: "Medium", baseUsd: [3.0, 15.0] },
  BIG: { key: "BIG", label: "Big", baseUsd: [15.0, 75.0] }
};

const LINEA_CHAIN_ID = 59144;

// For wallet_switchEthereumChain / add chain
const LINEA_PARAMS = {
  chainId: "0xE708", // 59144
  chainName: "Linea Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.linea.build"],
  blockExplorerUrls: ["https://lineascan.build"]
};

// Solidity IDs (DustRelics1155)
const RELIC = {
  1: "SilverDust", // Common
  2: "GoldenDust", // Rare
  3: "DiamondDust", // Epic
  4: "EmeraldDust" // Legendary
};

// Contract ABI MUST match DustRelics1155.sol
const RELICS_ABI = [
  "function mintWithSig(uint256 id,uint256 amount,bytes32 txHash,uint256 deadline,bytes sig) external"
];

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function shortAddr(addr) {
  if (!addr) return "Not connected";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function weightedTier() {
  const r = Math.random();
  if (r < 0.45) return TIERS.TINY;
  if (r < 0.75) return TIERS.SMALL;
  if (r < 0.93) return TIERS.MED;
  return TIERS.BIG;
}

function weightedRisk(tierKey) {
  const r = Math.random();
  if (tierKey === TIERS.BIG.key) return r < 0.25 ? RISK.MED : RISK.HIGH;
  if (tierKey === TIERS.MED.key) return r < 0.45 ? RISK.MED : RISK.HIGH;
  return r < 0.7 ? RISK.LOW : RISK.MED;
}

function generateVaults(count = VAULT_COUNT) {
  const symbols = [
    "DUST","WETH","USDC","UNI","LINK","AAVE","MKR","LDO","ARB","OP",
    "PEPE","SHIB","CRV","SUSHI","1INCH","COMP","SNX","BAL","GRT","ENS"
  ];

  const used = new Set();
  const vaults = [];

  for (let i = 0; i < count; i++) {
    const tier = weightedTier();
    const risk = weightedRisk(tier.key);

    let sym = symbols[Math.floor(Math.random() * symbols.length)];
    let guard = 0;
    while (used.has(sym) && guard < 6) {
      sym = symbols[Math.floor(Math.random() * symbols.length)];
      guard++;
    }
    used.add(sym);

    const usd = randBetween(tier.baseUsd[0], tier.baseUsd[1]);
    const id = `${sym}-${i}-${Math.floor(Math.random() * 1e6)}`;

    vaults.push({
      id,
      symbol: sym,
      tierKey: tier.key,
      tierLabel: tier.label,
      riskKey: risk.key,
      riskLabel: risk.label,
      estUsd: usd,
      status: "READY"
    });
  }
  return vaults;
}

function gradeFromScore(score) {
  if (score >= 3500) return "S";
  if (score >= 2500) return "A";
  if (score >= 1600) return "B";
  if (score >= 900) return "C";
  return "D";
}

function valueBonus(usd) {
  const bonus = Math.floor(Math.log10(usd + 1) * 120);
  return clamp(bonus, 0, 420);
}

function comboMultiplier(comboCount) {
  if (comboCount <= 1) return 1.0;
  if (comboCount === 2) return 1.25;
  if (comboCount === 3) return 1.5;
  return 2.0;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      xp: Number(p.xp || 0),
      keys: Number(p.keys || 0),
      redeemedTxs: new Set(p.redeemedTxs || []),
      mintedProofs: new Set(p.mintedProofs || [])
    };
  } catch {
    return null;
  }
}

function saveState({ xp, keys, redeemedTxs, mintedProofs }) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        xp: Number(xp || 0),
        keys: Number(keys || 0),
        redeemedTxs: Array.from(redeemedTxs || []),
        mintedProofs: Array.from(mintedProofs || [])
      })
    );
  } catch {}
}

function clearState() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {}
}

function pickReadProvider(passedProvider) {
  if (passedProvider) return passedProvider;
  const rpc = import.meta.env.VITE_LINEA_RPC || import.meta.env.VITE_RPC_URL || "";
  if (!rpc) return null;
  return new ethers.JsonRpcProvider(rpc);
}

function isLikelyTxHash(s) {
  return /^0x([A-Fa-f0-9]{64})$/.test((s || "").trim());
}

function makeProofKey(hash, kind) {
  return `${String(kind || "UNKNOWN").toUpperCase()}:${String(hash || "").toLowerCase()}`;
}

function likelyLineaNetwork(chainId) {
  return Number(chainId) === LINEA_CHAIN_ID;
}

// Deterministic rarity from txHash (prevents reroll abuse).
function rarityFromTxHash(txHash) {
  const h = ethers.keccak256(ethers.getBytes(txHash));
  const n = Number(BigInt(h.slice(0, 10)));
  const pct = n / 0xffffffff;
  if (pct > 0.92) return 4;
  if (pct > 0.75) return 3;
  if (pct > 0.45) return 2;
  return 1;
}

// Ensure Linea on the current wallet provider session
async function ensureLinea(bp) {
  const net = await bp.getNetwork();
  if (likelyLineaNetwork(net.chainId)) return true;

  try {
    await bp.send("wallet_switchEthereumChain", [{ chainId: LINEA_PARAMS.chainId }]);
    return true;
  } catch (e) {
    const code = e?.code;
    const msg = String(e?.message || "").toLowerCase();

    // chain not added
    if (code === 4902 || msg.includes("unrecognized chain") || msg.includes("unknown chain")) {
      try {
        await bp.send("wallet_addEthereumChain", [LINEA_PARAMS]);
        await bp.send("wallet_switchEthereumChain", [{ chainId: LINEA_PARAMS.chainId }]);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export default function VaultRunGame({
  address: addressProp,
  provider: providerProp,
  walletProvider,
  onConnectWallet
}) {
  const [mode] = useState("PRACTICE");
  const [state, setState] = useState("IDLE");
  const [secondsLeft, setSecondsLeft] = useState(RUN_SECONDS);
  const [energy, setEnergy] = useState(START_ENERGY);
  const [vaults, setVaults] = useState(() => generateVaults());
  const [score, setScore] = useState(0);

  const [comboCount, setComboCount] = useState(0);
  const [comboEndsAt, setComboEndsAt] = useState(0);

  const [uniqueCleared, setUniqueCleared] = useState(() => new Set());
  const [toast, setToast] = useState("Redeem a txHash to receive Keys, then mint your Relic on Linea.");

  // progression
  const [xp, setXp] = useState(0);
  const [keys, setKeys] = useState(0);
  const [redeemedTxs, setRedeemedTxs] = useState(() => new Set());
  const [mintedProofs, setMintedProofs] = useState(() => new Set());
  const [chestMsg, setChestMsg] = useState("");

  // redeem/mint UI
  const [redeemType, setRedeemType] = useState("DAILY");
  const [txHash, setTxHash] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemResult, setRedeemResult] = useState(null);

  const [mintBusy, setMintBusy] = useState(false);
  const [mintMsg, setMintMsg] = useState("");
  const [mintResult, setMintResult] = useState(null);

  const timerRef = useRef(null);
  const isRunning = state === "RUNNING";

  const grade = useMemo(() => gradeFromScore(score), [score]);
  const clearedCount = useMemo(() => vaults.filter(v => v.status === "CLEARED").length, [vaults]);

  // Read provider for verifying tx receipts (RPC)
  const readProvider = useMemo(() => pickReadProvider(providerProp), [providerProp]);

  // env: accept both names, prefer VITE_DUSTRELICS1155_ADDRESS
  const RELICS_CONTRACT =
    import.meta.env.VITE_DUSTRELICS1155_ADDRESS ||
    import.meta.env.VITE_DUST_RELICS_ADDRESS ||
    "";

  // effective address comes from App prop (App.jsx uses useAppKitAccount)
  const effectiveAddress = useMemo(() => {
    if (addressProp && ethers.isAddress(addressProp)) return addressProp;
    return "";
  }, [addressProp]);

  // Load persisted
  useEffect(() => {
    const st = loadState();
    if (!st) return;
    setXp(st.xp);
    setKeys(st.keys);
    setRedeemedTxs(st.redeemedTxs);
    setMintedProofs(st.mintedProofs);
  }, []);

  // Persist
  useEffect(() => {
    saveState({ xp, keys, redeemedTxs, mintedProofs });
  }, [xp, keys, redeemedTxs, mintedProofs]);

  // Connect Wallet button (App-owned)
  function connectWallet() {
    if (typeof onConnectWallet === "function") {
      onConnectWallet();
      return;
    }
    setToast("Wallet connect is not configured.");
  }

  // Combo expiry
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      const now = Date.now();
      if (comboCount > 0 && comboEndsAt && now > comboEndsAt) {
        setComboCount(0);
        setComboEndsAt(0);
      }
    }, 250);
    return () => clearInterval(id);
  }, [isRunning, comboCount, comboEndsAt]);

  // Main timer
  useEffect(() => {
    if (!isRunning) return;

    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          setState("FINISHED");
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isRunning]);

  useEffect(() => {
    if (isRunning && energy <= 0) {
      setState("FINISHED");
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isRunning, energy]);

  function resetRun(newSeed = true) {
    setState("IDLE");
    setSecondsLeft(RUN_SECONDS);
    setEnergy(START_ENERGY);
    setScore(0);
    setComboCount(0);
    setComboEndsAt(0);
    setUniqueCleared(new Set());
    setToast("Run again, then redeem a txHash to receive Keys.");
    setChestMsg("");

    setRedeemResult(null);
    setMintMsg("");
    setMintResult(null);

    if (newSeed) setVaults(generateVaults());
    else setVaults(vaults.map(v => ({ ...v, status: "READY" })));
  }

  function startRun() {
    resetRun(true);
    setState("RUNNING");
  }

  function endRun() {
    setState("FINISHED");
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function resetInventory() {
    clearState();
    setXp(0);
    setKeys(0);
    setRedeemedTxs(new Set());
    setMintedProofs(new Set());
    setRedeemResult(null);
    setMintMsg("");
    setMintResult(null);
    setChestMsg("");
    setToast("Inventory reset on this device. Redeem your txHash again.");
  }

  async function clearVaultPractice(vaultId) {
    if (!isRunning || energy <= 0 || secondsLeft <= 0) return;

    const v = vaults.find(x => x.id === vaultId);
    if (!v || v.status !== "READY") return;

    setVaults(prev => prev.map(x => x.id === vaultId ? { ...x, status: "CLEARING" } : x));

    const risk = RISK[v.riskKey] || RISK.MED;
    await new Promise(res => setTimeout(res, risk.timeCostMs));

    const ok = Math.random() < risk.success;
    if (!ok) {
      setVaults(prev => prev.map(x => x.id === vaultId ? { ...x, status: "FAILED" } : x));
      setScore(s => Math.max(0, s - 75));
      setComboCount(0);
      setComboEndsAt(0);
      setEnergy(e => Math.max(0, e - 1));
      setToast(`${v.symbol} vault resisted: -75 score, -1 energy`);
      return;
    }

    const base = 100;
    const vBonus = valueBonus(v.estUsd);
    const isNewToken = !uniqueCleared.has(v.symbol);
    const diversity = isNewToken ? 40 : 0;

    const now = Date.now();
    const nextCombo = (comboCount > 0 && comboEndsAt && now <= comboEndsAt) ? comboCount + 1 : 1;
    const mult = comboMultiplier(nextCombo);
    const speed = Math.floor(mult * 25);
    const add = Math.floor((base + vBonus + diversity + speed) * mult);

    setVaults(prev => prev.map(x => x.id === vaultId ? { ...x, status: "CLEARED" } : x));
    setScore(s => s + add);
    setComboCount(nextCombo);
    setComboEndsAt(now + COMBO_WINDOW_MS);

    if (isNewToken) {
      setUniqueCleared(prev => {
        const n = new Set(prev);
        n.add(v.symbol);
        return n;
      });
    }

    setToast(`${v.symbol} cleared: +${add} score (combo x${mult.toFixed(2)})`);
  }

  function openChest() {
    setChestMsg("");
    if (keys <= 0) {
      setChestMsg("You need a Key. Redeem a txHash first.");
      return;
    }

    setKeys(k => Math.max(0, Number(k) - 1));

    const r = Math.random();
    let drop = "Common Relic";
    if (r > 0.92) drop = "Legendary Relic";
    else if (r > 0.75) drop = "Epic Relic";
    else if (r > 0.45) drop = "Rare Relic";
    setChestMsg(`Chest opened: ${drop} (cosmetic)`);
  }

  async function redeem() {
    const hash = (txHash || "").trim();

    if (!isLikelyTxHash(hash)) {
      setRedeemResult({ ok: false, reason: "Invalid tx hash format." });
      return;
    }
    if (!readProvider) {
      setRedeemResult({ ok: false, reason: "Missing RPC provider. Set VITE_LINEA_RPC (or VITE_RPC_URL)." });
      return;
    }
    if (!effectiveAddress || !ethers.isAddress(effectiveAddress)) {
      setRedeemResult({ ok: false, reason: "Connect wallet first (required to validate tx belongs to you)." });
      return;
    }

    const lower = hash.toLowerCase();
    if (redeemedTxs.has(lower)) {
      setRedeemResult({
        ok: false,
        reason: "This txHash was already redeemed on this device. If Keys show 0, press Reset Inventory and redeem again."
      });
      return;
    }

    setRedeemBusy(true);
    setRedeemResult(null);
    setMintMsg("");
    setMintResult(null);
    setChestMsg("");

    try {
      let res;

      if (redeemType === "DAILY") {
        res = await verifyDustClaimTx({ provider: readProvider, txHash: hash, expectedUser: effectiveAddress });
        if (!res.ok) {
          setRedeemResult(res);
          return;
        }

        setKeys(k => Number(k) + REWARD.daily.keys);
        setXp(x => Number(x) + REWARD.daily.xp);

        setRedeemedTxs(prev => {
          const n = new Set(prev);
          n.add(lower);
          return n;
        });

        const rarityId = rarityFromTxHash(hash);

        setRedeemResult({
          ok: true,
          kind: "DUST_DAILY",
          proofTxHash: hash,
          rarityId,
          rarity: RELIC[rarityId],
          msg: `Redeemed: +${REWARD.daily.keys} Key, +${REWARD.daily.xp} XP`,
          details: {
            user: res.user,
            proofTxHash: hash,
            blockNumber: res.blockNumber,
            rarityId,
            rarity: RELIC[rarityId]
          }
        });

        setToast("Redeem success: Key added. Mint now (mint consumes 1 Key).");
      } else {
        res = await verifySweepTx({ provider: readProvider, txHash: hash, expectedUser: effectiveAddress });
        if (!res.ok) {
          setRedeemResult(res);
          return;
        }

        const ethOutEth = Number(ethers.formatEther(res.ethOut));
        const rawKeys = Math.floor(ethOutEth * 100);
        const keysEarned = clamp(rawKeys, REWARD.sweep.minKeys, REWARD.sweep.maxKeys);
        const xpEarned = REWARD.sweep.xpBase + Math.min(750, Math.floor(keysEarned * 75));

        setKeys(k => Number(k) + keysEarned);
        setXp(x => Number(x) + xpEarned);

        setRedeemedTxs(prev => {
          const n = new Set(prev);
          n.add(lower);
          return n;
        });

        const rarityId = rarityFromTxHash(hash);

        setRedeemResult({
          ok: true,
          kind: "SWEEP",
          proofTxHash: hash,
          rarityId,
          rarity: RELIC[rarityId],
          msg: `Redeemed: +${keysEarned} Keys, +${xpEarned} XP`,
          details: {
            user: res.user,
            proofTxHash: hash,
            blockNumber: res.blockNumber,
            ethOut: ethOutEth,
            rarityId,
            rarity: RELIC[rarityId]
          }
        });

        setToast(`Redeem success: +${keysEarned} Keys added. Mint now (mint consumes 1 Key).`);
      }
    } catch (e) {
      setRedeemResult({ ok: false, reason: e?.message || "Redeem failed." });
    } finally {
      setRedeemBusy(false);
    }
  }

  async function mintRelicFromProof() {
    try {
      setMintMsg("");
      setMintResult(null);

      if (!redeemResult?.ok || !redeemResult?.proofTxHash) {
        setMintMsg("Redeem a txHash first.");
        return;
      }
      if (Number(keys) < 1) {
        setMintMsg("No Keys available. Redeem txHash to receive Keys.");
        return;
      }
      if (!effectiveAddress || !ethers.isAddress(effectiveAddress)) {
        setMintMsg("Connect wallet first.");
        return;
      }
      if (!RELICS_CONTRACT || !ethers.isAddress(RELICS_CONTRACT)) {
        setMintMsg("Missing/invalid relic contract address. Set VITE_DUSTRELICS1155_ADDRESS.");
        return;
      }

      const proofKey = makeProofKey(redeemResult.proofTxHash, redeemResult.kind);
      if (mintedProofs.has(proofKey)) {
        setMintMsg("This proof already minted on this device.");
        return;
      }

      setMintBusy(true);

      const rarityId = rarityFromTxHash(redeemResult.proofTxHash);
      const amount = 1;
      const rarityName = RELIC[rarityId] || `Relic #${rarityId}`;

      // get server signature
      const resp = await fetch("/.netlify/functions/mintAuth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: redeemResult.proofTxHash,
          expectedUser: effectiveAddress,
          nftContract: RELICS_CONTRACT,
          rarityId,
          amount
        })
      });

      let data = null;
      try {
        data = await resp.json();
      } catch {
        const reason = "Mint auth failed: invalid server JSON response.";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }

      if (!resp.ok || !data?.ok) {
        const reason = data?.reason || `Mint auth failed (HTTP ${resp.status}).`;
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }

      // strict alignment checks
      if (Number(data.rarityId) !== Number(rarityId)) {
        const reason = "Server rarity mismatch (mintAuth must derive/accept the same rarityId).";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }
      if (Number(data.amount) !== Number(amount)) {
        const reason = "Server amount mismatch.";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(String(data.txHash32 || ""))) {
        const reason = "Bad txHash32 from server.";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }
      if (data.nonce === undefined || data.nonce === null) {
        const reason = "Missing nonce from server (mintAuth must read nonces() and include it in signature).";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }
      if (!data.deadline || Number(data.deadline) <= 0) {
        const reason = "Missing/invalid deadline from server.";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }
      if (!data.signature || typeof data.signature !== "string") {
        const reason = "Missing signature from server.";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }

      // Prefer AppKit provider (WalletConnect, mobile). Fallback to injected.
      const injected = typeof window !== "undefined" ? window.ethereum : null;
      const providerToUse = walletProvider || injected;

      if (!providerToUse) {
        const reason = "No wallet provider available. Press Connect Wallet.";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }

      const bp = new ethers.BrowserProvider(providerToUse);

      // Auto-switch to Linea
      const switched = await ensureLinea(bp);
      if (!switched) {
        const reason = "Please switch to Linea Mainnet in your wallet to mint.";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }

      // Re-check after switch
      const net = await bp.getNetwork();
      if (!likelyLineaNetwork(net.chainId)) {
        const reason = "Still not on Linea. Close wallet, reopen, and try again.";
        setMintMsg(reason);
        setMintResult({ ok: false, reason });
        return;
      }

      const signer = await bp.getSigner();
      const relics = new ethers.Contract(RELICS_CONTRACT, RELICS_ABI, signer);

      setMintMsg(`Minting ${rarityName}… (consumes 1 Key)`);

      const tx = await relics.mintWithSig(
        data.rarityId,
        data.amount,
        data.txHash32,
        data.deadline,
        data.signature
      );

      setMintMsg("Mint submitted…");
      const receipt = await tx.wait();

      // consume 1 key only after success
      setKeys(k => Math.max(0, Number(k) - 1));

      setMintedProofs(prev => {
        const n = new Set(prev);
        n.add(proofKey);
        return n;
      });

      setMintResult({
        ok: true,
        msg: `Minted ${rarityName}`,
        details: {
          rarityId,
          rarity: rarityName,
          mintTxHash: receipt?.hash || tx.hash,
          proofTxHash: redeemResult.proofTxHash,
          contract: RELICS_CONTRACT,
          to: effectiveAddress
        }
      });

      setMintMsg(`Mint success: ${rarityName} (Key consumed).`);
    } catch (e) {
      const reason = e?.shortMessage || e?.message || "Mint failed.";
      setMintResult({ ok: false, reason });
      setMintMsg(reason);
    } finally {
      setMintBusy(false);
    }
  }

  const canMint =
    !!redeemResult?.ok &&
    !!redeemResult?.proofTxHash &&
    !!effectiveAddress &&
    !!RELICS_CONTRACT &&
    ethers.isAddress(RELICS_CONTRACT) &&
    Number(keys) >= 1;

  const mintedThisProof =
    redeemResult?.ok && redeemResult?.proofTxHash
      ? mintedProofs.has(makeProofKey(redeemResult.proofTxHash, redeemResult.kind))
      : false;

  return (
    <div className="vr-wrap">
      <div className="vr-card">
        <div className="vr-top">
          <div className="vr-title">
            <div className="vr-title-main">Vault Run</div>
            <div className="vr-title-sub">
              Raider: <span className="vr-mono">{shortAddr(effectiveAddress)}</span> • Mode{" "}
              <span className="vr-pill">{mode}</span>
            </div>

            <div className="vr-title-sub small">
              DUST: <span className="vr-mono">{DUST_ADDRESS}</span>
            </div>
            <div className="vr-title-sub small">
              DustClaimV3: <span className="vr-mono">{DUSTCLAIMV3_ADDRESS}</span>
            </div>
            <div className="vr-title-sub small">
              Relics (Linea):{" "}
              <span className="vr-mono">
                {RELICS_CONTRACT && ethers.isAddress(RELICS_CONTRACT)
                  ? RELICS_CONTRACT
                  : "Set VITE_DUSTRELICS1155_ADDRESS"}
              </span>
            </div>
          </div>

          <div className="vr-controls">
            {!effectiveAddress ? (
              <button className="vr-primary" onClick={connectWallet} type="button">
                Connect Wallet
              </button>
            ) : (
              <button className="vr-ghost" onClick={connectWallet} type="button">
                Wallet: {shortAddr(effectiveAddress)}
              </button>
            )}

            <button className="vr-ghost" onClick={() => resetRun(true)} disabled={isRunning} type="button">
              Reroll Vaults
            </button>

            {state !== "RUNNING" ? (
              <button className="vr-primary" onClick={startRun} type="button">
                Start Run
              </button>
            ) : (
              <button className="vr-ghost" onClick={endRun} type="button">
                End Run
              </button>
            )}
          </div>
        </div>

        <div className="vr-hud">
          <div className="vr-hud-box">
            <div className="vr-hud-label">Time</div>
            <div className="vr-hud-value vr-mono">{secondsLeft}s</div>
          </div>

          <div className="vr-hud-box">
            <div className="vr-hud-label">Score</div>
            <div className="vr-hud-value vr-mono">{score}</div>
          </div>

          <div className="vr-hud-box">
            <div className="vr-hud-label">Energy</div>
            <div className="vr-hearts">
              {Array.from({ length: START_ENERGY }).map((_, i) => (
                <span key={i} className={"vr-heart " + (i < energy ? "on" : "off")} />
              ))}
            </div>
          </div>

          <div className="vr-hud-box">
            <div className="vr-hud-label">Combo</div>
            <div className="vr-hud-value vr-mono">
              {comboCount > 0 ? `x${comboMultiplier(comboCount).toFixed(2)}` : "—"}
            </div>
          </div>

          <div className="vr-hud-box">
            <div className="vr-hud-label">Progress</div>
            <div className="vr-hud-value vr-mono">{clearedCount}/{vaults.length}</div>
          </div>

          <div className="vr-hud-box">
            <div className="vr-hud-label">Grade</div>
            <div className="vr-hud-value vr-mono">{grade}</div>
          </div>
        </div>

        <div className="vr-toast" role="status">{toast}</div>

        <div className="vr-panels">
          {/* Panel A: Game */}
          <div className="vr-panel">
            <div className="vr-panel-title">Play</div>

            {state === "IDLE" ? (
              <div className="vr-idle">
                <div className="vr-big">Fast run</div>
                <ul className="vr-list">
                  <li>Clear vaults quickly to build combo.</li>
                  <li>Failures cost score and energy.</li>
                  <li>Then redeem a proof txHash to receive Keys.</li>
                  <li>Mint your Relic on Linea using the Key.</li>
                </ul>
              </div>
            ) : null}

            {state === "RUNNING" ? (
              <div className="vr-grid">
                {vaults.map((v) => (
                  <div
                    key={v.id}
                    className={
                      "vr-vault " +
                      (v.status === "CLEARED" ? "cleared" : "") +
                      (v.status === "FAILED" ? "failed" : "") +
                      (v.status === "CLEARING" ? "clearing" : "")
                    }
                  >
                    <div className="vr-vault-top">
                      <div className="vr-vault-symbol">{v.symbol}</div>
                      <div className={"vr-tag tier " + v.tierKey.toLowerCase()}>{v.tierLabel}</div>
                    </div>

                    <div className="vr-vault-mid">
                      <div className="vr-kv">
                        <div className="vr-k">Est. Value</div>
                        <div className="vr-v vr-mono">${v.estUsd.toFixed(2)}</div>
                      </div>
                      <div className="vr-kv">
                        <div className="vr-k">Risk</div>
                        <div className={"vr-v vr-pill risk-" + v.riskKey.toLowerCase()}>{v.riskLabel}</div>
                      </div>
                    </div>

                    <div className="vr-vault-actions">
                      {v.status === "READY" ? (
                        <button className="vr-primary" onClick={() => clearVaultPractice(v.id)} type="button">
                          Clear Vault
                        </button>
                      ) : null}
                      {v.status === "CLEARING" ? (
                        <button className="vr-disabled" disabled type="button">Clearing…</button>
                      ) : null}
                      {v.status === "CLEARED" ? <div className="vr-result ok">Cleared</div> : null}
                      {v.status === "FAILED" ? <div className="vr-result bad">Resisted</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {state === "FINISHED" ? (
              <div className="vr-finish-card">
                <div className="vr-finish-grade">
                  <div className="vr-grade">{grade}</div>
                  <div className="vr-grade-sub">Run complete</div>
                </div>

                <div className="vr-finish-stats">
                  <div className="vr-stat">
                    <div className="vr-stat-k">Score</div>
                    <div className="vr-stat-v vr-mono">{score}</div>
                  </div>
                  <div className="vr-stat">
                    <div className="vr-stat-k">Vaults</div>
                    <div className="vr-stat-v vr-mono">{clearedCount}</div>
                  </div>
                  <div className="vr-stat">
                    <div className="vr-stat-k">Unique</div>
                    <div className="vr-stat-v vr-mono">{uniqueCleared.size}</div>
                  </div>
                  <div className="vr-stat">
                    <div className="vr-stat-k">Next</div>
                    <div className="vr-stat-v vr-mono">Redeem</div>
                  </div>
                </div>

                <div className="vr-finish-actions">
                  <button className="vr-primary" onClick={startRun} type="button">Run Again</button>
                  <button className="vr-ghost" onClick={() => resetRun(true)} type="button">New Vault Set</button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Panel B: Redeem + Mint */}
          <div className="vr-panel">
            <div className="vr-panel-title">Redeem txHash</div>

            <div className="vr-form">
              <label className="vr-label">Proof type</label>
              <div className="vr-row">
                <button
                  className={"vr-toggle-btn2 " + (redeemType === "DAILY" ? "active" : "")}
                  onClick={() => setRedeemType("DAILY")}
                  type="button"
                >
                  Daily DUST Claim
                </button>
                <button
                  className={"vr-toggle-btn2 " + (redeemType === "SWEEP" ? "active" : "")}
                  onClick={() => setRedeemType("SWEEP")}
                  type="button"
                >
                  DustClaimV3 Sweep
                </button>
              </div>

              <label className="vr-label">Transaction hash</label>
              <input
                className="vr-input"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
              />

              <div className="vr-hint">
                Verification requires the tx event’s <span className="vr-mono">user</span> to match{" "}
                <span className="vr-mono">{shortAddr(effectiveAddress)}</span>.
              </div>

              <button className="vr-primary" onClick={redeem} disabled={redeemBusy} type="button">
                {redeemBusy ? "Verifying…" : "Verify & Redeem"}
              </button>

              {redeemResult ? (
                <div className={"vr-resultbox " + (redeemResult.ok ? "ok" : "bad")}>
                  <div className="vr-resultbox-top">{redeemResult.ok ? "Success" : "Failed"}</div>
                  <div className="vr-resultbox-body">
                    {redeemResult.ok ? redeemResult.msg : redeemResult.reason}
                  </div>
                  {redeemResult.ok ? (
                    <div className="vr-hint" style={{ marginTop: 8 }}>
                      Eligible Relic (deterministic):{" "}
                      <span className="vr-mono">{RELIC[redeemResult.rarityId] || "—"}</span>
                    </div>
                  ) : null}
                  {redeemResult.ok && redeemResult.details ? (
                    <pre className="vr-pre">{JSON.stringify(redeemResult.details, null, 2)}</pre>
                  ) : null}
                </div>
              ) : null}

              {canMint ? (
                <div className="vr-form" style={{ marginTop: 10 }}>
                  <label className="vr-label">Mint NFT (Linea)</label>

                  <button
                    className={"vr-primary " + (mintedThisProof ? "vr-disabled" : "")}
                    onClick={mintRelicFromProof}
                    disabled={mintBusy || mintedThisProof}
                    type="button"
                  >
                    {mintedThisProof ? "Already Minted" : (mintBusy ? "Minting…" : "Mint Relic NFT")}
                  </button>

                  {mintMsg ? <div className="vr-chest">{mintMsg}</div> : null}

                  {mintResult ? (
                    <div className={"vr-resultbox " + (mintResult.ok ? "ok" : "bad")}>
                      <div className="vr-resultbox-top">{mintResult.ok ? "Mint Success" : "Mint Failed"}</div>
                      <div className="vr-resultbox-body">{mintResult.ok ? mintResult.msg : mintResult.reason}</div>
                      {mintResult.ok && mintResult.details ? (
                        <pre className="vr-pre">{JSON.stringify(mintResult.details, null, 2)}</pre>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="vr-hint">
                    Mint requires Linea Mainnet and a valid server signature bound to your txHash + wallet + nonce + rarityId.
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Panel C: Inventory */}
          <div className="vr-panel">
            <div className="vr-panel-title">Inventory</div>

            <div className="vr-inv">
              <div className="vr-inv-row">
                <div className="vr-inv-k">XP</div>
                <div className="vr-inv-v vr-mono">{xp}</div>
              </div>
              <div className="vr-inv-row">
                <div className="vr-inv-k">Keys</div>
                <div className="vr-inv-v vr-mono">{keys}</div>
              </div>
              <div className="vr-inv-row">
                <div className="vr-inv-k">Redeemed tx (device)</div>
                <div className="vr-inv-v vr-mono">{redeemedTxs.size}</div>
              </div>
              <div className="vr-inv-row">
                <div className="vr-inv-k">Minted proofs (device)</div>
                <div className="vr-inv-v vr-mono">{mintedProofs.size}</div>
              </div>

              <button className="vr-primary" onClick={openChest} type="button">
                Open Chest (1 Key) — cosmetic
              </button>

              <button className="vr-ghost" onClick={resetInventory} type="button">
                Reset Inventory (this device)
              </button>

              {chestMsg ? <div className="vr-chest">{chestMsg}</div> : null}

              <div className="vr-hint">
                Keys are granted by redeeming proof txHash. Mint consumes 1 Key only after on-chain success.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
