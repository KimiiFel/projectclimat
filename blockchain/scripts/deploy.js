const hre = require("hardhat");

async function main() {
  const [admin] = await hre.ethers.getSigners();
  const adminAddr   = process.env.ADMIN || admin.address;
  const gatewayAddr = process.env.GATEWAY || admin.address;

  const F = await hre.ethers.getContractFactory("SensorRegistryV2");
  const c = await F.deploy(adminAddr, gatewayAddr);
  await c.waitForDeployment();
  console.log("SensorRegistryV2 déployé à :", await c.getAddress());
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
