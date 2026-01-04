const KEY = "dustclaim_vault_state_v1";

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const st = JSON.parse(raw);
    return { ...defaultState(), ...st };
  } catch {
    return defaultState();
  }
}

export function saveState(st) {
  localStorage.setItem(KEY, JSON.stringify(st));
}

export function defaultState() {
  return {
    xp: 0,
    keys: 0,
    redeemed: 0,
    loot: [], // { id, name, rarity, ts }
    usedTx: {}, // txHash: true
    bestScore: 0,
    lastRun: null, // { score, grade, vaults, ts }
  };
}

export function addRedeemReward(st, { xp = 250, keys = 1 }) {
  const next = { ...st };
  next.xp += xp;
  next.keys += keys;
  next.redeemed += 1;
  return next;
}

export function canOpenChest(st) {
  return (st.keys || 0) >= 1;
}

function rollRarity() {
  // Adjust as you wish
  // 70% common, 22% uncommon, 7% rare, 1% epic
  const r = Math.random() * 100;
  if (r < 70) return "Common";
  if (r < 92) return "Uncommon";
  if (r < 99) return "Rare";
  return "Epic";
}

function lootFor(rarity) {
  const table = {
    Common: ["Scrap Relic", "Faded Rune", "Rust Coin"],
    Uncommon: ["Charged Relic", "Cipher Shard", "Neon Sigil"],
    Rare: ["Vault Core", "Prismatic Keycap", "Ghost Circuit"],
    Epic: ["Ancient Core", "Void Emblem", "Genesis Relic"],
  };
  const arr = table[rarity] || table.Common;
  const name = arr[Math.floor(Math.random() * arr.length)];
  return { name };
}

export function openChest(st) {
  if (!canOpenChest(st)) return { next: st, opened: null };

  const rarity = rollRarity();
  const item = lootFor(rarity);

  const opened = {
    id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name: item.name,
    rarity,
    ts: Date.now(),
  };

  const next = { ...st };
  next.keys -= 1;
  next.loot = [opened, ...(next.loot || [])].slice(0, 50);
  return { next, opened };
}

// Simple “run” scoring (no chain)
export function finishRun(st, { score, vaults }) {
  const grade =
    score >= 2200 ? "S" :
    score >= 1800 ? "A" :
    score >= 1400 ? "B" :
    score >= 1000 ? "C" : "D";

  const next = { ...st };
  next.bestScore = Math.max(next.bestScore || 0, score);
  next.lastRun = { score, grade, vaults, ts: Date.now() };
  return next;
}