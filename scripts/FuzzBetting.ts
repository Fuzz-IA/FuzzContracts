import hre from "hardhat";
import { parseAbi } from "viem";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const token = process.env.TOKEN_CONTRACT
  const agentA = process.env.AGENT_A
  const agentB = process.env.AGENT_B
  const contract = await hre.viem.deployContract("FuzzBetting", [token, agentA, agentB]);

  console.log("contract deployed to:", contract.address);

  console.log("Waiting 10 seconds before verification...");
  await new Promise(resolve => setTimeout(resolve, 10000));

  try {
    await hre.run("verify:verify", {
      address: contract.address,
      constructorArguments: [token,agentA,agentB],
    });
    console.log("Contract Verified");
  } catch (error) {
    console.log("Error verifying Contract", error);
  }
}


main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });