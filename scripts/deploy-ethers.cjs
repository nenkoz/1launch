const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

// Contract ABIs (we'll need the compiled artifacts)
const TokenFactoryArtifact = require('../artifacts/contracts/TokenFactory.sol/TokenFactory.json');
const AuctionControllerArtifact = require('../artifacts/contracts/AuctionController.sol/AuctionController.json');
const AuctionResolverArtifact = require('../artifacts/contracts/AuctionResolver.sol/AuctionResolver.json');

async function main() {
  console.log('Starting deployment with ethers.js directly...');

  // Contract addresses by network
  const getNetworkAddresses = chainId => {
    switch (chainId) {
      case 42161: // Arbitrum mainnet
        return {
          USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          ONE_INCH_ROUTER: '0x1111111254EEB25477B68fb85Ed929f73A960582',
        };
      case 421614: // Arbitrum Sepolia
        return {
          USDC: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
          ONE_INCH_ROUTER: '0x1111111254EEB25477B68fb85Ed929f73A960582',
        };
      default:
        return {
          USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          ONE_INCH_ROUTER: '0x1111111254EEB25477B68fb85Ed929f73A960582',
        };
    }
  };

  // Setup provider and wallet
  const rpcUrl = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error('PRIVATE_KEY not found in environment variables');
  }

  console.log('Connecting to:', rpcUrl);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log('Deploying with account:', wallet.address);

  // Get network info
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log('Chain ID:', chainId);

  const addresses = getNetworkAddresses(chainId);
  console.log('Using USDC address:', addresses.USDC);
  console.log('Using 1inch router:', addresses.ONE_INCH_ROUTER);

  // Check wallet balance
  const balance = await provider.getBalance(wallet.address);
  console.log('Account balance:', ethers.formatEther(balance), 'ETH');

  if (balance < ethers.parseEther('0.001')) {
    throw new Error(
      'Insufficient balance for deployment. Need at least 0.001 ETH.'
    );
  }

  // Deploy TokenFactory
  console.log('\nDeploying TokenFactory...');
  const TokenFactory = new ethers.ContractFactory(
    TokenFactoryArtifact.abi,
    TokenFactoryArtifact.bytecode,
    wallet
  );

  const tokenFactory = await TokenFactory.deploy(
    wallet.address, // Initial owner
    wallet.address // Fee recipient
  );

  await tokenFactory.waitForDeployment();
  const tokenFactoryAddress = await tokenFactory.getAddress();
  console.log('TokenFactory deployed to:', tokenFactoryAddress);

  // Deploy AuctionController
  console.log('\nDeploying AuctionController...');
  const AuctionController = new ethers.ContractFactory(
    AuctionControllerArtifact.abi,
    AuctionControllerArtifact.bytecode,
    wallet
  );

  const auctionController = await AuctionController.deploy(
    addresses.USDC,
    addresses.ONE_INCH_ROUTER,
    wallet.address
  );

  await auctionController.waitForDeployment();
  const auctionControllerAddress = await auctionController.getAddress();
  console.log('AuctionController deployed to:', auctionControllerAddress);

  // Deploy AuctionResolver

  console.log('\nDeploying AuctionResolver...');
  const AuctionResolver = new ethers.ContractFactory(
    AuctionResolverArtifact.abi,
    AuctionResolverArtifact.bytecode,
    wallet
  );

  const auctionResolver = await AuctionResolver.deploy(
    addresses.USDC,
    addresses.ONE_INCH_ROUTER,
    wallet.address
  );

  await auctionResolver.waitForDeployment();
  const auctionResolverAddress = await auctionResolver.getAddress();
  console.log('auctionResolver deployed to:', auctionResolverAddress);

  // Save deployment info
  const deploymentInfo = {
    network:
      chainId === 42161
        ? 'arbitrum'
        : chainId === 421614
        ? 'arbitrumSepolia'
        : 'unknown',
    chainId,
    deployer: wallet.address,
    contracts: {
      TokenFactory: {
        address: tokenFactoryAddress,
        transactionHash: tokenFactory.deploymentTransaction().hash,
      },
      AuctionController: {
        address: auctionControllerAddress,
        transactionHash: auctionController.deploymentTransaction().hash,
      },
      AuctionResolver: {
        address: auctionResolverAddress,
        transactionHash: auctionResolver.deploymentTransaction().hash,
      },
    },
    dependencies: {
      USDC: addresses.USDC,
      OneInchRouter: addresses.ONE_INCH_ROUTER,
    },
    timestamp: new Date().toISOString(),
  };

  console.log('\nDeployment Summary:');
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Save to file
  const deploymentPath = `./deployments/${deploymentInfo.network}.json`;
  fs.mkdirSync('./deployments', { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to: ${deploymentPath}`);

  // Update environment variables template
  console.log('\nAdd these to your .env file:');
  console.log(`VITE_TOKEN_FACTORY_ADDRESS=${tokenFactoryAddress}`);
  console.log(`VITE_AUCTION_CONTROLLER_ADDRESS=${auctionControllerAddress}`);
  console.log(`VITE_AUCTION_RESOLVER_ADDRESS=${auctionResolverAddress}`);
  console.log(`VITE_USDC_ADDRESS=${addresses.USDC}`);
  console.log(`VITE_ONE_INCH_ROUTER=${addresses.ONE_INCH_ROUTER}`);
  console.log(`VITE_CHAIN_ID=${chainId}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
