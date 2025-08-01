// Correct imports for v5.x with FetchProviderConnector
const { Sdk, LimitOrder, MakerTraits, Address, randBigInt, FetchProviderConnector } = require('@1inch/limit-order-sdk');
const { ethers } = require('ethers');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '.env.local' });

async function createLimitOrderV5() {
    try {
        // Configuration
        const API_KEY = process.env.ONE_INCH_API_KEY || 'nkhoswAuNTpu4DGJ2OmxTxI7x4dLRMMM'; // Your API key from .http
        const CHAIN_ID = 42161; // Arbitrum One

        // Setup wallet
        const privKey = process.env.PRIVATE_KEY;
        if (!privKey) {
            throw new Error("PRIVATE_KEY not found in .env.local");
        }

        const formattedPrivateKey = privKey.startsWith('0x') ? privKey : `0x${privKey}`;
        const wallet = new ethers.Wallet(formattedPrivateKey);

        console.log("🔗 Connected to Arbitrum One");
        console.log("💰 Wallet address:", wallet.address);
        console.log("🔑 Using API Key:", API_KEY.substring(0, 8) + '...');

        // Initialize SDK with FetchProviderConnector
        const sdk = new Sdk({
            authKey: API_KEY,
            networkId: CHAIN_ID,
            httpConnector: new FetchProviderConnector()
        });

        console.log("✅ SDK v5.x initialized successfully");

        // Order configuration
        const usdcAmount = 0.1; // 0.1 USDC
        const pricePerToken = 0.0036; // $0.0036 per token
        const tokenAmount = usdcAmount / pricePerToken;

        const makingAmount = BigInt(Math.floor(usdcAmount * 1e6)); // USDC has 6 decimals
        const takingAmount = BigInt(Math.floor(tokenAmount * 1e18)); // Assuming 18 decimals

        console.log("📊 Order Details:");
        console.log("   USDC Amount:", usdcAmount, "USDC");
        console.log("   Token Amount:", tokenAmount.toFixed(3), "tokens");
        console.log("   Price per token: $" + pricePerToken);
        console.log("   Making Amount:", makingAmount.toString());
        console.log("   Taking Amount:", takingAmount.toString());

        // Configure order expiration (1 hour from now)
        const expiresIn = 3600n; // 1 hour in seconds  
        const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn;

        // Create random nonce using the new randBigInt utility
        const UINT_40_MAX = (1n << 40n) - 1n;
        const nonce = randBigInt(UINT_40_MAX);

        console.log("🎲 Generated nonce:", nonce.toString());

        // Create maker traits with proper flags according to 1inch v4 protocol
        // According to description.md:
        // - ALLOW_MULTIPLE_FILLS (bit 254) = 0x4000000000000000000000000000000000000000000000000000000000000000
        // - HAS_EXTENSION (bit 249) = 0x0080000000000000000000000000000000000000000000000000000000000000
        const makerTraits = MakerTraits.default()
            .withExpiration(expiration)
            .withNonce(nonce)
            .allowPartialFills()
            .allowMultipleFills();

        console.log("📝 Creating order with SDK v5.x...");

        // Create the limit order - let SDK handle salt/extension properly
        const order = await sdk.createOrder({
            makerAsset: new Address('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'), // USDC on Arbitrum
            takerAsset: new Address('0x48EFEe14FDAc70b0436677C0f5F1F00B3C4dbeE4'), // Your project token
            makingAmount: makingAmount, // 0.1 USDC
            takingAmount: takingAmount, // ~27.778 tokens
            maker: new Address(wallet.address),
            receiver: new Address('0xc0dfdb9e7a392c3dbbe7c6fbe8fbc1789c9fe05e') // Set specific receiver
        }, makerTraits);

        console.log("✅ Order created successfully with SDK");

        // Use SDK's own typed data and hash calculation (it knows the correct protocol implementation)
        const typedData = order.getTypedData();

        console.log("📋 SDK Typed Data:");
        console.log("🏷️  Domain:", JSON.stringify(typedData.domain, null, 2));
        console.log("📝 Types:", JSON.stringify(typedData.types, null, 2));
        console.log("📄 Message:", JSON.stringify(typedData.message, null, 2));

        console.log("✍️  Signing order with SDK's EIP-712 data...");

        // Fix the domain to include chainId (SDK omits it but ethers needs it)
        const fixedDomain = {
            ...typedData.domain,
            chainId: CHAIN_ID
        };

        // Extract only the Order types (ethers.js doesn't want EIP712Domain)
        const orderTypes = {
            Order: typedData.types.Order
        };

        console.log("🔧 Fixed Domain:", JSON.stringify(fixedDomain, null, 2));
        console.log("🔧 Order Types:", JSON.stringify(orderTypes, null, 2));

        // Sign using corrected typed data
        const signature = await wallet.signTypedData(
            fixedDomain,
            orderTypes,
            typedData.message
        );

        console.log("✅ Order signed successfully");

        // Use SDK's order hash calculation (guaranteed to match API expectation)
        const orderHash = order.getOrderHash(CHAIN_ID);
        console.log("🔑 Order Hash:", orderHash);
        console.log("✍️  Signature:", signature);

        // Get extension data separately
        const extensionObj = order.extension;
        let extensionData = "0x";

        if (extensionObj && typeof extensionObj.encode === 'function') {
            extensionData = extensionObj.encode();
        } else if (extensionObj && typeof extensionObj.toString === 'function') {
            extensionData = extensionObj.toString();
        }

        console.log("🔍 Extension data:", extensionData);

        // Get the built order structure for API payload
        const orderStruct = order.build();
        console.log("📋 Built Order Structure:");
        console.log(JSON.stringify(orderStruct, null, 2));

        // Format makerTraits as hex string (per working example)
        const makerTraitsHex = "0x" + BigInt(orderStruct.makerTraits).toString(16).padStart(64, '0');

        // Build final API payload following 1inch format and working example structure
        const orderData = {
            orderHash: orderHash,
            signature: signature,
            data: {
                makerAsset: orderStruct.makerAsset.toLowerCase(),
                takerAsset: orderStruct.takerAsset.toLowerCase(),
                salt: orderStruct.salt.toString(),
                receiver: orderStruct.receiver.toLowerCase(),
                makingAmount: orderStruct.makingAmount.toString(),
                takingAmount: orderStruct.takingAmount.toString(),
                maker: orderStruct.maker.toLowerCase(),
                extension: extensionData,
                makerTraits: makerTraitsHex
            }
        };

        console.log("\n📋 Complete Order Data for HTTP Testing:");
        console.log(JSON.stringify(orderData, null, 2));

        console.log("\n🔍 Debug Information:");
        console.log("Extension length:", extensionData.length);
        console.log("Salt (decimal):", orderStruct.salt.toString());
        console.log("Salt (hex):", "0x" + BigInt(orderStruct.salt).toString(16));
        console.log("MakerTraits (decimal):", orderStruct.makerTraits.toString());
        console.log("MakerTraits (hex):", makerTraitsHex);
        console.log("Typed data domain:", JSON.stringify(typedData.domain, null, 2));
        console.log("Signed message:", JSON.stringify(typedData.message, null, 2));

        // Skip automatic submission for manual testing
        console.log("\n⏭️  Skipping automatic submission");
        console.log("💡 Use the data above to test in your .http file");

        return {
            order,
            signature,
            orderHash,
            orderData,
            orderStruct,
            typedData
        };

    } catch (error) {
        console.error("❌ Error creating limit order:", error);

        // More specific error handling
        if (error.message.includes('API_KEY') || error.message.includes('authKey')) {
            console.error("💡 Tip: Make sure to set ONE_INCH_API_KEY in your .env.local file");
        }
        if (error.message.includes('PRIVATE_KEY')) {
            console.error("💡 Tip: Make sure PRIVATE_KEY is set in your .env.local file");
        }
        if (error.message.includes('insufficient')) {
            console.error("💡 Tip: Make sure your wallet has enough USDC and is approved for 1inch");
        }

        throw error;
    }
}

// Run the script
createLimitOrderV5()
    .then((result) => {
        console.log("\n🎉 Script completed successfully!");
        console.log("📋 Order hash:", result.orderHash);
        console.log("🔍 Order structure keys:", Object.keys(result.orderStruct));
    })
    .catch((error) => {
        console.error("\n💥 Script failed:", error.message);
        process.exit(1);
    }); 