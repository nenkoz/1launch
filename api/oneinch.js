const { FetchProviderConnector } = require('@1inch/limit-order-sdk');

const ONE_INCH_BASE_URL = "https://api.1inch.dev/orderbook/v4.0";
const CHAIN_ID = "42161";
const ONE_INCH_API_KEY = process.env.VITE_ONE_INCH_API_KEY;

const logEvent = (level, message, data) => {
    console.log(`[${level}] ${new Date().toISOString()} - ${message}`, data ? JSON.stringify(data) : "");
};

const submitOrder = async (orderHash, orderData, extension, signature) => {
    const reqObj = {
        orderHash,
        signature,
        data: {
            makerAsset: orderData.makerAsset.toLowerCase(),
            takerAsset: orderData.takerAsset.toLowerCase(),
            salt: orderData.salt.toString(),
            receiver: orderData.receiver.toLowerCase(),
            makingAmount: orderData.makingAmount.toString(),
            takingAmount: orderData.takingAmount.toString(),
            maker: orderData.maker.toLowerCase(),
            extension: extension,
            makerTraits: "0x" + BigInt(orderData.makerTraits).toString(16).padStart(64, "0"),
        },
    };
    console.log("📤 Submitting to 1inch API:", JSON.stringify(reqObj, null, 2));
    await new FetchProviderConnector().post(`${ONE_INCH_BASE_URL}/${CHAIN_ID}`, reqObj, { Authorization: `Bearer ${ONE_INCH_API_KEY}` });
};

const getOrderStatus = async (orderHash) => {
    try {
        logEvent("INFO", "Fetching order status from 1inch", { orderHash });
        const response = await fetch(`${ONE_INCH_BASE_URL}/${CHAIN_ID}/order/${orderHash}`, {
            headers: {
                Authorization: `Bearer ${ONE_INCH_API_KEY}`,
                Accept: "application/json",
            },
        });
        const resultString = await response.text();
        console.log("🔍 Response:", resultString);
        const result = JSON.parse(resultString);
        if (!response.ok) {
            if (response.status === 404) {
                logEvent("WARN", "Order not found on 1inch", { orderHash });
            }
            return {
                error: response.statusText,
                result: null,
            };
        }

        logEvent("INFO", "Order status fetched successfully", { orderHash, status: result.status });
        return { error: null, result };
    } catch (error) {
        logEvent("ERROR", "Failed to fetch order status", { error: error.message, orderHash });
        return {
            error: error.message,
            result: null,
        };
    }
};

const settleAuction = async (launchId) => {
    try {
        logEvent("INFO", "Settling auction", { launchId });
        return {
            error: null,
            result: {
                success: true,
                clearingPrice: 0,
                filledQuantity: 0,
                successfulBids: 0,
            },
        };
    }
    catch (error) {
        logEvent("ERROR", "Failed to settle auction", { error: error.message, launchId });
        return {
            error: error.message,
            result: null,
        };
    }
};

module.exports = {
    getOrderStatus,
    submitOrder,
    settleAuction,
};