import { createAppKit } from "@reown/appkit/react";
import { linea } from "@reown/appkit/networks";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";

const projectId = import.meta.env.VITE_PROJECT_ID;

if (!projectId) {
  throw new Error("Missing VITE_PROJECT_ID in .env");
}

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

  // Hide auth UI (email/social) so AppKit stops warning about missing auth config
  features: {
    email: false,
    socials: false,
  },
});
