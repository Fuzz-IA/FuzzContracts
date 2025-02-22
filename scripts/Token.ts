import hre from "hardhat";


async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying Token with the account:", deployer.address);

  const contract = await hre.viem.deployContract("Token", [
    deployer.address
  ]);

  console.log("Token deployed to:", contract.address);
  await new Promise(resolve => setTimeout(resolve, 10000));
  try {
    await hre.run("verify:verify", {
      address: contract.address,
      constructorArguments: [deployer.address],
    });
    console.log("Contract Verified");


    await new Promise(resolve => setTimeout(resolve, 10000));


    const mintTx = await contract.write.mint();
    console.log("Tokens minted successfully", mintTx);

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