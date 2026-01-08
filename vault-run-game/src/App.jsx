// src/App.jsx
import React from "react";
import VaultRunGame from "./components/VaultRunGame";
import { useLineaReadProvider } from "./hooks/useLineaReadProvider";

// Reown
import { useAppKitAccount, useAppKit, useAppKitProvider } from "@reown/appkit/react";

export default function App() {
  const { address, isConnected } = useAppKitAccount();
  const { open } = useAppKit(); // opens Reown modal
  const { walletProvider } = useAppKitProvider("eip155"); // EIP-1193 provider for ethers
  const lineaProvider = useLineaReadProvider(); // RPC read provider for receipts

  return (
    <VaultRunGame
      // wallet identity
      address={isConnected && address ? address : undefined}
      // read-only RPC (Linea) for verifying receipts
      provider={lineaProvider}
      // write provider (walletconnect/metamask via AppKit)
      walletProvider={walletProvider}
      // Connect button handler
      onConnectWallet={() => open()}
    />
  );
}