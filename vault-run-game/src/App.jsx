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
      address={isConnected ? address : undefined}
      provider={lineaProvider}
      // NEW: used by the game "Connect Wallet" button
      onConnectWallet={() => open()}
      walletProvider={walletProvider}
    />
  );
}