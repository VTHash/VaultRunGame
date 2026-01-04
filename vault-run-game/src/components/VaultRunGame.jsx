import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import "./VaultRunGame.css";
import {
  DUST_ADDRESS,
  DUSTCLAIMV3_ADDRESS,
  verifyDustClaimTx,
  verifySweepTx
} from "../utils/txRedeem";

/**
 * VaultRunGame.jsx (TxHash Redeem edition)
 *
 * Game runs instantly (Practice). On-chain actions happen outside the loop.
 * User pastes txHash to redeem Keys + XP.
 *
 * Props (optional):
 * - provider: ethers v6 Provider (BrowserProvider or JsonRpcProvider)
 * - address: connected wallet address (recommended for anti-abuse)
 */

const RUN_SECONDS = 90;
const START_ENERGY = 5;
const VAULT_COUNT = 12;
const COMBO_WINDOW_MS = 8000;

// Storage keys
const LS_KEY = "dustclaim_vault_run_state_v1";

// Game tuning
const REWARD = {
  daily: { keys: 1, xp: 250 },
  sweep: {
    // keys = clamp(floor(ethOutETH * 100), 1, 10)
    maxKeys: 10,
    minKeys: 1,
    xpBase: 250
  }
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
      status: "READY", // READY | CLEARING | CLEARED | FAILED
      ethOutSim: 0
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
    // Normalize Sets
    return {
      ...parsed,
      redeemedTxs: new Set(parsed.redeemedTxs || []),
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
    };
    localStorage.setItem(LS_KEY, JSON.stringify(out));
  } catch {
    // ignore
  }
}

function pickProvider(passedProvider) {
  if (passedProvider) return passedProvider;

  // Optional fallback RPC, set in .env:
  // VITE_RPC_URL="https://..."
  const rpc = import.meta.env.VITE_RPC_URL;
  if (!rpc) return null;

  return new ethers.JsonRpcProvider(rpc);
}

export default function VaultRunGame({ address, provider }) {
  const [mode] = useState("PRACTICE"); // practice only; on-chain is via redeem
  const [state, setState] = useState("IDLE"); // IDLE | RUNNING | FINISHED
  const [secondsLeft, setSecondsLeft] = useState(RUN_SECONDS);
  const [energy, setEnergy] = useState(START_ENERGY);
  const [vaults, setVaults] = useState(() => generateVaults());
  const [score, setScore] = useState(0);

  const [comboCount, setComboCount] = useState(0);
  const [comboEndsAt, setComboEndsAt] = useState(0);

  const [uniqueCleared, setUniqueCleared] = useState(() => new Set());
  const [toast, setToast] = useState("Play a fast run, then redeem a txHash for Keys.");

  // Rewards / progression (persisted)
  const [xp, setXp] = useState(0);
  const [keys, setKeys] = useState(0);
  const [redeemedTxs, setRedeemedTxs] = useState(() => new Set());
  const [chestMsg, setChestMsg] = useState("");

  // Redeem UI state
  const [redeemType, setRedeemType] = useState("DAILY"); // DAILY | SWEEP
  const [txHash, setTxHash] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemResult, setRedeemResult] = useState(null);

  const timerRef = useRef(null);

  const isRunning = state === "RUNNING";
  const isFinished = state === "FINISHED";

  const grade = useMemo(() => gradeFromScore(score), [score]);
  const clearedCount = useMemo(() => vaults.filter(v => v.status === "CLEARED").length, [vaults]);

  const activeProvider = useMemo(() => pickProvider(provider), [provider]);

  // Load persisted progression on mount
  useEffect(() => {
    const st = loadState();
    if (!st) return;

    setXp(Number(st.xp || 0));
    setKeys(Number(st.keys || 0));
    setRedeemedTxs(st.redeemedTxs || new Set());
  }, []);

  // Persist progression
  useEffect(() => {
    saveState({ xp, keys, redeemedTxs });
  }, [xp, keys, redeemedTxs]);

  // combo expiry
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

  // main timer
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

    if (newSeed) setVaults(generateVaults());
    else setVaults(vaults.map(v => ({ ...v, status: "READY", ethOutSim: 0 })));
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

    // Cosmetic rarity roll (frontend-only)
    const r = Math.random();
    let drop = "Common Relic";
    if (r > 0.92) drop = "Legendary Relic";
    else if (r > 0.75) drop = "Epic Relic";
    else if (r > 0.45) drop = "Rare Relic";

    setChestMsg(`Chest opened: ${drop}`);
  }

  function isLikelyTxHash(s) {
    return /^0x([A-Fa-f0-9]{64})$/.test((s || "").trim());
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

        // Rewards
        setKeys(k => k + REWARD.daily.keys);
        setXp(x => x + REWARD.daily.xp);

        setRedeemedTxs(prev => {
          const n = new Set(prev);
          n.add(lower);
          return n;
        });

        setRedeemResult({
          ok: true,
          kind: "DUST_DAILY",
          msg: `Redeemed Daily Claim: +${REWARD.daily.keys} Key, +${REWARD.daily.xp} XP`,
          details: {
            user: res.user,
            amount: res.amount.toString(),
            timestamp: res.timestamp,
            dust: DUST_ADDRESS
          }
        });

        setToast("Daily claim redeemed. Open a chest.");

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

        setRedeemResult({
          ok: true,
          kind: "SWEEP",
          msg: `Redeemed Sweep: +${keysEarned} Keys, +${xpEarned} XP`,
          details: {
            user: res.user,
            token: res.token,
            amountIn: res.amountIn.toString(),
            ethOut: ethOutEth,
            dustClaimV3: DUSTCLAIMV3_ADDRESS
          }
        });

        setToast("Sweep redeemed. Open chests for relic drops.");
      }
    } catch (e) {
      setRedeemResult({ ok: false, reason: e?.message || "Redeem failed." });
    } finally {
      setRedeemBusy(false);
    }
  }

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

          {/* Panel B: Redeem */}
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
                  ? <>Verification will require the tx event’s <span className="vr-mono">user</span> to match <span className="vr-mono">{shortAddr(address)}</span>.</>
                  : <>Tip: pass the connected wallet <span className="vr-mono">address</span> prop to enforce user-matching.</>
                }
              </div>

              <button className="vr-primary" onClick={redeem} disabled={redeemBusy}>
                {redeemBusy ? "Verifying…" : "Verify & Redeem"}
              </button>

              {redeemResult ? (
                <div className={"vr-resultbox " + (redeemResult.ok ? "ok" : "bad")}>
                  <div className="vr-resultbox-top">
                    {redeemResult.ok ? "Success" : "Failed"}
                  </div>
                  <div className="vr-resultbox-body">
                    {redeemResult.ok ? redeemResult.msg : redeemResult.reason}
                  </div>

                  {redeemResult.ok && redeemResult.details ? (
                    <pre className="vr-pre">
{JSON.stringify(redeemResult.details, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ) : null}

              <div className="vr-hint">
                Provider note: if you do not pass a provider prop, set <span className="vr-mono">VITE_RPC_URL</span> for the chain where those contracts are deployed.
              </div>
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
                This is the “game loop”: play instantly, then redeem real tx proofs for Keys and loot.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}