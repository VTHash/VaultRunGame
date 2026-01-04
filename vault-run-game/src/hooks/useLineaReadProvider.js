import { useMemo } from "react";
import { ethers } from "ethers";
import { SUPPORTED_CHAINS } from "../config/walletConnectConfig.js"; // adjust path if needed

export function useLineaReadProvider() {
  const rpcUrl = SUPPORTED_CHAINS?.[59144]?.rpcUrl;

  return useMemo(() => {
    if (!rpcUrl) return null;
    return new ethers.JsonRpcProvider(rpcUrl);
  }, [rpcUrl]);
}