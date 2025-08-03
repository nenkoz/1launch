import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    server: {
        host: "::",
        port: 8080,
        proxy: {
            '/token_prices': 'http://localhost:4999',
            '/create_fusion_resolver_bid': 'http://localhost:4999',
            '/submit_fusion_resolver_bid': 'http://localhost:4999',
            '/settle_fusion_resolver_auction': 'http://localhost:4999',
            // Legacy endpoints if needed
            '/private_bids': 'http://localhost:4999',
            '/submit_order': 'http://localhost:4999',
            '/settle_private_auction': 'http://localhost:4999',
        },
    },
    plugins: [
        react(),
        // mode === 'development' &&
        // componentTagger(), // Commented out due to ES module conflict
    ].filter(Boolean),
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
}));
