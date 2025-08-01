const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { Sdk, LimitOrder, MakerTraits, Address, randBigInt, FetchProviderConnector } = require("@1inch/limit-order-sdk");

require("dotenv").config({ path: "../.env.local" }); // load env from the root or adjust path if needed

const CONTRACTS = {
    USDC: process.env.USDC_ADDRESS ?? "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum USDC
    AUCTION_CONTROLLER: process.env.AUCTION_CONTROLLER_ADDRESS ?? "0x4ac231577d984859127cB3Ee3aaf1d7d1C6F9161", // Live Arbitrum deployment
    TOKEN_FACTORY: process.env.TOKEN_FACTORY_ADDRESS ?? "0x23b87525f7e6D9FAEBe595459C084193047d72Be", // Updated efficient deployment
};

const app = express();
const PORT = process.env.PORT || 4999;

const fromChainId = process.env.VITE_CHAIN_ID;
if (!fromChainId) {
    console.error("VITE_CHAIN_ID not found. Please set it in your ../.env.local file.");
    process.exit(1);
}

// Validate chain ID for Arbitrum
if (fromChainId !== "42161") {
    console.warn("⚠️  Warning: Chain ID is not Arbitrum mainnet (42161). Current:", fromChainId);
}

const API_KEY = process.env.VITE_ONE_INCH_API_KEY || "";
if (!API_KEY) {
    console.error("One Inch API key not found. Please set it in your ../.env.local file.");
    process.exit(1);
}

console.log("🔧 API Configuration:", {
    chainId: fromChainId,
    apiKey: API_KEY.substring(0, 10) + "...",
    contracts: CONTRACTS
});

// Use JSON body parser
app.use(express.json());

//  cors all origin
const cors = require("cors");
const { getOrderStatus, submitOrder, settleAuction } = require("./oneinch");
app.use(cors());

// Configure Supabase
const supabaseClient = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

app.post("/create_order", async (req, res) => {
    try {
        // Expect body to provide these fields directly
        const { launchId, auctionEndTime, takerAsset, quantity, price, userWallet } = req.body;

        // Validate required fields
        if (!launchId || !auctionEndTime || !takerAsset || !quantity || !price || !userWallet) {
            return res.status(400).json({ error: "Missing required fields: takerAsset, quantity, price, userWallet" });
        }

        console.log("📋 Creating order with parameters:", {
            launchId,
            takerAsset,
            quantity,
            price,
            userWallet,
            chainId: fromChainId
        });

        const MAKER_ASSET = CONTRACTS.USDC; // USDC address on ARB
        const TAKER_ASSET = takerAsset; // e.g., project token

        const sdk = new Sdk({
            authKey: API_KEY,
            networkId: fromChainId,
            httpConnector: new FetchProviderConnector(),
        });
        console.log("/create_order: ✅ SDK v5.x initialized successfully");

        // Calculate amounts (assuming 18 decimals for tokens, 6 for USDC)
        const makingAmountBigInt = BigInt(Math.floor(price * quantity * 1e6));
        const takingAmountBigInt = BigInt(Math.floor(quantity * 1e18));

        console.log("💰 Amount calculations:", {
            price,
            quantity,
            makingAmount: makingAmountBigInt.toString(),
            takingAmount: takingAmountBigInt.toString()
        });

        const expiresIn = 3600n;
        const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn;
        const UINT_40_MAX = (1n << 40n) - 1n;
        const nonce = randBigInt(UINT_40_MAX);

        const makerTraits = MakerTraits.default().withExpiration(expiration).withNonce(nonce).allowPartialFills().allowMultipleFills();

        const order = await sdk.createOrder(
            {
                makerAsset: new Address(MAKER_ASSET),
                takerAsset: new Address(TAKER_ASSET),
                makingAmount: makingAmountBigInt,
                takingAmount: takingAmountBigInt,
                maker: new Address(userWallet),
                receiver: new Address(userWallet),
            },
            makerTraits
        );

        const orderHash = order.getOrderHash(fromChainId);
        const typedData = order.getTypedData();

        console.log("✍️  Signing order with SDK's EIP-712 data...");
        console.log("🔗 Order Hash:", orderHash);
        console.log("🔗 Order Hash type:", typeof orderHash);

        // Ensure domain has the correct chainId for signature validation
        const domain = {
            ...typedData.domain,
            chainId: parseInt(fromChainId)
        };

        // Use the complete types structure from SDK
        const types = typedData.types;

        const orderData = order.build();

        // Get extension data separately
        let extensionData = "0x";

        const extensionObject = order.extension;
        if (extensionObject && typeof extensionObject.encode === "function") {
            extensionData = extensionObject.encode();
        } else if (extensionObject && typeof extensionObject.toString === "function") {
            extensionData = extensionObject.toString();
        }

        console.log("📦 Order data prepared:", {
            orderHash,
            nonce: nonce.toString(),
            expiration: expiration.toString(),
            extensionData
        });

        res.json({
            orderHash,
            orderData,
            extensionData,
            nonce: nonce.toString(),
            expiration: expiration.toString(),
            domain,
            types,
            typedDataMessage: typedData.message,
        });
    } catch (error) {
        console.error("❌ Error in create_order:", error);
        res.status(500).json({ error: error.message });
    }
});



app.post("/finalize_order", async (req, res) => {
    try {
        // Expect body to provide these fields directly
        const { orderHash, orderData, extensionData, nonce, expiration, typedDataSignature, walletSignature } = req.body;

        // Validate required fields
        if (!orderData || !nonce || !expiration) {
            return res.status(400).json({ error: "/finalize_order: Missing required fields: orderData, nonce, expiration" });
        }

        // Validate signature format
        if (!typedDataSignature || !typedDataSignature.startsWith('0x')) {
            return res.status(400).json({ error: "/finalize_order: Invalid signature format" });
        }

        console.log("/finalize_order: ✅ Processing order submission...");
        console.log("🔍 Signature validation:", {
            signatureLength: typedDataSignature.length,
            signaturePrefix: typedDataSignature.substring(0, 10) + "..."
        });

        // Build final API payload following 1inch format
        const orderObject = {
            orderHash: orderHash,
            signature: typedDataSignature,
            data: {
                makerAsset: orderData.makerAsset.toLowerCase(),
                takerAsset: orderData.takerAsset.toLowerCase(),
                salt: orderData.salt.toString(),
                receiver: orderData.receiver.toLowerCase(),
                makingAmount: orderData.makingAmount.toString(),
                takingAmount: orderData.takingAmount.toString(),
                maker: orderData.maker.toLowerCase(),
                extension: extensionData,
                makerTraits: "0x" + BigInt(orderData.makerTraits).toString(16).padStart(64, "0"),
            },
        };

        console.log("\n📋 Complete Order Data for HTTP Testing:");
        console.log(JSON.stringify(orderObject, null, 2));

        // Validate order structure
        console.log("🔍 Order validation:", {
            orderHashLength: orderHash.length,
            signatureLength: typedDataSignature.length,
            extensionLength: extensionData.length,
            makerTraitsLength: orderObject.data.makerTraits.length
        });

        try {
            await submitOrder(orderHash, orderData, extensionData, typedDataSignature);
            console.log("✅ Order submitted successfully to 1inch API");
        } catch (err) {
            console.error("❌ Error submitting order to 1inch API:", err);
            throw err; // Re-throw to handle in the response
        }

        res.json({
            orderHash,
            success: true,
        });
    } catch (error) {
        console.error("❌ Error in finalize_order:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/sync_order_status", async (req, res) => {
    const { orderHash } = req.query;
    const {error, result} = await getOrderStatus(orderHash);
    if (error || !result) {
        console.error("❌ Error in sync_order_status:", error);
        res.status(500).json({ error: error });
    }
    console.log("🔍 Order status:", result);

    // Update local database
    const { error: updateError } = await supabaseClient
    .from("limit_orders")
    .update({
        status: result.status,
        filled_amount: result.filledAmount || 0,
        updated_at: new Date().toISOString(),
    })
    .eq("order_hash", orderHash);

if (updateError) {
    console.error("❌ Error in sync_order_status:", updateError);
}

    res.json(result);
});

app.post("/settle_auction", async (req, res) => {

    const { launchId } = req.body;
    const { error, result } = await settleAuction(launchId);
    if (error || !result) {
        console.error("❌ Error in settle_auction:", error);
        res.status(500).json({ error: error });
    }
    res.json(result);
});

app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
});
