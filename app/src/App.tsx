import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount, useConnect, useDisconnect, usePublicClient, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi'
import { formatUnits, isAddressEqual, keccak256, parseUnits, toBytes, toHex, type Address, type Hex } from 'viem'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowRight,
  Bell,
  Building2,
  Check,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  WalletCards,
  Zap,
} from 'lucide-react'
import './App.css'
import {
  CREDITCOIN_TESTNET_CHAIN_ID,
  buildPaymentAuthorizationTypedData,
  serializePaymentAuthorizationMessage,
  type PaymentAuthorizationConfig,
} from './paymentAuthorization'

type Role = 'supplier' | 'buyer' | 'funder' | 'operator'
type ReceivableStatus = 'pending' | 'active' | 'assigned' | 'matured' | 'settled' | 'paid' | 'defaulted'
type FinancingStatus = 'not_requested' | 'quoting' | 'offered' | 'funded' | 'repaid' | 'in_default'
type PaymentStatus = 'not_due' | 'authorized' | 'pending' | 'claimable' | 'claiming' | 'paid' | 'failed'
type ProofStatus = 'not_started' | 'queued' | 'waiting_source' | 'building' | 'submitting' | 'recorded' | 'failed'
type AuthorizationStep = 'idle' | 'connecting' | 'switching' | 'signing' | 'verifying' | 'verified'
type PaymentAuthorizationStatus = {
  status: 'verified' | 'not_found'
  authorizationHash?: Hex
  signer?: Address
  verifiedAt?: string
  error?: string
}

type SettlementResult = {
  transactionHash?: Hex
  claimableAmount?: string
  recipient?: Address
  alreadySettled?: boolean
  error?: string
}

type AuditProofJob = {
  receivableId: string
  status: ProofStatus
  sourceTransactionHash?: Hex
  sourceBlockNumber?: string
  evidenceHash?: Hex
  registrationTransactionHash?: Hex
  registeredAt?: string
  error?: string
}

type FinancingConfig = PaymentAuthorizationConfig & {
  error?: string
}

type ChainFinancingOffer = readonly [
  funder: Address,
  supplier: Address,
  token: Address,
  principal: bigint,
  faceValue: bigint,
  annualizedYieldBps: bigint,
  validUntil: bigint,
  accepted: boolean,
]

type Receivable = {
  id: string
  buyer: string
  supplier: string
  invoice: string
  contractNumber: string
  amount: number
  dueDate: string
  status: ReceivableStatus
  financingStatus: FinancingStatus
}

const initialReceivable: Receivable = {
  id: 'AR-2026-000001',
  buyer: '环球制造集团',
  supplier: '华辰精密有限公司',
  invoice: 'INV-8891',
  contractNumber: 'SC-2026-0818',
  amount: 100000,
  dueDate: '2026-10-25',
  status: 'pending',
  financingStatus: 'not_requested',
}

const financingQuote = {
  funder: '远海资本',
  advanceRate: 96.84,
  annualizedYield: 18.6,
  expiresAt: '2026-08-23 18:00 UTC',
}

const defaultQuoteExpiry = () => {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return new Date(expiresAt.getTime() - expiresAt.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const calculateAnnualizedYield = (faceValue: number, principal: number, dueDate: string) => {
  const millisecondsUntilMaturity = new Date(`${dueDate}T00:00:00Z`).getTime() - Date.now()
  const remainingDays = millisecondsUntilMaturity / (24 * 60 * 60 * 1000)
  if (principal <= 0 || remainingDays <= 0) return null
  return ((faceValue - principal) / principal) * (365 / remainingDays) * 100
}

const roleNames: Record<Role, string> = {
  supplier: '供应商',
  buyer: '核心买方',
  funder: '资金方',
  operator: '平台运营',
}

const roleDescriptions: Record<Role, string> = {
  operator: '监控结算、授权与异常事件',
  supplier: '创建应收并发起融资申请',
  buyer: '确认债务并签署付款授权',
  funder: '提交报价并领取结算资金',
}

const loginRoles: Role[] = ['operator', 'supplier', 'buyer', 'funder']

const receivableStatusNames: Record<ReceivableStatus, string> = {
  pending: '待买方确权',
  active: '已确权可融资',
  assigned: '债权已转让',
  matured: '已到期',
  settled: '结算款待领取',
  paid: '已结清',
  defaulted: '已违约',
}

const settlementAbi = [
  { type: 'function', name: 'requestFinancing', stateMutability: 'nonpayable', inputs: [{ name: 'receivableIdHash', type: 'bytes32' }, { name: 'token', type: 'address' }, { name: 'faceValue', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'submitOffer', stateMutability: 'nonpayable', inputs: [{ name: 'receivableIdHash', type: 'bytes32' }, { name: 'principal', type: 'uint256' }, { name: 'annualizedYieldBps', type: 'uint256' }, { name: 'validUntil', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'acceptOffer', stateMutability: 'nonpayable', inputs: [{ name: 'receivableIdHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'financingRequests', stateMutability: 'view', inputs: [{ name: 'receivableIdHash', type: 'bytes32' }], outputs: [{ name: 'supplier', type: 'address' }, { name: 'token', type: 'address' }, { name: 'faceValue', type: 'uint256' }] },
  { type: 'function', name: 'financingOffers', stateMutability: 'view', inputs: [{ name: 'receivableIdHash', type: 'bytes32' }], outputs: [{ name: 'funder', type: 'address' }, { name: 'supplier', type: 'address' }, { name: 'token', type: 'address' }, { name: 'principal', type: 'uint256' }, { name: 'faceValue', type: 'uint256' }, { name: 'annualizedYieldBps', type: 'uint256' }, { name: 'validUntil', type: 'uint64' }, { name: 'accepted', type: 'bool' }] },
  { type: 'function', name: 'settledReceivables', stateMutability: 'view', inputs: [{ name: 'receivableIdHash', type: 'bytes32' }], outputs: [{ name: 'settled', type: 'bool' }] },
  { type: 'function', name: 'claimable', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }, { name: 'account', type: 'address' }], outputs: [{ name: 'amount', type: 'uint256' }] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }], outputs: [{ name: 'amount', type: 'uint256' }] },
  { type: 'event', name: 'FinancingRequested', inputs: [{ indexed: true, name: 'receivableIdHash', type: 'bytes32' }, { indexed: true, name: 'supplier', type: 'address' }, { indexed: true, name: 'token', type: 'address' }, { indexed: false, name: 'faceValue', type: 'uint256' }] },
  { type: 'event', name: 'FinancingOfferSubmitted', inputs: [{ indexed: true, name: 'receivableIdHash', type: 'bytes32' }, { indexed: true, name: 'funder', type: 'address' }, { indexed: true, name: 'supplier', type: 'address' }, { indexed: false, name: 'token', type: 'address' }, { indexed: false, name: 'principal', type: 'uint256' }, { indexed: false, name: 'faceValue', type: 'uint256' }, { indexed: false, name: 'annualizedYieldBps', type: 'uint256' }, { indexed: false, name: 'validUntil', type: 'uint64' }] },
  { type: 'event', name: 'FinancingOfferAccepted', inputs: [{ indexed: true, name: 'receivableIdHash', type: 'bytes32' }, { indexed: true, name: 'supplier', type: 'address' }, { indexed: true, name: 'funder', type: 'address' }] },
] as const

const tokenAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ name: 'success', type: 'bool' }] },
] as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const receivableHash = (id: string) => keccak256(toBytes(id))

const readDocumentText = async (file: File) => {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return file.text()
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist')
  GlobalWorkerOptions.workerSrc = pdfWorker
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
  }
  return pages.join('\n')
}

const getWalletErrorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback
  if (/provider not found/i.test(error.message)) return '未检测到浏览器 EVM 钱包，请先安装或启用钱包扩展'
  if (/user rejected|rejected the request/i.test(error.message)) return '你已取消本次钱包操作，业务状态未发生变化'
  return error.message.split('\n')[0] || fallback
}

const sessionRoleKey = 'attestflow.role'
const getSessionRole = (): Role | null => {
  const value = sessionStorage.getItem(sessionRoleKey)
  return value === 'supplier' || value === 'buyer' || value === 'funder' || value === 'operator' ? value : null
}

function App() {
  const connection = useAccount()
  const { openConnectModal } = useConnectModal()
  const { connectors, connectAsync } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const initialSessionRole = getSessionRole()
  const isLoginPage = window.location.pathname === '/login'
  const [role, setRole] = useState<Role>(initialSessionRole || 'supplier')
  const [selectedLoginRole, setSelectedLoginRole] = useState<Role | null>(null)
  const [loggedIn, setLoggedIn] = useState(Boolean(initialSessionRole) && !isLoginPage)
  const [loginSubmitting, setLoginSubmitting] = useState(false)
  const [loginMessage, setLoginMessage] = useState('')
  const [receivableStatus, setReceivableStatus] = useState<ReceivableStatus>('pending')
  const [financingStatus, setFinancingStatus] = useState<FinancingStatus>('not_requested')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('not_due')
  const [proofStatus, setProofStatus] = useState<ProofStatus>('not_started')
  const [auditProofJob, setAuditProofJob] = useState<AuditProofJob | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [quoteAdvanceRate, setQuoteAdvanceRate] = useState(String(financingQuote.advanceRate))
  const [quoteValidUntil, setQuoteValidUntil] = useState(defaultQuoteExpiry)
  const [quoteError, setQuoteError] = useState('')
  const [receivables, setReceivables] = useState<Receivable[]>([initialReceivable])
  const [activeReceivableId, setActiveReceivableId] = useState(initialReceivable.id)
  const [selectedReceivable, setSelectedReceivable] = useState<Receivable>(initialReceivable)
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisMessage, setAnalysisMessage] = useState('')
  const [authorizationStep, setAuthorizationStep] = useState<AuthorizationStep>('idle')
  const [authorizationMessage, setAuthorizationMessage] = useState('')
  const [authorizationHash, setAuthorizationHash] = useState<Hex | null>(null)
  const [authorizationSigner, setAuthorizationSigner] = useState<Address | null>(null)
  const [authorizationVerifiedAt, setAuthorizationVerifiedAt] = useState<string | null>(null)
  const [settlementMessage, setSettlementMessage] = useState('')
  const [settlementSubmitting, setSettlementSubmitting] = useState(false)
  const [settlementTransactionHash, setSettlementTransactionHash] = useState<Hex | null>(null)
  const [claimTransactionHash, setClaimTransactionHash] = useState<Hex | null>(null)
  const [chainFinancingOffer, setChainFinancingOffer] = useState<ChainFinancingOffer | null>(null)
  const [financingRequestedAt, setFinancingRequestedAt] = useState<string | null>(null)
  const [financingOfferedAt, setFinancingOfferedAt] = useState<string | null>(null)
  const [financingAcceptedAt, setFinancingAcceptedAt] = useState<string | null>(null)
  const createFormRef = useRef<HTMLFormElement>(null)
  const activeReceivable = receivables.find((receivable) => receivable.id === activeReceivableId) || receivables[0] || initialReceivable

  useEffect(() => {
    if (!loggedIn) return
    const controller = new AbortController()
    const loadReceivables = async () => {
      try {
        const response = await fetch('/api/receivables', { signal: controller.signal })
        const result = await response.json() as Receivable[] | { error?: string }
        if (!response.ok || !Array.isArray(result)) throw new Error('error' in result ? result.error || '无法加载应收凭证' : '无法加载应收凭证')
        setReceivables(result)
        setActiveReceivableId((current) => result.some((receivable) => receivable.id === current) ? current : result[0]?.id || initialReceivable.id)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setAnalysisMessage(error instanceof Error ? error.message : '无法加载应收凭证')
      }
    }
    void loadReceivables()
    return () => controller.abort()
  }, [loggedIn])

  useEffect(() => {
    if (!loggedIn) return
    const controller = new AbortController()
    const restoreAuthorization = async () => {
      setReceivableStatus(activeReceivable.status)
      setFinancingStatus('not_requested')
      setPaymentStatus('not_due')
      setProofStatus('not_started')
      setAuthorizationStep('idle')
      setAuthorizationMessage('')
      setAuthorizationHash(null)
      setAuthorizationSigner(null)
      setAuthorizationVerifiedAt(null)
      setSettlementMessage('')
      setSettlementTransactionHash(null)
      setClaimTransactionHash(null)
      setFinancingStatus(activeReceivable.financingStatus || (['assigned', 'matured', 'settled'].includes(activeReceivable.status) ? 'funded' : activeReceivable.status === 'paid' ? 'repaid' : 'not_requested'))
      setPaymentStatus(activeReceivable.status === 'matured' ? 'pending' : activeReceivable.status === 'settled' ? 'claimable' : activeReceivable.status === 'paid' ? 'paid' : 'not_due')
      try {
        const response = await fetch(`/api/payment-authorizations/status?receivableId=${encodeURIComponent(activeReceivable.id)}`, {
          signal: controller.signal,
        })
        const result = await response.json() as PaymentAuthorizationStatus
        if (!response.ok) throw new Error(result.error || '无法查询付款授权状态')
        if (result.status !== 'verified' || !result.authorizationHash || !result.signer) {
          if (activeReceivable.status === 'active') {
            setReceivableStatus('pending')
            setReceivables((items) => items.map((receivable) => receivable.id === activeReceivable.id ? { ...receivable, status: 'pending' } : receivable))
            await fetch('/api/receivables', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: activeReceivable.id, status: 'pending' }),
              signal: controller.signal,
            })
          }
          return
        }
        setAuthorizationHash(result.authorizationHash)
        setAuthorizationSigner(result.signer)
        setAuthorizationVerifiedAt(result.verifiedAt || null)
        setAuthorizationStep('verified')
        setAuthorizationMessage('付款授权已由服务端验签并保存；本次签署未锁定 USDC。')
        setReceivableStatus((status) => status === 'pending' ? 'active' : status)
        setPaymentStatus((status) => status === 'not_due' ? 'authorized' : status)
        setProofStatus((status) => status === 'not_started' ? 'queued' : status)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setAuthorizationMessage(error instanceof Error ? error.message : '无法查询付款授权状态')
      }
    }
    void restoreAuthorization()
    return () => controller.abort()
  }, [activeReceivable.financingStatus, activeReceivable.id, activeReceivable.status, loggedIn])

  useEffect(() => {
    if (!loggedIn) return
    if (!authorizationHash) {
      setAuditProofJob(null)
      setProofStatus('not_started')
      return
    }
    const controller = new AbortController()
    const startProof = async () => {
      try {
        await fetch('/api/audit-proofs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receivableId: activeReceivable.id }),
          signal: controller.signal,
        })
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setProofStatus('failed')
      }
    }
    const refreshProof = async () => {
      try {
        const response = await fetch(`/api/audit-proofs/status?receivableId=${encodeURIComponent(activeReceivable.id)}`, { signal: controller.signal })
        const result = await response.json() as AuditProofJob & { error?: string }
        if (!response.ok) throw new Error(result.error || '无法查询审计证明任务')
        setAuditProofJob(result)
        setProofStatus(result.status)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setAuditProofJob((current) => current ? { ...current, status: 'failed', error: error instanceof Error ? error.message : '无法查询审计证明任务' } : null)
          setProofStatus('failed')
        }
      }
    }
    void startProof().then(refreshProof)
    const polling = window.setInterval(() => void refreshProof(), 3_000)
    return () => {
      controller.abort()
      window.clearInterval(polling)
    }
  }, [activeReceivable.id, authorizationHash, loggedIn])

  useEffect(() => {
    if (!loggedIn) return
    if (!publicClient) return
    const controller = new AbortController()
    const restoreChainFinancing = async () => {
      try {
        const configResponse = await fetch(`/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`, { signal: controller.signal })
        const config = await configResponse.json() as FinancingConfig
        if (!configResponse.ok) throw new Error(config.error || '无法取得融资合约配置')
        const idHash = receivableHash(activeReceivable.id)
        const [request, offer, chainSettled] = await Promise.all([
          publicClient.readContract({ address: config.settlementAddress, abi: settlementAbi, functionName: 'financingRequests', args: [idHash] }),
          publicClient.readContract({ address: config.settlementAddress, abi: settlementAbi, functionName: 'financingOffers', args: [idHash] }),
          publicClient.readContract({ address: config.settlementAddress, abi: settlementAbi, functionName: 'settledReceivables', args: [idHash] }),
        ])
        if (controller.signal.aborted) return
        const requestSupplier = request[0]
        const typedOffer = offer as ChainFinancingOffer
        const hasOffer = typedOffer[0] !== ZERO_ADDRESS
        const claimableAmount = chainSettled && hasOffer
          ? await publicClient.readContract({ address: config.settlementAddress, abi: settlementAbi, functionName: 'claimable', args: [config.tokenAddress, typedOffer[0]] })
          : 0n
        const nextFinancingStatus: FinancingStatus = chainSettled && claimableAmount === 0n
          ? 'repaid'
          : hasOffer ? typedOffer[7] ? 'funded' : 'offered' : requestSupplier !== ZERO_ADDRESS ? 'quoting' : 'not_requested'
        const hasStaleDownstreamStatus = ['assigned', 'matured', 'settled', 'paid', 'defaulted'].includes(activeReceivable.status)
        const nextReceivableStatus: ReceivableStatus = chainSettled
          ? claimableAmount > 0n ? 'settled' : 'paid'
          : typedOffer[7]
            ? activeReceivable.status === 'matured' ? 'matured' : 'assigned'
            : hasStaleDownstreamStatus ? 'active' : activeReceivable.status
        setChainFinancingOffer(hasOffer ? typedOffer : null)
        setFinancingRequestedAt(null)
        setFinancingOfferedAt(null)
        setFinancingAcceptedAt(null)
        if (requestSupplier !== ZERO_ADDRESS) {
          try {
            const latestBlock = await publicClient.getBlockNumber()
            const fromBlock = latestBlock > 10_000n ? latestBlock - 10_000n : 0n
            const [requestedEvents, offeredEvents, acceptedEvents] = await Promise.all([
              publicClient.getContractEvents({ address: config.settlementAddress, abi: settlementAbi, eventName: 'FinancingRequested', args: { receivableIdHash: idHash }, fromBlock, toBlock: 'latest' }),
              publicClient.getContractEvents({ address: config.settlementAddress, abi: settlementAbi, eventName: 'FinancingOfferSubmitted', args: { receivableIdHash: idHash }, fromBlock, toBlock: 'latest' }),
              publicClient.getContractEvents({ address: config.settlementAddress, abi: settlementAbi, eventName: 'FinancingOfferAccepted', args: { receivableIdHash: idHash }, fromBlock, toBlock: 'latest' }),
            ])
            const [requestedBlock, offeredBlock, acceptedBlock] = await Promise.all([
              requestedEvents.at(-1)?.blockNumber ? publicClient.getBlock({ blockNumber: requestedEvents.at(-1)!.blockNumber! }) : null,
              offeredEvents.at(-1)?.blockNumber ? publicClient.getBlock({ blockNumber: offeredEvents.at(-1)!.blockNumber! }) : null,
              acceptedEvents.at(-1)?.blockNumber ? publicClient.getBlock({ blockNumber: acceptedEvents.at(-1)!.blockNumber! }) : null,
            ])
            if (requestedBlock) setFinancingRequestedAt(new Date(Number(requestedBlock.timestamp) * 1000).toISOString())
            if (offeredBlock) setFinancingOfferedAt(new Date(Number(offeredBlock.timestamp) * 1000).toISOString())
            if (acceptedBlock) setFinancingAcceptedAt(new Date(Number(acceptedBlock.timestamp) * 1000).toISOString())
          } catch {
            setFinancingRequestedAt(null)
            setFinancingOfferedAt(null)
            setFinancingAcceptedAt(null)
          }
        }
        if (chainSettled) {
          setPaymentStatus(claimableAmount > 0n ? 'claimable' : 'paid')
          setSettlementMessage(claimableAmount > 0n
            ? `链上结算已完成，资金方可领取 ${formatUnits(claimableAmount, 6)} mUSDC。`
            : '链上结算已完成，资金方已领取结算资金。')
        } else if (typedOffer[7]) {
          const sameWallet = isAddressEqual(typedOffer[0], typedOffer[1])
          setSettlementMessage(sameWallet
            ? `链上报价已接受，但供应商与资金方使用了同一钱包；${formatUnits(typedOffer[3], 6)} mUSDC 已转回原地址，余额不会发生净变化。`
            : `链上报价已接受，${formatUnits(typedOffer[3], 6)} mUSDC 已由合约放款至供应商钱包。`)
        }
        setFinancingStatus(nextFinancingStatus)
        setReceivableStatus(nextReceivableStatus)
        setReceivables((items) => items.map((item) => item.id === activeReceivable.id ? { ...item, status: nextReceivableStatus, financingStatus: nextFinancingStatus } : item))
        if (activeReceivable.financingStatus !== nextFinancingStatus || activeReceivable.status !== nextReceivableStatus) {
          await fetch('/api/receivables', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: activeReceivable.id, status: nextReceivableStatus, financingStatus: nextFinancingStatus }),
            signal: controller.signal,
          })
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setSettlementMessage(error instanceof Error ? `无法读取链上融资状态：${error.message}` : '无法读取链上融资状态')
      }
    }
    void restoreChainFinancing()
    return () => controller.abort()
  }, [activeReceivable.financingStatus, activeReceivable.id, activeReceivable.status, loggedIn, publicClient])

  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const selectReceivable = (receivable: Receivable, status = receivable.status) => {
    setActiveReceivableId(receivable.id)
    setSelectedReceivable({ ...receivable, status })
  }

  const persistReceivableWorkflow = async (id: string, updates: Partial<Pick<Receivable, 'status' | 'financingStatus'>>) => {
    const response = await fetch('/api/receivables', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    const result = await response.json() as Receivable | { error?: string }
    if (!response.ok || !('id' in result)) throw new Error('error' in result ? result.error || '无法保存凭证状态' : '无法保存凭证状态')
    setReceivables((items) => items.map((receivable) => receivable.id === id ? result : receivable))
    return result
  }

  const startFinancingInquiry = async (receivable: Receivable) => {
    selectReceivable(receivable, 'active')
    setSettlementSubmitting(true)
    setSettlementMessage(`请在供应商钱包中发布 ${receivable.id} 的链上融资询价…`)
    try {
      let address = connection.address
      let chainId = connection.chainId
      if (!address) {
        const connected = await connectWallet()
        address = connected.address
        chainId = connected.chainId
      }
      if (!address) throw new Error('钱包未返回供应商地址')
      if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID) await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID })
      const configResponse = await fetch(`/api/payment-authorizations/config?receivableId=${encodeURIComponent(receivable.id)}`)
      const config = await configResponse.json() as FinancingConfig
      if (!configResponse.ok) throw new Error(config.error || '无法取得融资合约配置')
      const transactionHash = await writeContractAsync({
        address: config.settlementAddress,
        abi: settlementAbi,
        functionName: 'requestFinancing',
        args: [receivableHash(receivable.id), config.tokenAddress, parseUnits(receivable.amount.toString(), 6)],
        account: address,
        chainId: CREDITCOIN_TESTNET_CHAIN_ID,
      })
      if (!publicClient) throw new Error('Creditcoin RPC 客户端不可用')
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
      if (receipt.status !== 'success') throw new Error('链上融资询价交易执行失败')
      await persistReceivableWorkflow(receivable.id, { financingStatus: 'quoting' })
      setFinancingStatus('quoting')
      setSettlementMessage(`${receivable.id} 的融资询价已登记上链，等待资金方提交报价。`)
    } catch (error) {
      setSettlementMessage(`发起询价失败：${getWalletErrorMessage(error, '钱包交易失败')}`)
    } finally {
      setSettlementSubmitting(false)
    }
  }

  const persistReceivableStatus = async (status: ReceivableStatus) => {
    setReceivableStatus(status)
    setReceivables((items) => items.map((receivable) => receivable.id === activeReceivable.id ? { ...receivable, status } : receivable))
    await persistReceivableWorkflow(activeReceivable.id, { status })
  }

  const advance = async () => {
    if (role === 'supplier' && receivableStatus === 'active' && financingStatus === 'not_requested') return startFinancingInquiry(activeReceivable)
    if (role === 'supplier' && financingStatus === 'offered') {
      setSettlementSubmitting(true)
      setSettlementMessage('请在供应商钱包中确认接受链上报价…')
      try {
        let address = connection.address
        let chainId = connection.chainId
        if (!address) {
          const connected = await connectWallet()
          address = connected.address
          chainId = connected.chainId
        }
        if (!address) throw new Error('钱包未返回供应商地址')
        if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID) await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID })
        const configResponse = await fetch(`/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`)
        const config = await configResponse.json() as FinancingConfig
        if (!configResponse.ok) throw new Error(config.error || '无法取得融资合约配置')
        const transactionHash = await writeContractAsync({ address: config.settlementAddress, abi: settlementAbi, functionName: 'acceptOffer', args: [receivableHash(activeReceivable.id)], account: address, chainId: CREDITCOIN_TESTNET_CHAIN_ID })
        if (!publicClient) throw new Error('Creditcoin RPC 客户端不可用')
        const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
        if (receipt.status !== 'success') throw new Error('接受报价交易执行失败')
        const acceptedBlock = await publicClient.getBlock({ blockNumber: receipt.blockNumber })
        setFinancingAcceptedAt(new Date(Number(acceptedBlock.timestamp) * 1000).toISOString())
        setFinancingStatus('funded')
        setReceivableStatus('assigned')
        await persistReceivableWorkflow(activeReceivable.id, { status: 'assigned', financingStatus: 'funded' })
        setSettlementMessage('报价已由供应商钱包确认，融资本金已由合约放款。')
      } catch (error) {
        setSettlementMessage(`接受报价失败：${getWalletErrorMessage(error, '钱包交易失败')}`)
      } finally {
        setSettlementSubmitting(false)
      }
      return
    }
    if (role === 'operator' && financingStatus === 'funded' && receivableStatus === 'assigned') {
      setSettlementMessage('应收凭证已进入到期日，可以执行已保存的付款授权。')
      setPaymentStatus('pending')
      return persistReceivableStatus('matured')
    }
    if (role === 'funder' && receivableStatus === 'matured' && (paymentStatus === 'pending' || paymentStatus === 'failed')) {
      setSettlementSubmitting(true)
      setPaymentStatus('pending')
      setSettlementMessage('受限 Relayer 正在向 Creditcoin CC3 提交付款授权…')
      try {
        const response = await fetch('/api/settlements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receivableId: activeReceivable.id }),
        })
        const result = await response.json() as SettlementResult
        if (!response.ok || (!result.transactionHash && !result.alreadySettled) || !result.claimableAmount) throw new Error(result.error || '链上兑付失败')
        setSettlementTransactionHash(result.transactionHash || null)
        setPaymentStatus('claimable')
        setReceivableStatus('settled')
        setReceivables((items) => items.map((receivable) => receivable.id === activeReceivable.id ? { ...receivable, status: 'settled' } : receivable))
        setSettlementMessage(`${result.alreadySettled ? '链上结算状态已恢复' : 'Relayer 结算成功'}，资金方可领取 ${formatUnits(BigInt(result.claimableAmount), 6)} mUSDC。`)
      } catch (error) {
        setPaymentStatus('failed')
        setSettlementMessage(error instanceof Error ? `链上兑付失败：${error.message}` : '链上兑付失败')
      } finally {
        setSettlementSubmitting(false)
      }
      return
    }
    if (role === 'funder' && receivableStatus === 'settled' && paymentStatus === 'claimable') {
      setSettlementSubmitting(true)
      setPaymentStatus('claiming')
      setSettlementMessage('请在资金方钱包中确认领取交易…')
      try {
        let address = connection.address
        let chainId = connection.chainId
        if (!address) {
          const connected = await connectWallet()
          address = connected.address
          chainId = connected.chainId
        }
        if (!address) throw new Error('钱包未返回资金方地址')
        if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID) await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID })

        const configResponse = await fetch(`/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`)
        const configResult = await configResponse.json() as FinancingConfig
        if (!configResponse.ok) throw new Error(configResult.error || '无法取得结算合约配置')
        const offer = await publicClient?.readContract({ address: configResult.settlementAddress, abi: settlementAbi, functionName: 'financingOffers', args: [receivableHash(activeReceivable.id)] })
        if (!offer) throw new Error('无法读取 Creditcoin 链上融资状态')
        if (offer[0] === ZERO_ADDRESS || !offer[7]) throw new Error('当前部署合约中没有该应收的已成交报价，请刷新页面后重新完成融资流程')
        if (!isAddressEqual(address, offer[0])) throw new Error('当前钱包不是该应收凭证的链上资金方')
        const transactionHash = await writeContractAsync({
          address: configResult.settlementAddress,
          abi: settlementAbi,
          functionName: 'claim',
          args: [configResult.tokenAddress],
          account: address,
          chainId: CREDITCOIN_TESTNET_CHAIN_ID,
        })
        setClaimTransactionHash(transactionHash)
        if (!publicClient) throw new Error('Creditcoin RPC 客户端不可用')
        const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
        if (receipt.status !== 'success') throw new Error('资金领取交易执行失败')
        setPaymentStatus('paid')
        setFinancingStatus('repaid')
        await persistReceivableStatus('paid')
        setSettlementMessage('资金方已通过钱包领取结算资金。')
      } catch (error) {
        setPaymentStatus('claimable')
        setSettlementMessage(`资金领取失败：${getWalletErrorMessage(error, '钱包交易失败')}`)
      } finally {
        setSettlementSubmitting(false)
      }
      return
    }
    if (receivableStatus === 'paid' || receivableStatus === 'defaulted') {
      setSelectedReceivable({ ...activeReceivable, status: receivableStatus })
      setDetailOpen(true)
    }
  }

  const openQuoteEditor = () => {
    setQuoteAdvanceRate(String(financingQuote.advanceRate))
    setQuoteValidUntil(defaultQuoteExpiry())
    setQuoteError('')
    setQuoteOpen(true)
  }

  const submitFinancingQuote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const advanceRate = Number(quoteAdvanceRate)
    const advanceAmount = activeReceivable.amount * advanceRate / 100
    const annualizedYield = calculateAnnualizedYield(activeReceivable.amount, advanceAmount, activeReceivable.dueDate)
    const validUntilTimestamp = Math.floor(new Date(quoteValidUntil).getTime() / 1000)
    if (!Number.isFinite(advanceRate) || advanceRate <= 0 || advanceRate > 100) {
      setQuoteError('融资比例必须大于 0% 且不超过 100%')
      return
    }
    if (annualizedYield === null || !Number.isFinite(annualizedYield)) {
      setQuoteError('应收到期日必须晚于当前时间')
      return
    }
    if (!Number.isFinite(validUntilTimestamp) || validUntilTimestamp <= Math.floor(Date.now() / 1000)) {
      setQuoteError('报价有效期必须晚于当前时间')
      return
    }
    setQuoteError('')
    setSettlementSubmitting(true)
    setSettlementMessage('请在资金方钱包中授权锁定融资本金…')
    try {
      let address = connection.address
      let chainId = connection.chainId
      if (!address) {
        const connected = await connectWallet()
        address = connected.address
        chainId = connected.chainId
      }
      if (!address) throw new Error('钱包未返回资金方地址')
      if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID) await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID })
      const configResponse = await fetch(`/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`)
      const config = await configResponse.json() as FinancingConfig
      if (!configResponse.ok) throw new Error(config.error || '无法取得融资合约配置')
      const request = await publicClient?.readContract({ address: config.settlementAddress, abi: settlementAbi, functionName: 'financingRequests', args: [receivableHash(activeReceivable.id)] })
      if (!request) throw new Error('Creditcoin RPC 客户端不可用')
      const principal = parseUnits(advanceAmount.toFixed(6), 6)
      const balance = await publicClient?.readContract({ address: config.tokenAddress, abi: tokenAbi, functionName: 'balanceOf', args: [address] })
      if (balance === undefined) throw new Error('Creditcoin RPC 客户端不可用')
      if (balance < principal) throw new Error(`资金方 mUSDC 余额不足：需要 ${advanceAmount.toLocaleString()}，当前 ${formatUnits(balance, 6)}`)
      const approvalHash = await writeContractAsync({ address: config.tokenAddress, abi: tokenAbi, functionName: 'approve', args: [config.settlementAddress, principal], account: address, chainId: CREDITCOIN_TESTNET_CHAIN_ID })
      if (!publicClient) throw new Error('Creditcoin RPC 客户端不可用')
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash })
      if (approvalReceipt.status !== 'success') throw new Error('融资本金授权失败')
      setSettlementMessage('授权成功，请确认提交链上报价并锁定融资本金…')
      const validUntil = BigInt(validUntilTimestamp)
      const transactionHash = await writeContractAsync({ address: config.settlementAddress, abi: settlementAbi, functionName: 'submitOffer', args: [receivableHash(activeReceivable.id), principal, BigInt(Math.round(annualizedYield * 100)), validUntil], account: address, chainId: CREDITCOIN_TESTNET_CHAIN_ID })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
      if (receipt.status !== 'success') throw new Error('链上报价交易执行失败')
      await persistReceivableWorkflow(activeReceivable.id, { financingStatus: 'offered' })
      setFinancingStatus('offered')
      const offer = await publicClient.readContract({ address: config.settlementAddress, abi: settlementAbi, functionName: 'financingOffers', args: [receivableHash(activeReceivable.id)] })
      setChainFinancingOffer(offer as ChainFinancingOffer)
      setQuoteOpen(false)
      setSettlementMessage(`${activeReceivable.id} 的报价已上链，${advanceAmount.toLocaleString()} mUSDC 已锁定。`)
    } catch (error) {
      const message = `提交报价失败：${getWalletErrorMessage(error, '钱包交易失败')}`
      setQuoteError(message)
      setSettlementMessage(message)
    } finally {
      setSettlementSubmitting(false)
    }
  }

  const actionLabel = receivableStatus === 'matured' ? settlementSubmitting ? 'Relayer 提交中' : paymentStatus === 'failed' ? '重试 Relayer 结算' : '执行 Relayer 结算' : receivableStatus === 'settled' ? settlementSubmitting ? '等待钱包确认' : `领取 ${activeReceivable.amount.toLocaleString()} mUSDC` : financingStatus === 'not_requested' ? '发起融资询价' : financingStatus === 'offered' ? '接受无追索报价' : receivableStatus === 'assigned' ? '进入演示到期日' : '查看结算凭证'
  const contextualActionLabel = `${actionLabel} · ${activeReceivable.id}`
  const canShowAction = (role === 'supplier' && receivableStatus === 'active' && financingStatus === 'not_requested')
    || (role === 'supplier' && financingStatus === 'offered')
    || (role === 'operator' && receivableStatus === 'assigned' && financingStatus === 'funded')
    || (role === 'funder' && receivableStatus === 'matured' && ['pending', 'failed'].includes(paymentStatus))
    || (role === 'funder' && receivableStatus === 'settled' && ['claimable', 'claiming'].includes(paymentStatus))
    || ['paid', 'defaulted'].includes(receivableStatus)
  const proofLevel = proofStatus === 'recorded' ? 4 : proofStatus === 'submitting' ? 2 : proofStatus === 'building' ? 1 : 0
  const totalReceivables = receivables.reduce((total, receivable) => total + receivable.amount, 0)
  const quoteAdvanceAmount = activeReceivable.amount * (Number(quoteAdvanceRate) || 0) / 100
  const quoteFinancingCost = activeReceivable.amount - quoteAdvanceAmount
  const quoteAnnualizedYield = calculateAnnualizedYield(activeReceivable.amount, quoteAdvanceAmount, activeReceivable.dueDate)
  const quoteRemainingDays = Math.max(0, Math.ceil((new Date(`${activeReceivable.dueDate}T00:00:00Z`).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
  const defaultAdvanceAmount = activeReceivable.amount * financingQuote.advanceRate / 100
  const displayedFinancingQuote = chainFinancingOffer ? {
    funder: `${chainFinancingOffer[0].slice(0, 8)}…${chainFinancingOffer[0].slice(-6)}`,
    advanceAmount: Number(formatUnits(chainFinancingOffer[3], 6)),
    advanceRate: Number(chainFinancingOffer[4]) === 0 ? 0 : Number(((chainFinancingOffer[3] * 10_000n) / chainFinancingOffer[4])) / 100,
    financingCost: Number(formatUnits(chainFinancingOffer[4] - chainFinancingOffer[3], 6)),
    annualizedYield: Number(chainFinancingOffer[5]) / 100,
    expiresAt: new Date(Number(chainFinancingOffer[6]) * 1000).toLocaleString('zh-CN'),
  } : {
    ...financingQuote,
    advanceAmount: defaultAdvanceAmount,
    financingCost: activeReceivable.amount - defaultAdvanceAmount,
  }
  const hasCompletedFinancing = ['assigned', 'matured', 'settled', 'paid', 'defaulted'].includes(receivableStatus)
  const hasFinancingRequest = financingStatus !== 'not_requested' || hasCompletedFinancing
  const hasFinancingOffer = ['offered', 'funded', 'repaid', 'in_default'].includes(financingStatus) || hasCompletedFinancing
  const hasAcceptedFinancing = ['funded', 'repaid', 'in_default'].includes(financingStatus) || hasCompletedFinancing
  const roleWorkflowMessage = role === 'funder' && receivableStatus === 'active' && financingStatus === 'not_requested'
    ? `等待供应商针对 ${activeReceivable.id} 发起融资询价。`
    : role === 'supplier' && financingStatus === 'quoting'
      ? `${activeReceivable.id} 的询价已发布，等待资金方提交报价。`
      : ''

  const connectWallet = async () => {
    const connector = connectors[0]
    if (!connector) throw new Error('未检测到浏览器 EVM 钱包，请先安装钱包扩展')
    const result = await connectAsync({ connector })
    return { address: result.accounts[0], chainId: result.chainId }
  }

  const login = async () => {
    if (!selectedLoginRole) return
    setLoginMessage('')
    if (connection.address) {
      sessionStorage.setItem(sessionRoleKey, selectedLoginRole)
      window.location.assign('/')
      return
    }
    if (!openConnectModal) {
      setLoginMessage('钱包连接模态框尚未就绪')
      return
    }
    setLoginSubmitting(true)
    openConnectModal()
  }

  useEffect(() => {
    if (!loginSubmitting || !selectedLoginRole || !connection.address) return
    sessionStorage.setItem(sessionRoleKey, selectedLoginRole)
    setLoginSubmitting(false)
    window.location.assign('/')
  }, [connection.address, loginSubmitting, selectedLoginRole])

  useEffect(() => {
    if (!isLoginPage && !initialSessionRole) window.location.replace('/login')
  }, [initialSessionRole, isLoginPage])

  useEffect(() => {
    if (loggedIn) sessionStorage.setItem(sessionRoleKey, role)
  }, [loggedIn, role])

  const logout = () => {
    sessionStorage.removeItem(sessionRoleKey)
    disconnect()
    setLoggedIn(false)
    setSelectedLoginRole(null)
    setLoginSubmitting(false)
    setLoginMessage('')
    window.location.assign('/login')
  }

  const confirmPayable = async () => {
    setAuthorizationMessage('')
    try {
      let address = connection.address
      let chainId = connection.chainId
      if (!address) {
        setAuthorizationStep('connecting')
        const connected = await connectWallet()
        address = connected.address
        chainId = connected.chainId
      }
      if (!address) throw new Error('钱包未返回签署地址')
      if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID) {
        setAuthorizationStep('switching')
        await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID })
      }

      const configResponse = await fetch(`/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`)
      const configResult = await configResponse.json() as PaymentAuthorizationConfig & { error?: string }
      if (!configResponse.ok) throw new Error(configResult.error || '无法取得付款授权配置')
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)))
      const typedData = buildPaymentAuthorizationTypedData(configResult, address as Address, nonce)

      setAuthorizationStep('signing')
      setAuthorizationMessage(configResult.demoMode ? '请在钱包中签署 Demo EIP-3009 授权；签名不会锁定或转移资金。' : '请在钱包中签署 EIP-3009 付款授权。')
      const signature = await signTypedDataAsync(typedData)

      setAuthorizationStep('verifying')
      setAuthorizationMessage('签名完成，正在由服务端独立验签并保存…')
      const response = await fetch('/api/payment-authorizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivableId: activeReceivable.id,
          message: serializePaymentAuthorizationMessage(typedData.message),
          signature,
        }),
      })
      const result = await response.json() as { authorizationHash?: Hex; verifiedAt?: string; message?: { from?: Address }; error?: string }
      if (!response.ok || !result.authorizationHash) throw new Error(result.error || '服务端未能保存付款授权')

      setAuthorizationHash(result.authorizationHash)
      setAuthorizationSigner(result.message?.from || address as Address)
      setAuthorizationVerifiedAt(result.verifiedAt || new Date().toISOString())
      setAuthorizationStep('verified')
      setAuthorizationMessage('付款授权已验签并保存；本次签署未锁定 USDC。')
      setReceivableStatus('active')
      setReceivables((items) => items.map((receivable) => receivable.id === activeReceivable.id ? { ...receivable, status: 'active' } : receivable))
      await fetch('/api/receivables', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeReceivable.id, status: 'active' }),
      })
      setPaymentStatus('authorized')
      setProofStatus('queued')
      setRole('supplier')
    } catch (error) {
      setAuthorizationStep('idle')
      setAuthorizationMessage(getWalletErrorMessage(error, '付款授权失败'))
    }
  }

  const selectDocument = (kind: 'contract' | 'invoice') => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    if (kind === 'contract') setContractFile(file)
    else setInvoiceFile(file)
    setAnalysisMessage('')
  }

  const analyzeDocuments = async () => {
    if (!contractFile || !invoiceFile) {
      setAnalysisMessage('请先同时上传合同和发票文件')
      return
    }
    setAnalyzing(true)
    setAnalysisMessage('')
    try {
      const response = await fetch('/api/analyze-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractText: await readDocumentText(contractFile), invoiceText: await readDocumentText(invoiceFile) }),
      })
      const result = await response.json() as Record<string, string | number>
      if (!response.ok) throw new Error(String(result.error || '文档识别失败'))
      const form = createFormRef.current
      if (!form) return
      for (const field of ['buyer', 'supplier', 'contractNumber', 'invoice', 'amount', 'dueDate']) {
        const input = form.elements.namedItem(field)
        if (input instanceof HTMLInputElement && result[field] !== undefined) input.value = String(result[field])
      }
      setAnalysisMessage('识别完成，请核对自动回填的信息')
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : '文档识别失败')
    } finally {
      setAnalyzing(false)
    }
  }

  const createReceivable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const payload = {
      buyer: String(data.get('buyer')),
      supplier: String(data.get('supplier')),
      invoice: String(data.get('invoice')),
      contractNumber: String(data.get('contractNumber')),
      amount: Number(data.get('amount')),
      dueDate: String(data.get('dueDate')),
    }
    try {
      const response = await fetch('/api/receivables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json() as Receivable & { error?: string }
      if (!response.ok) throw new Error(result.error || '无法保存应收凭证')
      setReceivables((items) => [...items, result])
      setContractFile(null)
      setInvoiceFile(null)
      setAnalysisMessage('')
      setCreateOpen(false)
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : '无法保存应收凭证')
    }
  }

  const actionPanel = <div className="next-action"><span><Gauge size={18} /></span><div><strong>{activeReceivable.id} · {receivableStatusNames[receivableStatus]}</strong><p className={paymentStatus === 'failed' || (authorizationMessage && authorizationStep === 'idle') ? 'authorization-error' : ''}>{settlementMessage || roleWorkflowMessage || authorizationMessage || (receivableStatus === 'pending' ? `等待买方确认 ${activeReceivable.amount.toLocaleString()} mUSDC 应付款，并签署到期付款授权。` : receivableStatus === 'active' ? '应付款已确权，可发起无追索融资。' : receivableStatus === 'settled' ? `链上结算已完成，${activeReceivable.amount.toLocaleString()} mUSDC 已记入资金方可领取余额。请使用该应收对应的资金方钱包领取。` : '继续当前流程，查看权属和结算状态变化。')}</p></div>{role === 'buyer' && receivableStatus === 'pending' ? <button className="primary" disabled={authorizationStep !== 'idle'} onClick={() => void confirmPayable()}>{authorizationStep !== 'idle' ? <LoaderCircle className="spin" size={14} /> : null}{authorizationStep === 'connecting' ? '连接钱包中' : authorizationStep === 'switching' ? '切换 CC3 中' : authorizationStep === 'signing' ? '等待钱包签名' : authorizationStep === 'verifying' ? '服务端验签中' : `确认应付 · ${activeReceivable.id}`}</button> : role === 'funder' && financingStatus === 'quoting' ? <button className="primary" disabled={settlementSubmitting} onClick={openQuoteEditor}>填写并提交报价 · {activeReceivable.id}</button> : canShowAction ? <button className="secondary" disabled={settlementSubmitting} onClick={() => void advance()}>{settlementSubmitting && <LoaderCircle className="spin" size={14} />}{contextualActionLabel}</button> : null}</div>

  if (isLoginPage) {
    return <main className="login-page">
      <section className="login-shell" aria-labelledby="login-title">
        <header className="login-brand"><span><ShieldCheck size={20} /></span><strong>Attest<em>Flow</em></strong><small>CREDITCOIN CC3</small></header>
        <div className="login-heading"><small>SECURE WORKSPACE</small><h1 id="login-title">选择登录身份</h1><p>身份决定工作台权限。选择角色后连接对应的钱包账户。</p></div>
        <div className="role-grid">
          {loginRoles.map((item, index) => <button className={selectedLoginRole === item ? 'selected' : ''} key={item} onClick={() => { setSelectedLoginRole(item); setLoginMessage('') }}>
            <span>{index + 1}</span><div><strong>{roleNames[item]}</strong><small>{roleDescriptions[item]}</small></div>{selectedLoginRole === item && <Check size={16} />}
          </button>)}
        </div>
        <button className="wallet-login" disabled={!selectedLoginRole} onClick={() => void login()}>{loginSubmitting ? <LoaderCircle className="spin" size={17} /> : <WalletCards size={17} />}{loginSubmitting ? '在钱包模态框中连接' : selectedLoginRole ? `使用钱包登录${roleNames[selectedLoginRole]}` : '请先选择角色'}</button>
        {loginMessage && <p className="login-error">{loginMessage}</p>}
        <footer><i />Creditcoin Testnet <span>钱包地址仅用于身份识别与链上签名</span></footer>
      </section>
    </main>
  }

  if (!loggedIn) return null

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span><ShieldCheck size={18} /></span><strong>Attest<em>Flow</em></strong></div>
        <nav>
          <small>业务</small>
          <button className="active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><LayoutDashboard size={17} />工作台</button>
          <button onClick={() => goTo('receivable')}><FileCheck2 size={17} />应收凭证<b>1</b></button>
          <button onClick={() => goTo('settlement')}><WalletCards size={17} />结算中心</button>
          <button onClick={() => goTo('activity')}><History size={17} />审计记录</button>
          <small>管理</small>
          <button><Building2 size={17} />企业与成员</button>
          <button><Settings size={17} />业务设置</button>
        </nav>
        <div className="mock-note"><div><Sparkles size={15} /><strong>CC3 信用融资演示</strong></div><p>确权不锁款 · 无追索融资 · 到期 USDC 结算</p><button onClick={() => { setReceivableStatus(authorizationHash ? 'active' : 'pending'); setFinancingStatus('not_requested'); setPaymentStatus(authorizationHash ? 'authorized' : 'not_due'); setProofStatus(authorizationHash ? 'queued' : 'not_started'); setAuthorizationStep(authorizationHash ? 'verified' : 'idle'); setAuthorizationMessage(authorizationHash ? '付款授权已由服务端验签并保存；本次签署未锁定 USDC。' : ''); setSettlementMessage(''); setSettlementTransactionHash(null); setClaimTransactionHash(null); setRole('supplier'); setSelectedReceivable(activeReceivable) }}><RefreshCcw size={14} />重置演示</button></div>
        <div className="side-user"><span>{roleNames[role][0]}</span><div><strong>{roleNames[role]}账户</strong><small>{connection.address ? `${connection.address.slice(0, 6)}…${connection.address.slice(-4)}` : '钱包会话'}</small></div><button title="退出并切换角色" onClick={logout}><LogOut size={16} /></button></div>
      </aside>

      <main>
        <header>
          <label><Search size={16} /><input placeholder="搜索凭证、发票或企业" /><kbd>⌘ K</kbd></label>
          <div className="header-actions"><span className="network"><i />CREDITCOIN CC3</span><span className="role-identity">{roleNames[role]}</span><button className="wallet-chip" onClick={logout} title="退出登录"><WalletCards size={14} />{connection.address ? `${connection.address.slice(0, 6)}…${connection.address.slice(-4)}` : '钱包会话'}<LogOut size={13} /></button><button className="icon"><Bell size={17} /></button></div>
        </header>

        <div className="content">
          <section className="page-title"><div><small>信用应收融资协议 · RWA</small><h1>{roleNames[role]}工作台</h1><p>买方确认债务但无需提前锁款，资金方基于授信提供无追索融资。</p></div></section>

          <section className="metrics">
            <article><span className="mint"><FileText size={18} /></span><div><small>应收账款余额</small><strong>${totalReceivables.toLocaleString()}</strong><p>{receivables.length} 笔有效凭证</p></div></article>
            <article><span className="blue"><CircleDollarSign size={18} /></span><div><small>已获融资</small><strong>{['funded', 'repaid', 'in_default'].includes(financingStatus) ? '$96,840' : '$0'}</strong><p>无追索 · 资金方承担信用风险</p></div></article>
            <article><span className="amber"><Clock3 size={18} /></span><div><small>待办事项</small><strong>{receivableStatus === 'paid' ? '0' : '1'}</strong><p>{receivableStatusNames[receivableStatus]}</p></div></article>
            <article><span className="green"><ShieldCheck size={18} /></span><div><small>可用授信</small><strong>$500,000</strong><p>占用 $100,000 · 非资金余额</p></div></article>
          </section>

          <section className="workspace">
            <article className="panel receivable" id="receivable"><div className="panel-head"><div><h2>核心应收凭证</h2><p>当前演示业务的完整生命周期</p></div><button onClick={() => setCreateOpen(true)}><Plus size={14} />新增凭证</button></div>
              {receivables.map((receivable) => {
                const currentStatus = receivable.id === activeReceivable.id ? receivableStatus : receivable.status
                const isCurrent = receivable.id === activeReceivable.id
                return <div className={`receivable-row ${isCurrent ? 'selected' : ''}`} key={receivable.id}>
                  <button className="receivable-select" onClick={() => selectReceivable(receivable, currentStatus)} aria-label={`选择凭证 ${receivable.id}`}><span className="company">{receivable.buyer.slice(0, 2)}</span><div><strong>{receivable.buyer}{isCurrent && <em>当前</em>}</strong><small>{receivable.id} · {receivable.invoice}</small></div><div className="amount"><strong>${receivable.amount.toLocaleString()}</strong><small>{receivable.dueDate} 到期</small></div><span className={`status ${currentStatus}`}>{receivableStatusNames[currentStatus]}</span></button>
                </div>
              })}
            </article>

            <article className="panel activity" id="activity"><div className="panel-head"><div><h2>最新动态</h2><p>全流程可审计事件</p></div><MoreHorizontal size={17} /></div>
              {hasFinancingOffer && <div className="financing-quote"><div><small>报价方</small><strong>{displayedFinancingQuote.funder}</strong></div><div><small>放款金额</small><strong>${displayedFinancingQuote.advanceAmount.toLocaleString()}</strong></div><div><small>融资比例</small><strong>{displayedFinancingQuote.advanceRate}%</strong></div><div><small>融资成本</small><strong>${displayedFinancingQuote.financingCost.toLocaleString()}</strong></div><div><small>年化收益率</small><strong>{displayedFinancingQuote.annualizedYield}%</strong></div><div><small>追索方式</small><strong>无追索</strong></div><p>报价有效至 {displayedFinancingQuote.expiresAt}，到期按应收账款面值 ${activeReceivable.amount.toLocaleString()} 结算。</p></div>}
              <div className="events"><div><i className="green" /><span><strong>贸易资料校验通过</strong><p>三单匹配完成，未发现重复融资</p><small>今天 09:43</small></span></div><div><i className="blue" /><span><div className="event-title"><strong>确权申请已提交</strong>{authorizationStep === 'verified' && authorizationHash && <em><Check size={10} />付款授权已验证并保存</em>}</div><p>华辰精密提交发票与验收记录</p>{authorizationStep === 'verified' && authorizationHash && <code className="event-authorization" title={authorizationHash}>{authorizationSigner ? `${authorizationSigner.slice(0, 8)}…${authorizationSigner.slice(-6)}` : '签署钱包已验证'} · {authorizationVerifiedAt ? new Date(authorizationVerifiedAt).toLocaleString('zh-CN') : '时间待确认'} · {authorizationHash.slice(0, 10)}…{authorizationHash.slice(-8)}</code>}<small>今天 09:42</small></span></div>{hasFinancingRequest && <div><i className="blue" /><span><strong>供应商已申请融资</strong><p>供应商已将 {activeReceivable.amount.toLocaleString()} mUSDC 应收账款发布至链上，等待资金方报价</p><small>{financingRequestedAt ? new Date(financingRequestedAt).toLocaleString('zh-CN') : '链上记录已确认'}</small></span></div>}{hasFinancingOffer && <div><i className="blue" /><span><strong>资金方已提交报价</strong><p>{displayedFinancingQuote.funder} 报价 {displayedFinancingQuote.advanceAmount.toLocaleString()} mUSDC，年化收益率 {displayedFinancingQuote.annualizedYield}%</p><small>{financingOfferedAt ? new Date(financingOfferedAt).toLocaleString('zh-CN') : '链上记录已确认'}</small></span></div>}{hasAcceptedFinancing && <div><i className="green" /><span><strong>供应商已接受报价</strong><p>供应商接受链上报价，{displayedFinancingQuote.advanceAmount.toLocaleString()} mUSDC 已放款，债权转让完成</p><small>{financingAcceptedAt ? new Date(financingAcceptedAt).toLocaleString('zh-CN') : '链上记录已确认'}</small></span></div>}<div><i className={['settled', 'paid'].includes(receivableStatus) ? 'green' : 'blue'} /><span><strong>到期兑付</strong><p>{receivableStatus === 'paid' ? '结算资金已由资金方领取' : receivableStatus === 'settled' ? '链上结算完成，等待资金方领取' : receivableStatus === 'matured' ? '凭证已到期，可以执行链上结算' : `计划于 ${activeReceivable.dueDate} 到期结算`}</p><small>{receivableStatus === 'paid' ? '已完成' : receivableStatus === 'settled' ? '待领取' : receivableStatus === 'matured' ? '可执行' : '待到期'}</small></span></div></div>
              <div className="activity-workflow">{actionPanel}</div>
            </article>
          </section>

          <section className="panel proof-panel" id="proof">
            <div className="panel-head"><div><h2>CC3 Audit Proof</h2><p>基于真实源交易生成证据承诺，并异步登记至 Creditcoin CC3</p></div><span className={`proof-badge ${proofStatus === 'recorded' ? 'verified' : ''}`}><i />{proofStatus === 'not_started' ? '等待买方确权' : proofStatus === 'waiting_source' || proofStatus === 'queued' ? '等待链上源交易' : proofStatus === 'building' ? '构建证据中' : proofStatus === 'submitting' ? '链上登记中' : proofStatus === 'recorded' ? '审计证明已记录' : '证明任务失败'}</span></div>
            <div className="proof-flow">
              {[
                ['1', 'Source transaction', 'Creditcoin CC3', auditProofJob?.sourceTransactionHash ? `${auditProofJob.sourceTransactionHash.slice(0, 10)}…${auditProofJob.sourceTransactionHash.slice(-8)}` : 'Waiting for financing request'],
                ['2', 'Evidence commitment', 'Evidence Builder', auditProofJob?.evidenceHash ? `${auditProofJob.evidenceHash.slice(0, 10)}…${auditProofJob.evidenceHash.slice(-8)}` : 'Pending'],
                ['3', 'CC3 registry', 'AuditProofRegistry', auditProofJob?.registrationTransactionHash ? `${auditProofJob.registrationTransactionHash.slice(0, 10)}…${auditProofJob.registrationTransactionHash.slice(-8)}` : 'Pending'],
                ['4', 'Audit proof recorded', 'Verified Receivable', auditProofJob?.registeredAt ? new Date(auditProofJob.registeredAt).toLocaleString('zh-CN') : activeReceivable.id],
              ].map(([number, title, system, evidence], index) => {
                const complete = proofLevel > index
                const current = proofStatus !== 'not_started' && proofStatus !== 'failed' && proofLevel === index
                return <div className={`proof-step ${complete ? 'complete' : ''} ${current ? 'current' : ''}`} key={title}><span>{complete ? <Check size={14} /> : number}</span><small>{system}</small><strong>{title}</strong><code>{proofLevel === 0 && index > 0 ? 'Pending' : evidence}</code></div>
              })}
            </div>
            <div className="proof-foot"><ShieldCheck size={15} /><p>{auditProofJob?.error || '证明用于审计交易事实，不代表买方余额充足、资金已锁定或必然偿付。'}</p>{auditProofJob?.registrationTransactionHash ? <a href={`https://creditcoin-testnet.blockscout.com/tx/${auditProofJob.registrationTransactionHash}`} target="_blank" rel="noreferrer">查看登记交易<ArrowRight size={13} /></a> : <button onClick={() => goTo('receivable')}>查看资产<ArrowRight size={13} /></button>}</div>
          </section>

          <section className="panel protocol" id="settlement"><div className="protocol-title"><span><Zap size={19} /></span><div><h2>到期兑付监控</h2><p>EIP-3009 未来授权 · 受限 Relayer · 资金方钱包领取</p></div></div><div className="protocol-stats"><div><small>结算状态</small><strong>{paymentStatus === 'paid' ? '资金方已领取' : paymentStatus === 'claiming' ? '钱包确认中' : paymentStatus === 'claimable' ? '待资金方领取' : paymentStatus === 'failed' ? 'Relayer 结算失败' : paymentStatus === 'pending' ? '可执行结算' : paymentStatus === 'authorized' ? '已验签保存' : '待签署'}</strong></div><div><small>业务到期日</small><strong>{activeReceivable.dueDate} UTC</strong></div><div><small>买方签署钱包</small><strong>{authorizationSigner ? `${authorizationSigner.slice(0, 6)}…${authorizationSigner.slice(-4)}` : '未签署'}</strong></div><div><small>授权摘要</small><strong title={authorizationHash || ''}>{authorizationHash ? `${authorizationHash.slice(0, 8)}…${authorizationHash.slice(-6)}` : '尚未生成'}</strong></div></div>{(settlementTransactionHash || claimTransactionHash) && <div className="balance-buttons">{settlementTransactionHash && <a href={`https://creditcoin-testnet.blockscout.com/tx/${settlementTransactionHash}`} target="_blank" rel="noreferrer">查看 Relayer 结算交易</a>}{claimTransactionHash && <a href={`https://creditcoin-testnet.blockscout.com/tx/${claimTransactionHash}`} target="_blank" rel="noreferrer">查看资金领取交易</a>}</div>}</section>
        </div>
      </main>
      {quoteOpen && <><button className="drawer-scrim" aria-label="关闭报价" disabled={settlementSubmitting} onClick={() => setQuoteOpen(false)} /><div className="create-modal quote-modal" role="dialog" aria-modal="true" aria-labelledby="quote-title"><div className="drawer-head"><div><small>NON-RECOURSE OFFER</small><h2 id="quote-title">提交无追索融资报价</h2></div><button aria-label="关闭" disabled={settlementSubmitting} onClick={() => setQuoteOpen(false)}>×</button></div><form onSubmit={submitFinancingQuote}>
        <div className="quote-context"><span><small>应收凭证</small><strong>{activeReceivable.id}</strong></span><span><small>应收面值</small><strong>{activeReceivable.amount.toLocaleString()} mUSDC</strong></span></div>
        <div className="form-grid"><label>融资比例（%）<input required type="number" min="0.01" max="100" step="0.01" value={quoteAdvanceRate} onChange={(event) => setQuoteAdvanceRate(event.target.value)} /></label><label>自动年化收益率（%）<output className="quote-output">{quoteAnnualizedYield === null ? '无法计算' : quoteAnnualizedYield.toFixed(2)}</output><small>按距离到期日 {quoteRemainingDays} 天计算</small></label></div>
        <label>报价有效期<input required type="datetime-local" value={quoteValidUntil} onChange={(event) => setQuoteValidUntil(event.target.value)} /></label>
        <div className="quote-summary"><span><small>放款金额</small><strong>{quoteAdvanceAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} mUSDC</strong></span><span><small>融资成本</small><strong>{quoteFinancingCost.toLocaleString(undefined, { maximumFractionDigits: 6 })} mUSDC</strong></span></div>
        <p>提交后，放款金额将锁定在结算合约中。供应商接受报价后，合约自动放款并完成债权转让。</p>{quoteError && <p className="analysis-message">{quoteError}</p>}<div className="form-actions"><button type="button" className="secondary" disabled={settlementSubmitting} onClick={() => setQuoteOpen(false)}>取消</button><button type="submit" className="primary" disabled={settlementSubmitting}>{settlementSubmitting ? <LoaderCircle className="spin" size={14} /> : <CircleDollarSign size={14} />}{settlementSubmitting ? '等待钱包确认' : '确认并提交链上报价'}</button></div>
      </form></div></>}
      {createOpen && <><button className="drawer-scrim" aria-label="关闭新增凭证" onClick={() => setCreateOpen(false)} /><div className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="drawer-head"><div><small>NEW RECEIVABLE</small><h2 id="create-title">新增核心应收凭证</h2></div><button aria-label="关闭" onClick={() => setCreateOpen(false)}>×</button></div><form ref={createFormRef} onSubmit={createReceivable}>
        <section className="document-upload"><div><strong>上传贸易文件</strong><small>AI 将读取合同与发票并自动填写下方字段</small></div><div className="upload-grid"><label className={contractFile ? 'has-file' : ''}><input type="file" accept=".pdf,.txt,.md,.json,.csv,application/pdf,text/plain" onChange={selectDocument('contract')} /><Upload size={18} /><span><strong>{contractFile?.name || '上传合同'}</strong><small>PDF、TXT、MD、JSON 或 CSV</small></span>{contractFile && <Check size={15} />}</label><label className={invoiceFile ? 'has-file' : ''}><input type="file" accept=".pdf,.txt,.md,.json,.csv,application/pdf,text/plain" onChange={selectDocument('invoice')} /><Upload size={18} /><span><strong>{invoiceFile?.name || '上传发票'}</strong><small>PDF、TXT、MD、JSON 或 CSV</small></span>{invoiceFile && <Check size={15} />}</label></div><button className="analyze-button" type="button" disabled={analyzing} onClick={analyzeDocuments}>{analyzing ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{analyzing ? '正在识别贸易文件…' : 'AI 识别并回填'}</button>{analysisMessage && <p className="analysis-message">{analysisMessage}</p>}</section>
        <div className="form-grid"><label>核心买方<input name="buyer" required placeholder="例如：环球制造集团" /></label><label>原始供应商<input name="supplier" required placeholder="例如：华辰精密有限公司" /></label></div><div className="form-grid"><label>合同编号<input name="contractNumber" required placeholder="SC-2026-0818" /></label><label>发票编号<input name="invoice" required placeholder="INV-8892" /></label></div><div className="form-grid"><label>应收金额（USDC）<input name="amount" required type="number" min="1" step="1" placeholder="100000" /></label><label>到期日期<input name="dueDate" required type="date" /></label></div><p>提交后凭证进入“待买方确权”状态。AI 识别结果仅用于辅助录入，提交前请人工核对。</p><div className="form-actions"><button type="button" className="secondary" onClick={() => setCreateOpen(false)}>取消</button><button type="submit" className="primary"><Plus size={14} />创建凭证</button></div></form></div></>}
      {detailOpen && <><button className="drawer-scrim" aria-label="关闭详情" onClick={() => setDetailOpen(false)} /><aside className="drawer">
        <div className="drawer-head"><div><small>数字应收账款凭证</small><h2>{selectedReceivable.id}</h2></div><button aria-label="关闭" onClick={() => setDetailOpen(false)}>×</button></div>
        <div className="certificate"><span className={`status ${selectedReceivable.status}`}>{receivableStatusNames[selectedReceivable.status]}</span><strong>${selectedReceivable.amount.toLocaleString()}</strong><small>{selectedReceivable.dueDate} 到期</small><FileCheck2 size={40} /></div>
        <section><h3>交易双方</h3><dl><div><dt>核心买方</dt><dd>{selectedReceivable.buyer}</dd></div><div><dt>原始供应商</dt><dd>{selectedReceivable.supplier}</dd></div><div><dt>当前权利人</dt><dd>{['assigned','matured','settled','paid','defaulted'].includes(selectedReceivable.status) ? '远海资本' : selectedReceivable.supplier}</dd></div></dl></section>
        <section><h3>贸易资料</h3><dl><div><dt>合同编号</dt><dd>{selectedReceivable.contractNumber}</dd></div><div><dt>发票编号</dt><dd>{selectedReceivable.invoice}</dd></div><div><dt>验收状态</dt><dd className="verified"><Check size={13} />已验证</dd></div></dl></section>
        <section><h3>双签绑定</h3><div className="signatures"><div><ShieldCheck size={17} /><span><strong>Approved Payable</strong><small>0x2e84...90c1</small></span></div><div><Zap size={17} /><span><strong>Payment Authorization</strong><small>0x79ad...38e2</small></span></div></div></section>
        <p className="legal">本凭证为演示环境中的无追索数字债权记录。付款授权不冻结资金，也不保证买方到期偿付。</p>
      </aside></>}
    </div>
  )
}

export default App
