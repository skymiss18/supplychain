import assert from 'node:assert/strict'
import test from 'node:test'
import { compileContracts } from '../scripts/compile-contracts.mjs'

const artifacts = await compileContracts({ writeArtifacts: false })

const findAbiItem = (abi, type, name) => abi.find((item) => item.type === type && item.name === name)

test('source contract exposes the buyer attestation event and call', () => {
  const abi = artifacts.ReceivableAttestationSource.abi
  const attest = findAbiItem(abi, 'function', 'attest')
  const event = findAbiItem(abi, 'event', 'ReceivableAttested')

  assert.deepEqual(attest.inputs.map(({ type }) => type), ['bytes32', 'bytes32'])
  assert.deepEqual(event.inputs.map(({ type, indexed }) => [type, indexed]), [
    ['bytes32', true],
    ['bytes32', true],
    ['address', true],
  ])
})

test('registry accepts Attestcoin proof fields and exposes financing eligibility', () => {
  const abi = artifacts.AuditProofRegistry.abi
  const constructor = abi.find((item) => item.type === 'constructor')
  const registerProof = findAbiItem(abi, 'function', 'registerProof')
  const isVerified = findAbiItem(abi, 'function', 'isVerified')

  assert.deepEqual(constructor.inputs.map(({ type }) => type), ['address', 'uint64', 'address'])
  assert.deepEqual(registerProof.inputs.map(({ type }) => type), [
    'uint64',
    'uint64',
    'bytes',
    'bytes32',
    'tuple[]',
    'bytes32',
    'bytes32[]',
  ])
  assert.equal(registerProof.stateMutability, 'nonpayable')
  assert.deepEqual(isVerified.outputs.map(({ type }) => type), ['bool'])
})

test('settlement constructor requires the registry and declares the proof gate error', () => {
  const abi = artifacts.ReceivableSettlement.abi
  const constructor = abi.find((item) => item.type === 'constructor')
  const proofError = findAbiItem(abi, 'error', 'ProofNotVerified')
  const registry = findAbiItem(abi, 'function', 'auditProofRegistry')

  assert.deepEqual(constructor.inputs.map(({ type }) => type), ['address', 'address', 'address'])
  assert.deepEqual(proofError.inputs.map(({ type }) => type), ['bytes32'])
  assert.deepEqual(registry.outputs.map(({ type }) => type), ['address'])
})