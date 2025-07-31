import React, { createContext, useContext, ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, sepolia, arbitrum } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createWeb3Modal } from '@web3modal/wagmi/react';
import { defaultWagmiConfig } from '@web3modal/wagmi/react/config';

// Environment variables
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';
const chainId = parseInt(import.meta.env.VITE_CHAIN_ID || '42161');

// Contract addresses - Live on Arbitrum mainnet!
export const CONTRACTS = {
    AUCTION_CONTROLLER: import.meta.env.VITE_AUCTION_CONTROLLER_ADDRESS || '0x8D058Fb25D7005beA57923141620D7FeF3F037a4',
    TOKEN_FACTORY: import.meta.env.VITE_TOKEN_FACTORY_ADDRESS || '0x17dc0102c32704a5cC42Eb3Ac3048fbA990fe55B',
    USDC: import.meta.env.VITE_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum USDC
    ONE_INCH_ROUTER: import.meta.env.VITE_ONE_INCH_ROUTER || '0x1111111254EEB25477B68fb85Ed929f73A960582',
};

// Chain configuration - Arbitrum first for production!
const chains = [arbitrum, mainnet, sepolia] as const;

// Wagmi configuration
const config = defaultWagmiConfig({
    chains,
    projectId,
    metadata: {
        name: 'Dutch Coin Arena',
        description: 'Decentralized Token Launch Platform',
        url: 'https://dutch-coin-arena.com',
        icons: ['https://dutch-coin-arena.com/favicon.ico']
    },
    transports: {
        [arbitrum.id]: http(),
        [mainnet.id]: http(),
        [sepolia.id]: http(),
    },
});

// Create modal
createWeb3Modal({
    wagmiConfig: config,
    projectId,
    enableAnalytics: true,
    enableOnramp: true,
});

interface Web3ContextType {
    contracts: typeof CONTRACTS;
    chainId: number;
    // All 1inch API calls go through Supabase functions for production
}

const Web3Context = createContext<Web3ContextType | undefined>(undefined);

export const useWeb3 = () => {
    const context = useContext(Web3Context);
    if (!context) {
        throw new Error('useWeb3 must be used within a Web3Provider');
    }
    return context;
};

const queryClient = new QueryClient();

interface Web3ProviderProps {
    children: ReactNode;
}

export const Web3Provider: React.FC<Web3ProviderProps> = ({ children }) => {
    const contextValue: Web3ContextType = {
        contracts: CONTRACTS,
        chainId,
        // All 1inch API interactions happen server-side via Supabase functions
    };

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <Web3Context.Provider value={contextValue}>
                    {children}
                </Web3Context.Provider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}; 