import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { JsonRpcProvider, toUtf8String } from 'ethers'
import { chainInfo } from '@gluwa/usc-sdk'

const root = resolve(import.meta.dirname, '..')
const envPath = resolve(root, '.env.local')

const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([^#=]+)=(.*)$/)
  return match ? [[match[1].trim(), match[2].trim()]] : []
}))

let env = {}
try {
  env = parseEnv(await readFile(envPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const rpcUrl = env.CC3_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network'
const expectedChainKey = Number(env.ATTESTCOIN_SOURCE_CHAIN_KEY || '1')
const provider = new JsonRpcProvider(rpcUrl)

try {
  const network = await provider.getNetwork()
  if (network.chainId !== 102031n) throw new Error(`Expected CC3 Testnet chain 102031, received ${network.chainId}`)
  const chains = await new chainInfo.PrecompileChainInfoProvider(provider).getSupportedChains()
  const sepolia = chains.find((chain) => chain.chainId === 11155111)
  if (!sepolia) throw new Error('Ethereum Sepolia is not supported by the connected Attestcoin environment')
  if (sepolia.chainKey !== expectedChainKey) {
    throw new Error(`Configured source chain key ${expectedChainKey} does not match runtime value ${sepolia.chainKey}`)
  }
  const chainName = sepolia.chainName.startsWith('0x') ? toUtf8String(sepolia.chainName) : sepolia.chainName
  console.log(`CC3 Testnet: ${network.chainId}`)
  console.log(`Attestcoin source: ${chainName} (${sepolia.chainId}), chainKey ${sepolia.chainKey}`)
  console.log('Attestcoin preflight passed.')
} finally {
  provider.destroy()
}