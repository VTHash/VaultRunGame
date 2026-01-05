import { createAppKit } from "@reown/appkit/react";
import { linea } from "@reown/appkit/networks";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";

// 1) Set this in Vite env (.env):
// VITE_PROJECT_ID=xxxxx
const projectId = import.meta.env.VITE_PROJECT_ID;

if (!projectId) {
  // Fail loudly so you know immediately
  throw new Error("Missing VITE_PROJECT_ID in .env");
}

// 2) Create AppKit ONCE (this must run before any useAppKit hooks)
createAppKit({
  adapters: [new EthersAdapter()],
  networks: [linea],
  projectId,
  metadata: {
    name: "Vault Run",
    description: "Redeem txHash, earn keys, mint relics on Linea",
    url: window.location.origin,
    icons: [`${window.location.origin}/favicon.ico`],
  },
});