import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { compileContracts } from './compile-contracts.mjs'

const root = resolve(import.meta.dirname, '..')
const keyPath = resolve(root, '.env.deploy.local')
const appEnvPath = resolve(root, '.env.local')
const rpcUrl = 'https://rpc.cc3-testnet.creditcoin.network'
const chain = defineChain({
  id: 102031,
  name: 'Creditcoin Testnet',
  nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://creditcoin-testnet.blockscout.com' } },
  testnet: true,
})

const keyFile = await readFile(keyPath, 'utf8')
const privateKey = keyFile.match(/^CC3_(?:RELAYER|DEPLOYER)_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1]
if (!privateKey) throw new Error('CC3 deployer key is not configured')

const account = privateKeyToAccount(privateKey)
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
const artifacts = await compileContracts({ writeArtifacts: true })
const transactionHash = await walletClient.deployContract({
  ...artifacts.AuditProofRegistry,
  args: [account.address],
})
console.log(`AuditProofRegistry transaction: ${chain.blockExplorers.default.url}/tx/${transactionHash}`)
const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('AuditProofRegistry deployment failed')

let appEnv = await readFile(appEnvPath, 'utf8')
const line = `CC3_AUDIT_PROOF_REGISTRY_ADDRESS=${receipt.contractAddress}`
appEnv = /^CC3_AUDIT_PROOF_REGISTRY_ADDRESS=.*$/m.test(appEnv)
  ? appEnv.replace(/^CC3_AUDIT_PROOF_REGISTRY_ADDRESS=.*$/m, line)
  : `${appEnv.trimEnd()}\n${line}\n`
await writeFile(appEnvPath, appEnv, 'utf8')
console.log(`AuditProofRegistry: ${receipt.contractAddress}`)