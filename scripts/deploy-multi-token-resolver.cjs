const { ethers } = require('hardhat');

async function main() {
  console.log('🚀 Deploying MultiTokenAuctionResolver...');

  // Get the contract factory
  const MultiTokenAuctionResolver = await ethers.getContractFactory('MultiTokenAuctionResolver');

  // Deploy the contract
  const multiTokenResolver = await MultiTokenAuctionResolver.deploy();
  await multiTokenResolver.waitForDeployment();

  const deployedAddress = await multiTokenResolver.getAddress();
  
  console.log('✅ MultiTokenAuctionResolver deployed to:', deployedAddress);
  
  // Save deployment info
  const deploymentInfo = {
    contractName: 'MultiTokenAuctionResolver',
    address: deployedAddress,
    deployer: await (await ethers.getSigners())[0].getAddress(),
    deploymentBlock: await ethers.provider.getBlockNumber(),
    timestamp: new Date().toISOString(),
    network: await ethers.provider.getNetwork(),
  };

  console.log('📄 Deployment Info:', JSON.stringify(deploymentInfo, null, 2));

  // Verify important addresses are set correctly
  const usdcAddress = await multiTokenResolver.USDC();
  const fusionAddress = await multiTokenResolver.FUSION_SETTLEMENT();
  
  console.log('🔗 Contract Configuration:');
  console.log('  USDC Address:', usdcAddress);
  console.log('  Fusion Settlement:', fusionAddress);

  // Write deployment info to file
  const fs = require('fs');
  const path = require('path');
  
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Update arbitrum.json with new contract
  const arbitrumDeploymentPath = path.join(deploymentsDir, 'arbitrum.json');
  let existingDeployments = {};
  
  if (fs.existsSync(arbitrumDeploymentPath)) {
    existingDeployments = JSON.parse(fs.readFileSync(arbitrumDeploymentPath, 'utf8'));
  }

  existingDeployments.MultiTokenAuctionResolver = deploymentInfo;

  fs.writeFileSync(
    arbitrumDeploymentPath, 
    JSON.stringify(existingDeployments, null, 2)
  );

  console.log('💾 Deployment info saved to:', arbitrumDeploymentPath);
  
  console.log('\n🎯 Next Steps:');
  console.log('1. Update your .env file with:');
  console.log(`   VITE_MULTI_TOKEN_RESOLVER_ADDRESS=${deployedAddress}`);
  console.log(`   MULTI_TOKEN_RESOLVER_ADDRESS=${deployedAddress}`);
  console.log('2. Apply database migration: supabase/migrations/005_multi_token_bids.sql');
  console.log('3. Test multi-token bidding functionality');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });