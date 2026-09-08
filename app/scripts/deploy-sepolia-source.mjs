import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, formatEther, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { compileContracts } from './compile-contracts.mjs'

const root = resolve(import.meta.dirname, '..')
const keyPath = resolve(root, '.env.deploy.local')
const appEnvPath = resolve(root, '.env.local')

const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([^#=]+)=(.*)$/)
  return match ? [[match[1].trim(), match[2].trim()]] : []
}))

const replaceEnvValue = (text, name, value) => {
  const nextLine = `${name}=${value}`
  const expression = new RegExp(`^${name}=.*$`, 'm')
  return expression.test(text) ? text.replace(expression, nextLine) : `${text.trimEnd()}\n${nextLine}\n`
}

const loadAccount = async ({ create = false } = {}) => {
  let keyFile = ''
  try {
    keyFile = await readFile(keyPath, 'utf8')
  } catch (error) {
    if (!create || error.code !== 'ENOENT') throw error
  }
  let privateKey = parseEnv(keyFile).SEPOLIA_DEPLOYER_PRIVATE_KEY
  if (!privateKey && create) {
    privateKey = generatePrivateKey()
    const separator = keyFile && !keyFile.endsWith('\n') ? '\n' : ''
    await writeFile(
      keyPath,
      `${keyFile}${separator}# Ethereum Sepolia deployment key. Never commit or share.\nSEPOLIA_DEPLOYER_PRIVATE_KEY=${privateKey}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) throw new Error('Invalid SEPOLIA_DEPLOYER_PRIVATE_KEY')
  return privateKeyToAccount(privateKey)
}

const createClients = async (account) => {
  const appEnv = await readFile(appEnvPath, 'utf8')
  const rpcUrl = parseEnv(appEnv).SEPOLIA_RPC_URL || sepolia.rpcUrls.default.http[0]
  return {
    appEnv,
    publicClient: createPublicClient({ chain: sepolia, transport: http(rpcUrl) }),
    walletClient: createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) }),
  }
}

const prepare = async () => {
  const account = await loadAccount({ create: true })
  const { publicClient } = await createClients(account)
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Sepolia deployer: ${account.address}`)
  console.log(`Balance: ${formatEther(balance)} ETH`)
  if (balance === 0n) console.log('Fund this address with Sepolia ETH, then run npm run deploy:sepolia')
}

const deploy = async () => {
  const account = await loadAccount()
  const { appEnv, publicClient, walletClient } = await createClients(account)
  const balance = await publicClient.getBalance({ address: account.address })
  if (balance === 0n) throw new Error(`Sepolia deployer ${account.address} has no ETH`)
  const artifacts = await compileContracts()
  const hash = await walletClient.deployContract({ ...artifacts.ReceivableAttestationSource })
  console.log(`ReceivableAttestationSource transaction: ${sepolia.blockExplorers.default.url}/tx/${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Sepolia source deployment failed')

  const nextEnv = replaceEnvValue(appEnv, 'SEPOLIA_ATTESTATION_SOURCE_ADDRESS', receipt.contractAddress)
  await writeFile(appEnvPath, nextEnv, 'utf8')
  console.log(`ReceivableAttestationSource: ${receipt.contractAddress}`)
  console.log('Updated .env.local with the Sepolia source contract address.')
}

if (process.argv.includes('--prepare')) await prepare()
else await deploy()