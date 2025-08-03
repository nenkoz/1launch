const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🚀 Deploying AuctionFusionResolver...');

  // Contract parameters
  const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Arbitrum USDC
  const ONE_INCH_ROUTER = '0x1111111254EEB25477B68fb85Ed929f73A960582'; // 1inch Limit Order Protocol v4
  
  // Deploy the contract
  const AuctionFusionResolver = await ethers.getContractFactory('AuctionFusionResolver');
  const resolver = await AuctionFusionResolver.deploy(USDC_ADDRESS, ONE_INCH_ROUTER);
  
  await resolver.waitForDeployment();
  const resolverAddress = await resolver.getAddress();

  console.log('✅ AuctionFusionResolver deployed to:', resolverAddress);

  // Save deployment info
  const deploymentInfo = {
    contractName: 'AuctionFusionResolver',
    address: resolverAddress,
    deployer: (await ethers.getSigners())[0].address,
    deploymentBlock: (await ethers.provider.getBlockNumber()),
    timestamp: new Date().toISOString(),
    network: {
      name: 'arbitrum',
      chainId: '42161',
    },
    constructorArgs: {
      usdc: USDC_ADDRESS,
      oneInchRouter: ONE_INCH_ROUTER,
    }
  };

  // Update deployments file
  const deploymentsPath = path.join(__dirname, '../deployments/arbitrum.json');
  let deployments = {};
  
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
  }
  
  deployments.AuctionFusionResolver = deploymentInfo;
  
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));

  console.log('📄 Deployment Info:', JSON.stringify(deploymentInfo, null, 2));
  
  console.log('🔗 Contract Configuration:');
  console.log('  USDC Address:', USDC_ADDRESS);
  console.log('  1inch Router:', ONE_INCH_ROUTER);
  
  console.log('💾 Deployment info saved to:', deploymentsPath);

  console.log('\n🎯 Next Steps:');
  console.log('1. Update your .env file with:');
  console.log(`   AUCTION_FUSION_RESOLVER_ADDRESS=${resolverAddress}`);
  console.log('2. Apply database migration: 008_resolver_fusion_bids.sql');
  console.log('3. Create ResolverFusionBidForm component');
  console.log('4. Test the complete resolver flow');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });