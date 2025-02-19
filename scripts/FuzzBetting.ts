import hre from "hardhat";
import { parseAbi } from "viem";

async function main() {
  const token = "0x5dd6c0ef4dcb4454e0deea4d024669702e949f1b"
  const agentA = "0x1290906984327ad1c576050C31FE5AA21D1AaA15"
  const agentB = "0x75E3C8bcBD11a05978a60BC19C8CAA77faBF92b8"
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