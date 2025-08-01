import { sha256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const orderData = {
    // USDC
    makerAsset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    takerAsset: "0x48EFEe14FDAc70b0436677C0f5F1F00B3C4dbeE4",
    salt: "102412815606623380341116538548691999185294800833598575997420130516214237580230",
    receiver: "0x2C31f55A6a36537a5AeC50Be3bF6986B5c5D7dCC",
    makingAmount: "10000000000",
    takingAmount: "2777777777777778000000",
    maker: "0x2C31f55A6a36537a5AeC50Be3bF6986B5c5D7dCC",
    extension: "0x",
    makerTraits: "0x4e0000000000000000000000000000000000688e82ac00000000000000000000",
};

const generateOrderHash = (orderData) => {
    const json = JSON.stringify(orderData);
    const hashBytes = toBytes(json);
    return sha256(hashBytes);
};

const generatePKSignature = async (orderHash, walletPrivateKey) => {
    // conv key into a viem “account” object
    const accountObject = privateKeyToAccount(walletPrivateKey);
    console.log("confirm maker address: %s \n", accountObject.address);

    // viem wants a Uint8Array for binary messages
    const signature = await accountObject.signMessage({
        message: { raw: orderHash },
    });
    return signature;
};

// 3. Sign the raw 32-byte hash
async function main() {
    const walletPrivateKey = process.env.PRIVATE_KEY;
    if (!walletPrivateKey) {
        console.log("PRIVATE_KEY env is required.");
        return;
    }

    // 1. Compute the SHA-256 hash of the JSON string
    const orderHash = generateOrderHash(orderData);
    console.log("Order Hash: %s \n", orderHash);

    const signature = await generatePKSignature(orderHash, walletPrivateKey);

    console.log("Signature: %s \n", signature);
    // signature is a 65-byte hex string (0x{r}{s}{v})
}

void main();
