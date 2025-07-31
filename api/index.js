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

const API_KEY = process.env.VITE_ONE_INCH_API_KEY || "";
if (!API_KEY) {
    console.error("One Inch API key not found. Please set it in your ../.env.local file.");
    process.exit(1);
}

// Use JSON body parser
app.use(express.json());

//  cors all origin
const cors = require("cors");
app.use(cors());

// Configure Supabase
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

app.post("/create_order", async (req, res) => {
    try {
        // Expect body to provide these fields directly
        const { launchId, auctionEndTime, takerAsset, quantity, price, userWallet } = req.body;

        const fromChainId = process.env.VITE_CHAIN_ID;

        // Validate required fields
        if (!launchId || !auctionEndTime || !takerAsset || !quantity || !price || !userWallet) {
            return res.status(400).json({ error: "Missing required fields: takerAsset, quantity, price, userWallet" });
        }

        const MAKER_ASSET = CONTRACTS.USDC; // USDC address on ARB
        const TAKER_ASSET = takerAsset; // e.g., project token

        const sdk = new Sdk({
            authKey: API_KEY,
            networkId: fromChainId,
            httpConnector: new FetchProviderConnector(),
        });
        console.log("✅ SDK v5.x initialized successfully");

        // Calculate amounts (assuming 18 decimals for tokens, 6 for USDC)
        const makingAmountBigInt = BigInt(Math.floor(price * quantity * 1e6));
        const takingAmountBigInt = BigInt(Math.floor(quantity * 1e18));

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
        const orderStruct = order.build();

        res.json({
            orderHash,
            typedData,
            orderStruct,
            nonce: nonce.toString(),
            expiration: expiration.toString(),
            maker: userWallet,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/finalize_order", async (req, res) => {
    try {
        // Expect body to provide these fields directly
        const { orderHash, typedData, orderStruct, nonce, expiration, maker } = req.body;

        // Validate required fields
        if (!orderHash || !typedData || !nonce || !expiration || !maker) {
            return res.status(400).json({ error: "Missing required fields: takerAsset, quantity, price, userWallet" });
        }

        const sdk = new Sdk({
            authKey: API_KEY,
            networkId: fromChainId,
            httpConnector: new FetchProviderConnector(),
        });
        console.log("✅ SDK v5.x initialized successfully");

        const fixedDomain = {
            ...typedData.domain,
            chainId: CHAIN_ID,
        };

        res.json({
            orderHash,
            typedData,
            orderStruct,
            nonce: nonce.toString(),
            expiration: expiration.toString(),
            maker: userWallet,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
});
