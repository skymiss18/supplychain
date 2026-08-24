import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { CREDITCOIN_TESTNET_CHAIN_ID, CREDITCOIN_TESTNET_RPC_URL } from './paymentAuthorization'

export const creditcoinTestnet = defineChain({
  id: CREDITCOIN_TESTNET_CHAIN_ID,
  name: 'Creditcoin Testnet',
  nativeCurrency: { name: 'Test Creditcoin', symbol: 'tCTC', decimals: 18 },
  rpcUrls: { default: { http: [CREDITCOIN_TESTNET_RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://creditcoin-testnet.blockscout.com' } },
  testnet: true,
})

const connectors = connectorsForWallets(
  [{ groupName: '浏览器钱包', wallets: [injectedWallet] }],
  {
    appName: 'AttestFlow',
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'disabled',
  },
)

export const wagmiConfig = createConfig({
  chains: [creditcoinTestnet],
  connectors,
  transports: { [creditcoinTestnet.id]: http(CREDITCOIN_TESTNET_RPC_URL) },
})