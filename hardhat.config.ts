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
  },
  etherscan: {
    apiKey: {
      // Para Blockscout, puede ser cualquier string no vacío
      "base-sepolia": "any_string_works"
    },
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          // URLs de Blockscout para Base Sepolia
          apiURL: "https://base-sepolia.blockscout.com/api",
          browserURL: "https://base-sepolia.blockscout.com"
        }
      }
    ]
  },
  sourcify: {
    enabled: false  // Deshabilitamos sourcify ya que usaremos Blockscout
  },
};

export default config;