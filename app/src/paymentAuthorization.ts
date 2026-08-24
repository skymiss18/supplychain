import type { Address, Hex } from 'viem'

export const CREDITCOIN_TESTNET_CHAIN_ID = 102031
export const CREDITCOIN_TESTNET_RPC_URL = 'https://rpc.cc3-testnet.creditcoin.network'

export const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

export type PaymentAuthorizationConfig = {
  chainId: typeof CREDITCOIN_TESTNET_CHAIN_ID
  tokenName: string
  tokenVersion: string
  tokenAddress: Address
  settlementAddress: Address
  value: string
  validAfter: string
  validBefore: string
  demoMode: boolean
}

export type PaymentAuthorizationMessage = {
  from: Address
  to: Address
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: Hex
}

export const buildPaymentAuthorizationTypedData = (
  config: PaymentAuthorizationConfig,
  from: Address,
  nonce: Hex,
) => ({
  domain: {
    name: config.tokenName,
    version: config.tokenVersion,
    chainId: config.chainId,
    verifyingContract: config.tokenAddress,
  },
  types: transferWithAuthorizationTypes,
  primaryType: 'TransferWithAuthorization' as const,
  message: {
    from,
    to: config.settlementAddress,
    value: BigInt(config.value),
    validAfter: BigInt(config.validAfter),
    validBefore: BigInt(config.validBefore),
    nonce,
  },
})

export const serializePaymentAuthorizationMessage = (message: PaymentAuthorizationMessage) => ({
  ...message,
  value: message.value.toString(),
  validAfter: message.validAfter.toString(),
  validBefore: message.validBefore.toString(),
})