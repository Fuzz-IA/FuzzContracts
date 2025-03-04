import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-viem";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      outputSelection: {
        "*": {
          "*": ["storageLayout"],
        },
      },
    },
  },
  networks: {
    "base-sepolia": {
      url: process.env.RPC_API_KEY_BASE_SEPOLIA,
      accounts: [process.env.PRIVATE_KEY as string],
      gasPrice: 1000000000,
    },
    "base": {
      url: process.env.RPC_API_KEY_BASE_MAINNET,
      accounts: [process.env.PRIVATE_KEY_MAINNET as string],
      gasPrice: 1000000000,
    },
  },
  etherscan: {
    apiKey: {
      "base-sepolia": "any_string_works",
      "base": process.env.ETHERSCAN_API_KEY_BASE
    },
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://base-sepolia.blockscout.com/api",
          browserURL: "https://base-sepolia.blockscout.com"
        }
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      }
    ]
  },
  sourcify: {
    enabled: false  
  },
};

export default config;