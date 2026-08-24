import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, defineChain, formatEther, http, isAddress, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
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

const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([^#=]+)=(.*)$/)
  return match ? [[match[1].trim(), match[2].trim()]] : []
}))

const loadDeployAccount = async ({ create = false } = {}) => {
  let privateKey
  try {
    privateKey = parseEnv(await readFile(keyPath, 'utf8')).CC3_DEPLOYER_PRIVATE_KEY
  } catch (error) {
    if (!create || error.code !== 'ENOENT') throw error
    privateKey = generatePrivateKey()
    await writeFile(keyPath, `# Creditcoin testnet deployment key. Never commit or share.\nCC3_DEPLOYER_PRIVATE_KEY=${privateKey}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) throw new Error('Invalid CC3_DEPLOYER_PRIVATE_KEY')
  return privateKeyToAccount(privateKey)
}

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

const showAccount = async () => {
  const account = await loadDeployAccount({ create: true })
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Deployer: ${account.address}`)
  console.log(`Balance: ${formatEther(balance)} CTC`)
  if (balance === 0n) console.log('Fund this address in the Creditcoin Discord token-faucet channel, then run npm run deploy:cc3')
}

const replaceEnvValue = (text, name, value) => {
  const nextLine = `${name}=${value}`
  const expression = new RegExp(`^${name}=.*$`, 'm')
  return expression.test(text) ? text.replace(expression, nextLine) : `${text.trimEnd()}\n${nextLine}\n`
}

const deploy = async () => {
  const account = await loadDeployAccount()
  let appEnv = await readFile(appEnvPath, 'utf8')
  const env = parseEnv(appEnv)
  const balance = await publicClient.getBalance({ address: account.address })
  if (balance === 0n) throw new Error(`Deployer ${account.address} has no CTC. Fund it from the Creditcoin Discord faucet first.`)
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
  const artifacts = await compileContracts()

  const tokenHash = await walletClient.deployContract({
    ...artifacts.MockUSDC,
    args: [account.address],
  })
  console.log(`MockUSDC transaction: ${chain.blockExplorers.default.url}/tx/${tokenHash}`)
  const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash })
  if (!tokenReceipt.contractAddress) throw new Error('MockUSDC deployment did not return a contract address')
  console.log(`MockUSDC: ${tokenReceipt.contractAddress}`)

  for (const [role, address] of [['buyer', env.CC3_BUYER_WALLET_ADDRESS], ['funder', env.CC3_FUNDER_WALLET_ADDRESS]]) {
    if (!isAddress(address)) {
      console.log(`Skipped ${role} mUSDC funding: wallet address is not configured.`)
      continue
    }
    const fundingHash = await walletClient.writeContract({
      address: tokenReceipt.contractAddress,
      abi: artifacts.MockUSDC.abi,
      functionName: 'transfer',
      args: [address, parseUnits('250000', 6)],
    })
    const fundingReceipt = await publicClient.waitForTransactionReceipt({ hash: fundingHash })
    if (fundingReceipt.status !== 'success') throw new Error(`Failed to fund ${role} wallet`)
    console.log(`Funded ${role} wallet with 250,000 mUSDC.`)
  }

  const settlementHash = await walletClient.deployContract({
    ...artifacts.ReceivableSettlement,
    args: [account.address, tokenReceipt.contractAddress],
  })
  console.log(`ReceivableSettlement transaction: ${chain.blockExplorers.default.url}/tx/${settlementHash}`)
  const settlementReceipt = await publicClient.waitForTransactionReceipt({ hash: settlementHash })
  if (!settlementReceipt.contractAddress) throw new Error('ReceivableSettlement deployment did not return a contract address')
  console.log(`ReceivableSettlement: ${settlementReceipt.contractAddress}`)

  const auditProofRegistryHash = await walletClient.deployContract({
    ...artifacts.AuditProofRegistry,
    args: [account.address],
  })
  console.log(`AuditProofRegistry transaction: ${chain.blockExplorers.default.url}/tx/${auditProofRegistryHash}`)
  const auditProofRegistryReceipt = await publicClient.waitForTransactionReceipt({ hash: auditProofRegistryHash })
  if (!auditProofRegistryReceipt.contractAddress) throw new Error('AuditProofRegistry deployment did not return a contract address')
  console.log(`AuditProofRegistry: ${auditProofRegistryReceipt.contractAddress}`)

  appEnv = replaceEnvValue(appEnv, 'CC3_USDC_ADDRESS', tokenReceipt.contractAddress)
  appEnv = replaceEnvValue(appEnv, 'CC3_SETTLEMENT_ADDRESS', settlementReceipt.contractAddress)
  appEnv = replaceEnvValue(appEnv, 'CC3_AUDIT_PROOF_REGISTRY_ADDRESS', auditProofRegistryReceipt.contractAddress)
  await writeFile(appEnvPath, appEnv, 'utf8')
  console.log('Updated .env.local with deployed contract addresses.')
}

if (process.argv.includes('--prepare')) await showAccount()
else await deploy()