import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import solc from 'solc'

const root = resolve(import.meta.dirname, '..')
const contractNames = ['MockUSDC', 'ReceivableSettlement', 'AuditProofRegistry']

const findImports = (importPath) => {
  const filePath = importPath.startsWith('@')
    ? resolve(root, 'node_modules', importPath)
    : resolve(root, 'contracts', importPath)
  try {
    return { contents: requireRead(filePath) }
  } catch {
    return { error: `Import not found: ${importPath}` }
  }
}

const requireRead = (filePath) => {
  const { readFileSync } = globalThis.__contractCompilerFs
  return readFileSync(filePath, 'utf8')
}

export const compileContracts = async ({ writeArtifacts = true } = {}) => {
  const { readFileSync } = await import('node:fs')
  globalThis.__contractCompilerFs = { readFileSync }
  const sources = Object.fromEntries(await Promise.all(contractNames.map(async (name) => [
    `${name}.sol`,
    { content: await readFile(resolve(root, 'contracts', `${name}.sol`), 'utf8') },
  ])))
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))
  const errors = (output.errors || []).filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ formattedMessage }) => formattedMessage).join('\n'))

  const artifacts = Object.fromEntries(contractNames.map((name) => {
    const compiled = output.contracts[`${name}.sol`][name]
    return [name, { abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` }]
  }))
  if (writeArtifacts) {
    await Promise.all(Object.entries(artifacts).map(async ([name, artifact]) => {
      const path = resolve(root, 'contracts', 'artifacts', `${name}.json`)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify(artifact, null, 2), 'utf8')
    }))
  }
  return artifacts
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await compileContracts()
  console.log(`Compiled ${contractNames.join(', ')} with solc ${solc.version()}`)
}