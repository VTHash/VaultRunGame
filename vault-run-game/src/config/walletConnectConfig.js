import {
  mainnet as rcMainnet,
  polygon as rcPolygon,
  arbitrum as rcArbitrum,
  base as rcBase,
  optimism as rcOptimism,
} from "@reown/appkit/networks";

// -------------------------------
// 1) Environment-based variables
// -------------------------------
export const projectId =
  import.meta.env.VITE_PROJECT_ID || import.meta.env.VITE_REOWN_PROJECT_ID;
const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY;
const INFURA_PROJECT_ID = import.meta.env.VITE_INFURA_PROJECT_ID;

// -------------------------------
// 2) App metadata
// -------------------------------

export function getReownMetadata() {
  const url =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://dustclaim.xyz/"; // fallback for SSR/build
  return {
    name: "DustClaim",
    description: "Claim your crypto dust across multiple blockchains",
    url, 
    icons: ["https://dustclaim.xyz/icon.png"],
  };
}
// -------------------------------
// 3) Supported Chains (UI + RPC)
// -------------------------------

export const SUPPORTED_CHAINS = {
  1: {
    name: 'Ethereum',
    symbol: 'ETH',
    rpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://etherscan.io',
    logo: '/logo/ethereum.png'
  },
  10: {
    name: 'OP Mainnet',
    symbol: 'ETH',
    rpcUrl: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://optimistic.etherscan.io',
    logo: '/logo/optimism.png'
  },
  8453: {
    name: 'Base',
    symbol: 'ETH',
    rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, 
    explorer: 'https://basescan.org',
    logo: '/logo/base.png'
  },
  42161: {
    name: 'Arbitrum One',
    symbol: 'ETH',
    rpcUrl: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://arbiscan.io',
    logo: '/logo/arbitrum.png'
  },
  137: {
    name: 'Polygon PoS',
    symbol: 'MATIC',
    rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://polygonscan.com',
    logo: '/logo/polygon.png'
  },

  // Other EVM Chains
  56: {
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    rpcUrl: `https://bnb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://bscscan.com',
    logo: '/logo/bnb.png'
  },
  43114: {
    name: 'Avalanche C-Chain',
    symbol: 'AVAX',
    rpcUrl: `https://avax-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://snowscan.xyz/',
    logo: '/logo/avalanche.png'
  },
  100: {
    name: 'Gnosis',
    symbol: 'xDAI',
    rpcUrl: `https://gnosis-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://gnosisscan.io',
    logo: '/logo/gnosis.png'
  },
  250: {
    name: 'Fantom',
    symbol: 'FTM',
    rpcUrl: 'https://1rpc.io/ftm',
    explorer: 'https://ftmscan.com',
    logo: '/logo/fantom.png'
  },
  59144: {
  name: 'Linea',
  symbol: 'ETH',
  rpcUrl: ALCHEMY_API_KEY
    ? `https://linea-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : "https://rpc.linea.build",
  explorer: 'https://lineascan.build',
  logo: '/logo/linea.png'
},

  // Emerging and Specialized Chains
  7777777: {
    name: 'Zora',
    symbol: 'ETH',
    rpcUrl: `https://zora-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://explorer.zora.energy',
    logo: '/logo/zora.jpg'
  },
  34443: {
    name: 'Mode',
    symbol: 'ETH',
    rpcUrl: `https://mode-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://modescan.io',
    logo: '/logo/routescan.jpg'
  },
  1329: {
    name: 'Sei Network', 
    symbol: 'SEI',
    rpcUrl: `https://sei-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, 
    explorer: 'https://seitrace.com',
    logo: '/logo/sei.png'
  },
  80094: {
    name: 'Berachain',
    symbol: 'BERA',
    rpcUrl: `https://berachain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: 'https://berascan.com',
    logo: '/logo/bera.png'
  },
  

  42220: {
    name: "Celo Mainnet",
    symbol: "CELO",
    rpcUrl: `https://celo-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: "https://celoscan.io",
    logo: "/logo/celo.png",
  },

  1313161554: {
    name: "Aurora Mainnet",
    symbol: "ETH",
    rpcUrl: "https://mainnet.aurora.dev",
    explorer: "https://aurorascan.dev",
    logo: "/logo/aurora.png",
  },

  1284: {
    name: "Moonbeam",
    symbol: "GLMR",
    rpcUrl: `https://moonbeam-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    explorer: "https://moonscan.io",
    logo: "/logo/moonbeam.png",
  },

  1285: {
    name: "Moonriver",
    symbol: "MOVR",
    rpcUrl: "https://moonriver.drpc.org",
    explorer: "https://moonriver.moonscan.io",
    logo: "/logo/moonriver.png",
  },

  

  324: {
  name: "zkSync Mainnet",
  symbol: "ETH",
  rpcUrl: `https://zksync-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://explorer.zksync.io",
  logo: "/logo/zksync.jpg",
},

9745: {
  name: "Plasma Mainnet",
  symbol: "XPL",
  rpcUrl: `https://plasma-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://plasmascan.to/",
  logo: "/logo/plasma.png",
},

130: {
  name: "Unichain",
  symbol: "ETH",
  rpcUrl: `https://unichain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://uniscan.xyz",
  logo: "/logo/unichain.png",
},

5000: {
  name: "Mantle",
  symbol: "MNT",
  rpcUrl: `https://mantle-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://explorer.mantlenetwork.io",
  logo: "/logo/mantle.png",
},

14: {
    name: "Flare",
    symbol: "FLR",
    rpcUrl: "https://flare-api.flare.network/ext/C/rpc",
    explorer: "https://flare-explorer.flare.network",
    // or: "https://mainnet.flarescan.com"
    logo: "/logo/flare.png"
  },

  

40: {
  name: "Telos",
  symbol: "TLOS",
  rpcUrl: "https://1rpc.io/telos/evm",
  explorer: "https://teloscan.io",
  logo: "/logo/telos.png"
},

57: {
  name: "Syscoin",
  symbol: "SYS",
  rpcUrl: "https://syscoin-evm.publicnode.com",
  explorer: "https://explorer.syscoin.org",
  logo: "/logo/sys.jpg"
},

50: {
  name: "XDC Network",
  symbol: "XDC",
  rpcUrl: "https://rpc.xinfin.network",
  explorer: "https://explorer.xinfin.network",
  logo: "/logo/xdc.png"
},

61: {
  name: "Ethereum Classic",
  symbol: "ETC",
  rpcUrl: "https://etc.rivet.link", // reliable public RPC
  explorer: "https://blockscout.com/etc/mainnet",
  logo: "/logo/ethereum-classic.png"
},

57073: {
  name: "Inkonchain",
  symbol: "ETH",
  rpcUrl: `https://ink-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, // adjust if you use a different RPC endpoint
  explorer: "https://explorer.inkonchain.com", 
  logo: "/logo/ink.png" 
},

122: {
  name: "Fuse Network",
  symbol: "FUSE",
  rpcUrl: "https://rpc.fuse.io",
  explorer: "https://explorer.fuse.io",
  logo: "/logo/fuse.png"
},

81457: {
  name: "Blast Mainnet",
  symbol: "ETH",
  rpcUrl: `https://blast-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://blastscan.io",
  logo: "/logo/blast.jpeg"
},

1868: {
  name: "Soneium",
  symbol: "ETH",
  rpcUrl: `https://soneium-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://mainnet-explorer.soneium.org",
  logo: "/logo/soneium.jpg"
},

480: {
  name: "World Chain",
  symbol: "ETH",
  rpcUrl: `https://worldchain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://worldchain-mainnet.explorer.alchemy.com",
  logo: "/logo/worldcoin.png"
},

1135: {
  name: "Lisk",
  symbol: "ETH",
  rpcUrl: "https://rpc.api.lisk.com",
  explorer: "https://blockscout.lisk.com",
  logo: "/logo/lisk.png"
},

1923: {
  name: "Swellchain",
  symbol: "ETH",
  rpcUrl: "https://swell-mainnet.alt.technology",
  explorer: "https://explorer.swellnetwork.io",
  logo: "/logo/swell.png"
},

2741: {
  name: "Abstract",
  symbol: "ETH",
  rpcUrl: `https://abstract-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://abscan.org/",
  logo: "/logo/abstract.png"
},

747474: {
  name: "Katana",
  symbol: "ETH",
  rpcUrl: "https://rpc.katana.network",
  explorer: "https://explorer.katanarpc.com",
  logo: "/logo/katana.jpg"
},

146: {
  name: "Sonic",
  symbol: "S",
  rpcUrl: `https://sonic-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://sonicscan.org",
  logo: "/logo/sonic.jpg"
},

534352: {
  name: "Scroll",
  symbol: "ETH",
  rpcUrl: `https://scroll-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  explorer: "https://scrollscan.com/",
  logo: "/logo/scroll.png"
},

42170: {
  name: "Arbitrum Nova",
  symbol: "ETH",
  rpcUrl: `https://arbitrum-nova-rpc.publicnode.com`,
  explorer: "https://nova.arbiscan.io",
  logo: "/logo/arbitrum-nova.jpeg"
},

167000: {
  name: "Taiko",
  symbol: "ETH",
  rpcUrl: `https://rpc.ankr.com/taiko`,
  explorer: "https://taikoscan.io",
  logo: "/logo/taiko.png"
},

2818: {
  name: "Morph",
  symbol: "ETH",
  rpcUrl: `https://rpc.morphl2.io`,
  explorer: "https://morphl2.socialscan.io/",
  logo: "/logo/morph.jpg"
},

};

// -------------------------------
// 4) Convert to Reown CAIP networks
// -------------------------------
function toReownNetwork(id, meta) {
  return {
    id: Number(id),
    chainNamespace: "eip155",
    name: meta.name,
    nativeCurrency: {
      name: meta.symbol,
      symbol: meta.symbol,
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [meta.rpcUrl] },
      public: { http: [meta.rpcUrl] },
    },
    blockExplorers: meta.explorer
      ? { default: { name: "explorer", url: meta.explorer } }
      : undefined,
  };
}

// Include Reown built-ins + your expanded list
const builtinIds = new Set([1, 137, 42161, 8453, 10]);

export const reownNetworks = [
  rcMainnet,
  rcPolygon,
  rcArbitrum,
  rcBase,
  rcOptimism,
  ...Object.entries(SUPPORTED_CHAINS)
    .filter(([id]) => !builtinIds.has(Number(id)))
    .map(([id, meta]) => toReownNetwork(id, meta)),
];

// Handy list of numeric chainIds if you need them
export const chainIds = reownNetworks.map((n) => Number(n.id));