// VaultRunGame.jsx
// TxHash Redeem + deterministic rarity + Linea ERC1155 mintWithSig
//
// Key points:
// - Rarity is derived deterministically from the proof txHash (prevents reroll abuse).
// - That rarityId is sent to your backend mintAuth so the signature matches the contract call.
// - Uses env var VITE_DUST_RELICS_ADDRESS (and fallback VITE_DUSTRELICS1155_ADDRESS).

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

// Storage
const LS_KEY = "dustclaim_vault_run_state_v1";

// Rewards
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

// Solidity IDs (DustRelics1155)
const RELIC = {
  1: "SilverDust", // Common
  2: "GoldenDust", // Rare
  3: "DiamondDust", // Epic
  4: "EmeraldDust" // Legendary
};

// Contract ABI
const RELICS_ABI = [
  "function mintWithSig(uint256 id,uint256 amount,bytes32 txHash,uint256 deadline,bytes sig) external",
  "function usedTxHash(bytes32) view returns (bool)",
  "function minted(uint256) view returns (uint256)"
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
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      redeemedTxs: new Set(parsed.redeemedTxs || []),
      mintedProofs: new Set(parsed.mintedProofs || [])
    };
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    const out = {
      ...state,
      redeemedTxs: Array.from(state.redeemedTxs || []),
      mintedProofs: Array.from(state.mintedProofs || [])
    };
    localStorage.setItem(LS_KEY, JSON.stringify(out));
  } catch {
    // ignore
  }
}

function pickProvider(passedProvider) {
  if (passedProvider) return passedProvider;
  const rpc = import.meta.env.VITE_LINEA_RPC;
  if (!rpc) return null;
  return new ethers.JsonRpcProvider(rpc);
}

function hasInjectedWallet() {
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
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

// Deterministic rarity from txHash (prevents reroll abuse)
// Matches your chest thresholds:
// - Legendary > 0.92 (8%)
// - Epic > 0.75 (17%)
// - Rare > 0.45 (30%)
// - Common otherwise (45%)
function rarityFromTxHash(txHash) {
  // Convert to bytes and hash again for uniformity
  const h = ethers.keccak256(ethers.getBytes(txHash));
  // Take first 4 bytes => 0..2^32-1
  const n = Number(BigInt(h.slice(0, 10)));
  const pct = n / 0xffffffff; // 0..1

  if (pct > 0.92) return 4; // EmeraldDust
  if (pct > 0.75) return 3; // DiamondDust
  if (pct > 0.45) return 2; // GoldenDust
  return 1; // SilverDust
}

export default function VaultRunGame({ address, provider }) {
  const [mode] = useState("PRACTICE");
  const [state, setState] = useState("IDLE"); // IDLE | RUNNING | FINISHED
  const [secondsLeft, setSecondsLeft] = useState(RUN_SECONDS);
  const [energy, setEnergy] = useState(START_ENERGY);
  const [vaults, setVaults] = useState(() => generateVaults());
  const [score, setScore] = useState(0);

  const [comboCount, setComboCount] = useState(0);
  const [comboEndsAt, setComboEndsAt] = useState(0);

  const [uniqueCleared, setUniqueCleared] = useState(() => new Set());
  const [toast, setToast] = useState("Play a fast run, then redeem a txHash for Keys.");

  // Progression (persisted)
  const [xp, setXp] = useState(0);
  const [keys, setKeys] = useState(0);
  const [redeemedTxs, setRedeemedTxs] = useState(() => new Set());
  const [mintedProofs, setMintedProofs] = useState(() => new Set());
  const [chestMsg, setChestMsg] = useState("");

  // Redeem
  const [redeemType, setRedeemType] = useState("DAILY"); // DAILY | SWEEP
  const [txHash, setTxHash] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemResult, setRedeemResult] = useState(null);

  // Mint
  const [mintBusy, setMintBusy] = useState(false);
  const [mintMsg, setMintMsg] = useState("");
  const [mintResult, setMintResult] = useState(null);

  const timerRef = useRef(null);
  const isRunning = state === "RUNNING";

  const grade = useMemo(() => gradeFromScore(score), [score]);
  const clearedCount = useMemo(
    () => vaults.filter(v => v.status === "CLEARED").length,
    [vaults]
  );

  const activeProvider = useMemo(() => pickProvider(provider), [provider]);

  // ENV: keep your existing name, add a fallback
  const RELICS_CONTRACT =
    import.meta.env.VITE_DUSTRELICS1155_ADDRESS ||
    "";

  // Load persisted
  useEffect(() => {
    const st = loadState();
    if (!st) return;
    setXp(Number(st.xp || 0));
    setKeys(Number(st.keys || 0));
    setRedeemedTxs(st.redeemedTxs || new Set());
    setMintedProofs(st.mintedProofs || new Set());
  }, []);

  // Persist
  useEffect(() => {
    saveState({ xp, keys, redeemedTxs, mintedProofs });
  }, [xp, keys, redeemedTxs, mintedProofs]);

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
    setToast("Play a fast run, then redeem a txHash for Keys.");
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

  function addScoreForClear(vault) {
    const base = 100;
    const vBonus = valueBonus(vault.estUsd);
    const isNewToken = !uniqueCleared.has(vault.symbol);
    const diversity = isNewToken ? 40 : 0;

    const now = Date.now();
    let nextCombo = comboCount;

    if (comboCount > 0 && comboEndsAt && now <= comboEndsAt) nextCombo = comboCount + 1;
    else nextCombo = 1;

    const mult = comboMultiplier(nextCombo);
    const speed = Math.floor(mult * 25);

    const add = Math.floor((base + vBonus + diversity + speed) * mult);

    setScore(s => s + add);
    setComboCount(nextCombo);
    setComboEndsAt(now + COMBO_WINDOW_MS);

    if (isNewToken) {
      setUniqueCleared(prev => {
        const n = new Set(prev);
        n.add(vault.symbol);
        return n;
      });
    }

    setToast(`${vault.symbol} cleared: +${add} (combo x${mult.toFixed(2)})`);
  }

  function addPenalty(reason) {
    setScore(s => Math.max(0, s - 75));
    setComboCount(0);
    setComboEndsAt(0);
    setEnergy(e => Math.max(0, e - 1));
    setToast(`${reason}: -75, -1 energy (combo reset)`);
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
      addPenalty(`${v.symbol} vault resisted`);
      return;
    }

    setVaults(prev => prev.map(x => x.id === vaultId ? { ...x, status: "CLEARED" } : x));
    addScoreForClear(v);
  }

  function openChest() {
    if (keys <= 0) {
      setChestMsg("You need a Key. Redeem a txHash to get Keys.");
      return;
    }
    setKeys(k => k - 1);

    // Cosmetic only (keep as you had)
    const r = Math.random();
    let drop = "Common Relic";
    if (r > 0.92) drop = "Legendary Relic";
    else if (r > 0.75) drop = "Epic Relic";
    else if (r > 0.45) drop = "Rare Relic";
    setChestMsg(`Chest opened: ${drop}`);
  }

  async function mintRelicFromProof() {
    try {
      setMintMsg("");
      setMintResult(null);

      if (!redeemResult?.ok || !redeemResult?.proofTxHash) {
        setMintMsg("Redeem a txHash first.");
        return;
      }
      if (!address) {
        setMintMsg("Connect wallet first.");
        return;
      }
      if (!hasInjectedWallet()) {
        setMintMsg("No wallet detected (MetaMask / injected).");
        return;
      }
      if (!RELICS_CONTRACT || !ethers.isAddress(RELICS_CONTRACT)) {
        setMintMsg("Missing or invalid VITE_DUST_RELICS_ADDRESS.");
        return;
      }

      const proofKey = makeProofKey(redeemResult.proofTxHash, redeemResult.kind);
      if (mintedProofs.has(proofKey)) {
        setMintMsg("This proof has already been minted in this browser.");
        return;
      }

      // Deterministic rarity based on proofTxHash
      const rarityId = rarityFromTxHash(redeemResult.proofTxHash);
      const rarityName = RELIC[rarityId] || `Relic #${rarityId}`;

      setMintBusy(true);

      // Ask backend for signature (must sign the SAME rarityId)
      // Expected backend response: { ok, rarityId, amount, txHash32, deadline, signature }
      const res = await fetch("/.netlify/functions/mintAuth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: redeemResult.proofTxHash,
          expectedUser: address,
          rarityId,
          amount: 1,
          nftContract: RELICS_CONTRACT
        })
      });

      const data = await res.json();
      if (!data?.ok) {
        setMintResult({ ok: false, reason: data?.reason || "Mint auth failed." });
        setMintMsg(data?.reason || "Mint auth failed.");
        return;
      }

      // Enforce signature uses the same rarityId we derived
      if (Number(data.rarityId) !== Number(rarityId)) {
        setMintResult({ ok: false, reason: "Server returned mismatched rarityId." });
        setMintMsg("Server returned mismatched rarityId.");
        return;
      }

      // Switch/check Linea
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const net = await browserProvider.getNetwork();
      if (!likelyLineaNetwork(net.chainId)) {
        setMintResult({ ok: false, reason: "Wrong network. Switch to Linea Mainnet." });
        setMintMsg("Wrong network. Switch to Linea Mainnet.");
        return;
      }

      const signer = await browserProvider.getSigner();
      const relics = new ethers.Contract(RELICS_CONTRACT, RELICS_ABI, signer);

      setMintMsg(`Minting ${rarityName}…`);

      // data.txHash32 must be bytes32 (0x + 64 hex chars)
      const tx = await relics.mintWithSig(
        data.rarityId,
        data.amount,
        data.txHash32,
        data.deadline,
        data.signature
      );

      setMintMsg("Mint submitted…");
      const receipt = await tx.wait();

      setMintedProofs(prev => {
        const n = new Set(prev);
        n.add(proofKey);
        return n;
      });

      setMintResult({
        ok: true,
        msg: `Minted ${rarityName}`,
        details: {
          rarityId: Number(data.rarityId),
          rarity: rarityName,
          mintTxHash: receipt?.hash || tx.hash,
          proofTxHash: redeemResult.proofTxHash,
          contract: RELICS_CONTRACT
        }
      });

      setMintMsg(`Relic minted: ${rarityName}`);
    } catch (e) {
      const reason = e?.shortMessage || e?.message || "Mint failed.";
      setMintResult({ ok: false, reason });
      setMintMsg(reason);
    } finally {
      setMintBusy(false);
    }
  }

  async function redeem() {
    const hash = (txHash || "").trim();
    if (!isLikelyTxHash(hash)) {
      setRedeemResult({ ok: false, reason: "Invalid tx hash format." });
      return;
    }

    const lower = hash.toLowerCase();
    if (redeemedTxs.has(lower)) {
      setRedeemResult({ ok: false, reason: "This txHash has already been redeemed in this browser." });
      return;
    }

    if (!activeProvider) {
      setRedeemResult({
        ok: false,
        reason: "No provider available. Pass a provider prop or set VITE_RPC_URL."
      });
      return;
    }

    setRedeemBusy(true);
    setRedeemResult(null);
    setChestMsg("");
    setMintMsg("");
    setMintResult(null);

    try {
      let res;

      if (redeemType === "DAILY") {
        res = await verifyDustClaimTx({
          provider: activeProvider,
          txHash: hash,
          expectedUser: address
        });

        if (!res.ok) {
          setRedeemResult(res);
          return;
        }

        setKeys(k => k + REWARD.daily.keys);
        setXp(x => x + REWARD.daily.xp);

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
          msg: `Redeemed Daily Claim: +${REWARD.daily.keys} Key, +${REWARD.daily.xp} XP`,
          details: {
            user: res.user,
            amount: res.amount.toString(),
            timestamp: res.timestamp,
            dust: DUST_ADDRESS,
            proofTxHash: hash,
            rarityId,
            rarity: RELIC[rarityId]
          }
        });

        setToast(`Daily claim redeemed. Eligible Relic: ${RELIC[rarityId]} (Linea).`);
      } else {
        res = await verifySweepTx({
          provider: activeProvider,
          txHash: hash,
          expectedUser: address
        });

        if (!res.ok) {
          setRedeemResult(res);
          return;
        }

        const ethOutEth = Number(ethers.formatEther(res.ethOut));
        const rawKeys = Math.floor(ethOutEth * 100);
        const keysEarned = clamp(rawKeys, REWARD.sweep.minKeys, REWARD.sweep.maxKeys);

        const xpEarned = REWARD.sweep.xpBase + Math.min(750, Math.floor(keysEarned * 75));

        setKeys(k => k + keysEarned);
        setXp(x => x + xpEarned);

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
          msg: `Redeemed Sweep: +${keysEarned} Keys, +${xpEarned} XP`,
          details: {
            user: res.user,
            token: res.token,
            amountIn: res.amountIn.toString(),
            ethOut: ethOutEth,
            dustClaimV3: DUSTCLAIMV3_ADDRESS,
            proofTxHash: hash,
            rarityId,
            rarity: RELIC[rarityId]
          }
        });

        setToast(`Sweep redeemed. Eligible Relic: ${RELIC[rarityId]} (Linea).`);
      }
    } catch (e) {
      setRedeemResult({ ok: false, reason: e?.message || "Redeem failed." });
    } finally {
      setRedeemBusy(false);
    }
  }

  const canMint =
    !!redeemResult?.ok &&
    !!redeemResult?.proofTxHash &&
    !!address &&
    !!RELICS_CONTRACT &&
    ethers.isAddress(RELICS_CONTRACT);

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
              Raider: <span className="vr-mono">{shortAddr(address)}</span> • Mode{" "}
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
                  : "0x41Dc03adb5E1ee0915BA00617c4516D1293deC6c"}
              </span>
            </div>
          </div>

          <div className="vr-controls">
            <button className="vr-ghost" onClick={() => resetRun(true)} disabled={isRunning}>
              Reroll Vaults
            </button>
            {state !== "RUNNING" ? (
              <button className="vr-primary" onClick={startRun}>
                Start Run
              </button>
            ) : (
              <button className="vr-ghost" onClick={endRun}>
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
                  <li>After you claim on-chain, paste the txHash to redeem Keys.</li>
                  <li>After redeem succeeds, mint your Relic NFT on Linea.</li>
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
                        <button className="vr-primary" onClick={() => clearVaultPractice(v.id)}>
                          Clear Vault
                        </button>
                      ) : null}
                      {v.status === "CLEARING" ? <button className="vr-disabled" disabled>Clearing…</button> : null}
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
                  <button className="vr-primary" onClick={startRun}>Run Again</button>
                  <button className="vr-ghost" onClick={() => resetRun(true)}>New Vault Set</button>
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
                {address
                  ? <>Verification requires the tx event’s <span className="vr-mono">user</span> to match <span className="vr-mono">{shortAddr(address)}</span>.</>
                  : <>Tip: pass the connected wallet <span className="vr-mono">address</span> prop to enforce user-matching.</>
                }
              </div>

              <button className="vr-primary" onClick={redeem} disabled={redeemBusy}>
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
                      Eligible Relic:{" "}
                      <span className="vr-mono">{RELIC[redeemResult.rarityId] || "—"}</span>
                    </div>
                  ) : null}
                  {redeemResult.ok && redeemResult.details ? (
                    <pre className="vr-pre">
{JSON.stringify(redeemResult.details, null, 2)}
                    </pre>
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
                        <pre className="vr-pre">
{JSON.stringify(mintResult.details, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="vr-hint">
                    Mint requires Linea Mainnet and a valid server signature bound to your txHash + wallet + rarityId.
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
                <div className="vr-inv-k">Redeemed tx</div>
                <div className="vr-inv-v vr-mono">{redeemedTxs.size}</div>
              </div>

              <button className="vr-primary" onClick={openChest}>
                Open Chest (1 Key)
              </button>

              {chestMsg ? <div className="vr-chest">{chestMsg}</div> : null}

              <div className="vr-hint">
                Game loop: play instantly, redeem tx proofs for Keys/XP, mint the Relic NFT on Linea.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}