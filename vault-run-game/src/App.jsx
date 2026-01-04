import React from "react";
import VaultRunGame from "./components/VaultRunGame";
import { useLineaReadProvider } from "./hooks/useLineaReadProvider";

// Replace this with however you get address from Reown in your app:
import { useAppKitAccount } from "@reown/appkit/react";

export default function App() {
  const { address, isConnected } = useAppKitAccount();
  const lineaProvider = useLineaReadProvider();

  return (
    <VaultRunGame
      address={isConnected ? address : undefined}
      provider={lineaProvider}
    />
  );
}