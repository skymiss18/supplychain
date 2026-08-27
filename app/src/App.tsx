import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  formatUnits,
  isAddressEqual,
  keccak256,
  parseUnits,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
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
} from "lucide-react";
import "./App.css";
import {
  CREDITCOIN_TESTNET_CHAIN_ID,
  buildPaymentAuthorizationTypedData,
  serializePaymentAuthorizationMessage,
  type PaymentAuthorizationConfig,
} from "./paymentAuthorization";

type Role = "supplier" | "buyer" | "funder" | "operator";
type ReceivableStatus =
  | "pending"
  | "active"
  | "assigned"
  | "matured"
  | "settled"
  | "paid"
  | "defaulted";
type FinancingStatus =
  "not_requested" | "quoting" | "offered" | "funded" | "repaid" | "in_default";
type PaymentStatus =
  | "not_due"
  | "authorized"
  | "pending"
  | "claimable"
  | "claiming"
  | "paid"
  | "failed";
type ProofStatus =
  | "not_started"
  | "queued"
  | "waiting_source"
  | "building"
  | "submitting"
  | "recorded"
  | "failed";
type AuthorizationStep =
  "idle" | "connecting" | "switching" | "signing" | "verifying" | "verified";
type PaymentAuthorizationStatus = {
  status: "verified" | "not_found";
  authorizationHash?: Hex;
  signer?: Address;
  verifiedAt?: string;
  error?: string;
};

type SettlementResult = {
  transactionHash?: Hex;
  claimableAmount?: string;
  recipient?: Address;
  alreadySettled?: boolean;
  error?: string;
};

type AuditProofJob = {
  receivableId: string;
  status: ProofStatus;
  sourceTransactionHash?: Hex;
  sourceBlockNumber?: string;
  evidenceHash?: Hex;
  registrationTransactionHash?: Hex;
  registeredAt?: string;
  error?: string;
};

type FinancingConfig = PaymentAuthorizationConfig & {
  error?: string;
};

type ChainFinancingOffer = readonly [
  funder: Address,
  supplier: Address,
  token: Address,
  principal: bigint,
  faceValue: bigint,
  annualizedYieldBps: bigint,
  validUntil: bigint,
  accepted: boolean,
];

type Receivable = {
  id: string;
  buyer: string;
  supplier: string;
  invoice: string;
  contractNumber: string;
  amount: number;
  dueDate: string;
  status: ReceivableStatus;
  financingStatus: FinancingStatus;
};

const initialReceivable: Receivable = {
  id: "AR-2026-000001",
  buyer: "Global Manufacturing Group",
  supplier: "Huachen Precision Co., Ltd.",
  invoice: "INV-8891",
  contractNumber: "SC-2026-0818",
  amount: 100000,
  dueDate: "2026-10-25",
  status: "pending",
  financingStatus: "not_requested",
};

const financingQuote = {
  funder: "Yuanhai Capital",
  advanceRate: 96.84,
  annualizedYield: 18.6,
  expiresAt: "2026-08-23 18:00 UTC",
};

const defaultQuoteExpiry = () => {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Date(expiresAt.getTime() - expiresAt.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};

const calculateAnnualizedYield = (
  faceValue: number,
  principal: number,
  dueDate: string,
) => {
  const millisecondsUntilMaturity =
    new Date(`${dueDate}T00:00:00Z`).getTime() - Date.now();
  const remainingDays = millisecondsUntilMaturity / (24 * 60 * 60 * 1000);
  if (principal <= 0 || remainingDays <= 0) return null;
  return ((faceValue - principal) / principal) * (365 / remainingDays) * 100;
};

const roleNames: Record<Role, string> = {
  supplier: "Supplier",
  buyer: "Buyer",
  funder: "Funder",
  operator: "Operator",
};

const roleDescriptions: Record<Role, string> = {
  operator: "Monitor settlement, authorization, and exceptions",
  supplier: "Create receivables and initiate financing requests",
  buyer: "Confirm liabilities and sign the payment authorization",
  funder: "Submit quotes and claim settlement funds",
};

const loginRoles: Role[] = ["operator", "supplier", "buyer", "funder"];

const receivableStatusNames: Record<ReceivableStatus, string> = {
  pending: "Awaiting Buyer Confirmation",
  active: "Confirmed and Financeable",
  assigned: "Assigned",
  matured: "Matured",
  settled: "Settlement Claimable",
  paid: "Paid",
  defaulted: "Defaulted",
};

const settlementAbi = [
  {
    type: "function",
    name: "requestFinancing",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receivableIdHash", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "faceValue", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submitOffer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receivableIdHash", type: "bytes32" },
      { name: "principal", type: "uint256" },
      { name: "annualizedYieldBps", type: "uint256" },
      { name: "validUntil", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "acceptOffer",
    stateMutability: "nonpayable",
    inputs: [{ name: "receivableIdHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "financingRequests",
    stateMutability: "view",
    inputs: [{ name: "receivableIdHash", type: "bytes32" }],
    outputs: [
      { name: "supplier", type: "address" },
      { name: "token", type: "address" },
      { name: "faceValue", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "financingOffers",
    stateMutability: "view",
    inputs: [{ name: "receivableIdHash", type: "bytes32" }],
    outputs: [
      { name: "funder", type: "address" },
      { name: "supplier", type: "address" },
      { name: "token", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "faceValue", type: "uint256" },
      { name: "annualizedYieldBps", type: "uint256" },
      { name: "validUntil", type: "uint64" },
      { name: "accepted", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "settledReceivables",
    stateMutability: "view",
    inputs: [{ name: "receivableIdHash", type: "bytes32" }],
    outputs: [{ name: "settled", type: "bool" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "event",
    name: "FinancingRequested",
    inputs: [
      { indexed: true, name: "receivableIdHash", type: "bytes32" },
      { indexed: true, name: "supplier", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "faceValue", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "FinancingOfferSubmitted",
    inputs: [
      { indexed: true, name: "receivableIdHash", type: "bytes32" },
      { indexed: true, name: "funder", type: "address" },
      { indexed: true, name: "supplier", type: "address" },
      { indexed: false, name: "token", type: "address" },
      { indexed: false, name: "principal", type: "uint256" },
      { indexed: false, name: "faceValue", type: "uint256" },
      { indexed: false, name: "annualizedYieldBps", type: "uint256" },
      { indexed: false, name: "validUntil", type: "uint64" },
    ],
  },
  {
    type: "event",
    name: "FinancingOfferAccepted",
    inputs: [
      { indexed: true, name: "receivableIdHash", type: "bytes32" },
      { indexed: true, name: "supplier", type: "address" },
      { indexed: true, name: "funder", type: "address" },
    ],
  },
] as const;

const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const receivableHash = (id: string) => keccak256(toBytes(id));

const readDocumentText = async (file: File) => {
  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  )
    return file.text();
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = pdfWorker;
  const pdf = await getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
  }
  return pages.join("\n");
};

const getWalletErrorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback;
  if (/provider not found/i.test(error.message))
    return "No browser EVM wallet detected. Please install or enable a wallet extension.";
  if (/user rejected|rejected the request/i.test(error.message))
    return "You cancelled this wallet action. No business state was changed.";
  return error.message.split("\n")[0] || fallback;
};

const sessionRoleKey = "attestflow.role";
const getSessionRole = (): Role | null => {
  const value = sessionStorage.getItem(sessionRoleKey);
  return value === "supplier" ||
    value === "buyer" ||
    value === "funder" ||
    value === "operator"
    ? value
    : null;
};

function App() {
  const connection = useAccount();
  const { openConnectModal } = useConnectModal();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const initialSessionRole = getSessionRole();
  const isLoginPage = window.location.pathname === "/login";
  const [role, setRole] = useState<Role>(initialSessionRole || "supplier");
  const [selectedLoginRole, setSelectedLoginRole] = useState<Role | null>(null);
  const [loggedIn, setLoggedIn] = useState(
    Boolean(initialSessionRole) && !isLoginPage,
  );
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");
  const [receivableStatus, setReceivableStatus] =
    useState<ReceivableStatus>("pending");
  const [financingStatus, setFinancingStatus] =
    useState<FinancingStatus>("not_requested");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("not_due");
  const [proofStatus, setProofStatus] = useState<ProofStatus>("not_started");
  const [auditProofJob, setAuditProofJob] = useState<AuditProofJob | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteAdvanceRate, setQuoteAdvanceRate] = useState(
    String(financingQuote.advanceRate),
  );
  const [quoteValidUntil, setQuoteValidUntil] = useState(defaultQuoteExpiry);
  const [quoteError, setQuoteError] = useState("");
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [activeReceivableId, setActiveReceivableId] = useState("");
  const [selectedReceivable, setSelectedReceivable] =
    useState<Receivable>(initialReceivable);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [authorizationStep, setAuthorizationStep] =
    useState<AuthorizationStep>("idle");
  const [authorizationMessage, setAuthorizationMessage] = useState("");
  const [authorizationHash, setAuthorizationHash] = useState<Hex | null>(null);
  const [authorizationSigner, setAuthorizationSigner] =
    useState<Address | null>(null);
  const [authorizationVerifiedAt, setAuthorizationVerifiedAt] = useState<
    string | null
  >(null);
  const [settlementMessage, setSettlementMessage] = useState("");
  const [settlementSubmitting, setSettlementSubmitting] = useState(false);
  const [settlementTransactionHash, setSettlementTransactionHash] =
    useState<Hex | null>(null);
  const [claimTransactionHash, setClaimTransactionHash] = useState<Hex | null>(
    null,
  );
  const [chainFinancingOffer, setChainFinancingOffer] =
    useState<ChainFinancingOffer | null>(null);
  const [financingRequestedAt, setFinancingRequestedAt] = useState<
    string | null
  >(null);
  const [financingOfferedAt, setFinancingOfferedAt] = useState<string | null>(
    null,
  );
  const [financingAcceptedAt, setFinancingAcceptedAt] = useState<string | null>(
    null,
  );
  const createFormRef = useRef<HTMLFormElement>(null);
  const activeReceivable =
    receivables.find((receivable) => receivable.id === activeReceivableId) ||
    receivables[0] ||
    initialReceivable;

  useEffect(() => {
    if (!loggedIn) return;
    const controller = new AbortController();
    const loadReceivables = async () => {
      try {
        const response = await fetch("/api/receivables", {
          signal: controller.signal,
        });
        const result = (await response.json()) as
          Receivable[] | { error?: string };
        if (!response.ok || !Array.isArray(result))
          throw new Error(
            "error" in result
              ? result.error || "Unable to load receivables"
              : "Unable to load receivables",
          );
        setReceivables(result);
        setActiveReceivableId((current) =>
          result.some((receivable) => receivable.id === current)
            ? current
            : result[0]?.id || initialReceivable.id,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setAnalysisMessage(
          error instanceof Error ? error.message : "Unable to load receivables",
        );
      }
    };
    void loadReceivables();
    return () => controller.abort();
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn || receivables.length === 0) return;
    const controller = new AbortController();
    const restoreAuthorization = async () => {
      setReceivableStatus(activeReceivable.status);
      setFinancingStatus("not_requested");
      setPaymentStatus("not_due");
      setProofStatus("not_started");
      setAuthorizationStep("idle");
      setAuthorizationMessage("");
      setAuthorizationHash(null);
      setAuthorizationSigner(null);
      setAuthorizationVerifiedAt(null);
      setSettlementMessage("");
      setSettlementTransactionHash(null);
      setClaimTransactionHash(null);
      setFinancingStatus(
        activeReceivable.financingStatus ||
          (["assigned", "matured", "settled"].includes(activeReceivable.status)
            ? "funded"
            : activeReceivable.status === "paid"
              ? "repaid"
              : "not_requested"),
      );
      setPaymentStatus(
        activeReceivable.status === "matured"
          ? "pending"
          : activeReceivable.status === "settled"
            ? "claimable"
            : activeReceivable.status === "paid"
              ? "paid"
              : "not_due",
      );
      try {
        const response = await fetch(
          `/api/payment-authorizations/status?receivableId=${encodeURIComponent(activeReceivable.id)}`,
          {
            signal: controller.signal,
          },
        );
        const result = (await response.json()) as PaymentAuthorizationStatus;
        if (!response.ok)
          throw new Error(
            result.error || "Unable to query payment authorization status",
          );
        if (
          result.status !== "verified" ||
          !result.authorizationHash ||
          !result.signer
        ) {
          if (activeReceivable.status === "active") {
            setReceivableStatus("pending");
            setReceivables((items) =>
              items.map((receivable) =>
                receivable.id === activeReceivable.id
                  ? { ...receivable, status: "pending" }
                  : receivable,
              ),
            );
            await fetch("/api/receivables", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: activeReceivable.id,
                status: "pending",
              }),
              signal: controller.signal,
            });
          }
          return;
        }
        setAuthorizationHash(result.authorizationHash);
        setAuthorizationSigner(result.signer);
        setAuthorizationVerifiedAt(result.verifiedAt || null);
        setAuthorizationStep("verified");
        setAuthorizationMessage(
          "The payment authorization has been verified and saved by the server; this signature does not lock USDC.",
        );
        setReceivableStatus((status) =>
          status === "pending" ? "active" : status,
        );
        setPaymentStatus((status) =>
          status === "not_due" ? "authorized" : status,
        );
        setProofStatus((status) =>
          status === "not_started" ? "queued" : status,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setAuthorizationMessage(
          error instanceof Error
            ? error.message
            : "Unable to query payment authorization status",
        );
      }
    };
    void restoreAuthorization();
    return () => controller.abort();
  }, [
    activeReceivable.financingStatus,
    activeReceivable.id,
    activeReceivable.status,
    loggedIn,
  ]);

  useEffect(() => {
    if (!loggedIn || receivables.length === 0) return;
    if (!authorizationHash) {
      setAuditProofJob(null);
      setProofStatus("not_started");
      return;
    }
    const controller = new AbortController();
    const startProof = async () => {
      try {
        await fetch("/api/audit-proofs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receivableId: activeReceivable.id }),
          signal: controller.signal,
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setProofStatus("failed");
      }
    };
    const refreshProof = async () => {
      try {
        const response = await fetch(
          `/api/audit-proofs/status?receivableId=${encodeURIComponent(activeReceivable.id)}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as AuditProofJob & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || "Unable to query audit proof task");
        setAuditProofJob(result);
        setProofStatus(result.status);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAuditProofJob((current) =>
            current
              ? {
                  ...current,
                  status: "failed",
                  error:
                    error instanceof Error
                      ? error.message
                      : "Unable to query audit proof task",
                }
              : null,
          );
          setProofStatus("failed");
        }
      }
    };
    void startProof().then(refreshProof);
    const polling = window.setInterval(() => void refreshProof(), 3_000);
    return () => {
      controller.abort();
      window.clearInterval(polling);
    };
  }, [activeReceivable.id, authorizationHash, loggedIn]);

  useEffect(() => {
    if (!loggedIn || receivables.length === 0) return;
    if (!publicClient) return;
    const controller = new AbortController();
    const restoreChainFinancing = async () => {
      try {
        const configResponse = await fetch(
          `/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`,
          { signal: controller.signal },
        );
        const config = (await configResponse.json()) as FinancingConfig;
        if (!configResponse.ok)
          throw new Error(
            config.error ||
              "Unable to load the financing contract configuration",
          );
        const idHash = receivableHash(activeReceivable.id);
        const [request, offer, chainSettled] = await Promise.all([
          publicClient.readContract({
            address: config.settlementAddress,
            abi: settlementAbi,
            functionName: "financingRequests",
            args: [idHash],
          }),
          publicClient.readContract({
            address: config.settlementAddress,
            abi: settlementAbi,
            functionName: "financingOffers",
            args: [idHash],
          }),
          publicClient.readContract({
            address: config.settlementAddress,
            abi: settlementAbi,
            functionName: "settledReceivables",
            args: [idHash],
          }),
        ]);
        if (controller.signal.aborted) return;
        const requestSupplier = request[0];
        const typedOffer = offer as ChainFinancingOffer;
        const hasOffer = typedOffer[0] !== ZERO_ADDRESS;
        const claimableAmount =
          chainSettled && hasOffer
            ? await publicClient.readContract({
                address: config.settlementAddress,
                abi: settlementAbi,
                functionName: "claimable",
                args: [config.tokenAddress, typedOffer[0]],
              })
            : 0n;
        const nextFinancingStatus: FinancingStatus =
          chainSettled && claimableAmount === 0n
            ? "repaid"
            : hasOffer
              ? typedOffer[7]
                ? "funded"
                : "offered"
              : requestSupplier !== ZERO_ADDRESS
                ? "quoting"
                : "not_requested";
        const hasStaleDownstreamStatus = [
          "assigned",
          "matured",
          "settled",
          "paid",
          "defaulted",
        ].includes(activeReceivable.status);
        const nextReceivableStatus: ReceivableStatus = chainSettled
          ? claimableAmount > 0n
            ? "settled"
            : "paid"
          : typedOffer[7]
            ? activeReceivable.status === "matured"
              ? "matured"
              : "assigned"
            : hasStaleDownstreamStatus
              ? "active"
              : activeReceivable.status;
        setChainFinancingOffer(hasOffer ? typedOffer : null);
        setFinancingRequestedAt(null);
        setFinancingOfferedAt(null);
        setFinancingAcceptedAt(null);
        if (requestSupplier !== ZERO_ADDRESS) {
          try {
            const latestBlock = await publicClient.getBlockNumber();
            const fromBlock =
              latestBlock > 10_000n ? latestBlock - 10_000n : 0n;
            const [requestedEvents, offeredEvents, acceptedEvents] =
              await Promise.all([
                publicClient.getContractEvents({
                  address: config.settlementAddress,
                  abi: settlementAbi,
                  eventName: "FinancingRequested",
                  args: { receivableIdHash: idHash },
                  fromBlock,
                  toBlock: "latest",
                }),
                publicClient.getContractEvents({
                  address: config.settlementAddress,
                  abi: settlementAbi,
                  eventName: "FinancingOfferSubmitted",
                  args: { receivableIdHash: idHash },
                  fromBlock,
                  toBlock: "latest",
                }),
                publicClient.getContractEvents({
                  address: config.settlementAddress,
                  abi: settlementAbi,
                  eventName: "FinancingOfferAccepted",
                  args: { receivableIdHash: idHash },
                  fromBlock,
                  toBlock: "latest",
                }),
              ]);
            const [requestedBlock, offeredBlock, acceptedBlock] =
              await Promise.all([
                requestedEvents.at(-1)?.blockNumber
                  ? publicClient.getBlock({
                      blockNumber: requestedEvents.at(-1)!.blockNumber!,
                    })
                  : null,
                offeredEvents.at(-1)?.blockNumber
                  ? publicClient.getBlock({
                      blockNumber: offeredEvents.at(-1)!.blockNumber!,
                    })
                  : null,
                acceptedEvents.at(-1)?.blockNumber
                  ? publicClient.getBlock({
                      blockNumber: acceptedEvents.at(-1)!.blockNumber!,
                    })
                  : null,
              ]);
            if (requestedBlock)
              setFinancingRequestedAt(
                new Date(Number(requestedBlock.timestamp) * 1000).toISOString(),
              );
            if (offeredBlock)
              setFinancingOfferedAt(
                new Date(Number(offeredBlock.timestamp) * 1000).toISOString(),
              );
            if (acceptedBlock)
              setFinancingAcceptedAt(
                new Date(Number(acceptedBlock.timestamp) * 1000).toISOString(),
              );
          } catch {
            setFinancingRequestedAt(null);
            setFinancingOfferedAt(null);
            setFinancingAcceptedAt(null);
          }
        }
        if (chainSettled) {
          setPaymentStatus(claimableAmount > 0n ? "claimable" : "paid");
          setSettlementMessage(
            claimableAmount > 0n
              ? `On-chain settlement is complete. The funder can claim ${formatUnits(claimableAmount, 6)} mUSDC.`
              : "On-chain settlement is complete, and the funder has claimed the settlement funds.",
          );
        } else if (typedOffer[7]) {
          const sameWallet = isAddressEqual(typedOffer[0], typedOffer[1]);
          setSettlementMessage(
            sameWallet
              ? `The on-chain offer was accepted, but the supplier and funder use the same wallet. ${formatUnits(typedOffer[3], 6)} mUSDC was returned to the same address, so the net balance is unchanged.`
              : `The on-chain offer was accepted. The contract disbursed ${formatUnits(typedOffer[3], 6)} mUSDC to the supplier wallet.`,
          );
        }
        setFinancingStatus(nextFinancingStatus);
        setReceivableStatus(nextReceivableStatus);
        setReceivables((items) =>
          items.map((item) =>
            item.id === activeReceivable.id
              ? {
                  ...item,
                  status: nextReceivableStatus,
                  financingStatus: nextFinancingStatus,
                }
              : item,
          ),
        );
        if (
          activeReceivable.financingStatus !== nextFinancingStatus ||
          activeReceivable.status !== nextReceivableStatus
        ) {
          await fetch("/api/receivables", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: activeReceivable.id,
              status: nextReceivableStatus,
              financingStatus: nextFinancingStatus,
            }),
            signal: controller.signal,
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setSettlementMessage(
          error instanceof Error
            ? `Unable to read on-chain financing status: ${error.message}`
            : "Unable to read on-chain financing status",
        );
      }
    };
    void restoreChainFinancing();
    return () => controller.abort();
  }, [
    activeReceivable.financingStatus,
    activeReceivable.id,
    activeReceivable.status,
    loggedIn,
    publicClient,
  ]);

  const goTo = (id: string) =>
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  const selectReceivable = (
    receivable: Receivable,
    status = receivable.status,
  ) => {
    setActiveReceivableId(receivable.id);
    setSelectedReceivable({ ...receivable, status });
  };

  const persistReceivableWorkflow = async (
    id: string,
    updates: Partial<Pick<Receivable, "status" | "financingStatus">>,
  ) => {
    const response = await fetch("/api/receivables", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    const result = (await response.json()) as Receivable | { error?: string };
    if (!response.ok || !("id" in result))
      throw new Error(
        "error" in result
          ? result.error || "Unable to save receivable state"
          : "Unable to save receivable state",
      );
    setReceivables((items) =>
      items.map((receivable) => (receivable.id === id ? result : receivable)),
    );
    return result;
  };

  const startFinancingInquiry = async (receivable: Receivable) => {
    selectReceivable(receivable, "active");
    setSettlementSubmitting(true);
    setSettlementMessage(
      `Please publish the on-chain financing request for ${receivable.id} from the supplier wallet…`,
    );
    try {
      let address = connection.address;
      let chainId = connection.chainId;
      if (!address) {
        const connected = await connectWallet();
        address = connected.address;
        chainId = connected.chainId;
      }
      if (!address)
        throw new Error("The wallet did not return a supplier address");
      if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID)
        await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID });
      const configResponse = await fetch(
        `/api/payment-authorizations/config?receivableId=${encodeURIComponent(receivable.id)}`,
      );
      const config = (await configResponse.json()) as FinancingConfig;
      if (!configResponse.ok)
        throw new Error(
          config.error || "Unable to load the financing contract configuration",
        );
      const transactionHash = await writeContractAsync({
        address: config.settlementAddress,
        abi: settlementAbi,
        functionName: "requestFinancing",
        args: [
          receivableHash(receivable.id),
          config.tokenAddress,
          parseUnits(receivable.amount.toString(), 6),
        ],
        account: address,
        chainId: CREDITCOIN_TESTNET_CHAIN_ID,
      });
      if (!publicClient)
        throw new Error("Creditcoin RPC client is unavailable");
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
      });
      if (receipt.status !== "success")
        throw new Error("The on-chain financing request transaction failed");
      await persistReceivableWorkflow(receivable.id, {
        financingStatus: "quoting",
      });
      setFinancingStatus("quoting");
      setSettlementMessage(
        `${receivable.id} financing request has been recorded on-chain and is awaiting a funder quote.`,
      );
    } catch (error) {
      setSettlementMessage(
        `Financing inquiry failed: ${getWalletErrorMessage(error, "Wallet transaction failed")}`,
      );
    } finally {
      setSettlementSubmitting(false);
    }
  };

  const persistReceivableStatus = async (status: ReceivableStatus) => {
    setReceivableStatus(status);
    setReceivables((items) =>
      items.map((receivable) =>
        receivable.id === activeReceivable.id
          ? { ...receivable, status }
          : receivable,
      ),
    );
    await persistReceivableWorkflow(activeReceivable.id, { status });
  };

  const advance = async () => {
    if (
      role === "supplier" &&
      receivableStatus === "active" &&
      financingStatus === "not_requested"
    )
      return startFinancingInquiry(activeReceivable);
    if (role === "supplier" && financingStatus === "offered") {
      setSettlementSubmitting(true);
      setSettlementMessage(
        "Confirm acceptance of the on-chain offer in the supplier wallet...",
      );
      try {
        let address = connection.address;
        let chainId = connection.chainId;
        if (!address) {
          const connected = await connectWallet();
          address = connected.address;
          chainId = connected.chainId;
        }
        if (!address)
          throw new Error("The wallet did not return a supplier address");
        if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID)
          await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID });
        const configResponse = await fetch(
          `/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`,
        );
        const config = (await configResponse.json()) as FinancingConfig;
        if (!configResponse.ok)
          throw new Error(
            config.error ||
              "Unable to load the financing contract configuration",
          );
        const transactionHash = await writeContractAsync({
          address: config.settlementAddress,
          abi: settlementAbi,
          functionName: "acceptOffer",
          args: [receivableHash(activeReceivable.id)],
          account: address,
          chainId: CREDITCOIN_TESTNET_CHAIN_ID,
        });
        if (!publicClient)
          throw new Error("The Creditcoin RPC client is unavailable");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash,
        });
        if (receipt.status !== "success")
          throw new Error("The offer acceptance transaction failed");
        const acceptedBlock = await publicClient.getBlock({
          blockNumber: receipt.blockNumber,
        });
        setFinancingAcceptedAt(
          new Date(Number(acceptedBlock.timestamp) * 1000).toISOString(),
        );
        setFinancingStatus("funded");
        setReceivableStatus("assigned");
        await persistReceivableWorkflow(activeReceivable.id, {
          status: "assigned",
          financingStatus: "funded",
        });
        setSettlementMessage(
          "The supplier wallet confirmed the offer, and the contract disbursed the financing principal.",
        );
      } catch (error) {
        setSettlementMessage(
          `Failed to accept the offer: ${getWalletErrorMessage(error, "Wallet transaction failed")}`,
        );
      } finally {
        setSettlementSubmitting(false);
      }
      return;
    }
    if (
      role === "operator" &&
      financingStatus === "funded" &&
      receivableStatus === "assigned"
    ) {
      setSettlementMessage(
        "The receivable has reached maturity. The saved payment authorization can now be executed.",
      );
      setPaymentStatus("pending");
      return persistReceivableStatus("matured");
    }
    if (
      role === "funder" &&
      receivableStatus === "matured" &&
      (paymentStatus === "pending" || paymentStatus === "failed")
    ) {
      setSettlementSubmitting(true);
      setPaymentStatus("pending");
      setSettlementMessage(
        "The restricted relayer is submitting the payment authorization to Creditcoin CC3...",
      );
      try {
        const response = await fetch("/api/settlements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receivableId: activeReceivable.id }),
        });
        const result = (await response.json()) as SettlementResult;
        if (
          !response.ok ||
          (!result.transactionHash && !result.alreadySettled) ||
          !result.claimableAmount
        )
          throw new Error(result.error || "On-chain settlement failed");
        setSettlementTransactionHash(result.transactionHash || null);
        setPaymentStatus("claimable");
        setReceivableStatus("settled");
        setReceivables((items) =>
          items.map((receivable) =>
            receivable.id === activeReceivable.id
              ? { ...receivable, status: "settled" }
              : receivable,
          ),
        );
        setSettlementMessage(
          `${result.alreadySettled ? "On-chain settlement status restored" : "Relayer settlement succeeded"}. The funder can claim ${formatUnits(BigInt(result.claimableAmount), 6)} mUSDC.`,
        );
      } catch (error) {
        setPaymentStatus("failed");
        setSettlementMessage(
          error instanceof Error
            ? `On-chain settlement failed: ${error.message}`
            : "On-chain settlement failed",
        );
      } finally {
        setSettlementSubmitting(false);
      }
      return;
    }
    if (
      role === "funder" &&
      receivableStatus === "settled" &&
      paymentStatus === "claimable"
    ) {
      setSettlementSubmitting(true);
      setPaymentStatus("claiming");
      setSettlementMessage(
        "Confirm the claim transaction in the funder wallet...",
      );
      try {
        let address = connection.address;
        let chainId = connection.chainId;
        if (!address) {
          const connected = await connectWallet();
          address = connected.address;
          chainId = connected.chainId;
        }
        if (!address)
          throw new Error("The wallet did not return a funder address");
        if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID)
          await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID });

        const configResponse = await fetch(
          `/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`,
        );
        const configResult = (await configResponse.json()) as FinancingConfig;
        if (!configResponse.ok)
          throw new Error(
            configResult.error ||
              "Unable to load the settlement contract configuration",
          );
        const offer = await publicClient?.readContract({
          address: configResult.settlementAddress,
          abi: settlementAbi,
          functionName: "financingOffers",
          args: [receivableHash(activeReceivable.id)],
        });
        if (!offer)
          throw new Error(
            "Unable to read the on-chain financing status from Creditcoin",
          );
        if (offer[0] === ZERO_ADDRESS || !offer[7])
          throw new Error(
            "The deployed contract has no accepted offer for this receivable. Refresh the page and complete the financing flow again.",
          );
        if (!isAddressEqual(address, offer[0]))
          throw new Error(
            "The current wallet is not the on-chain funder for this receivable",
          );
        const transactionHash = await writeContractAsync({
          address: configResult.settlementAddress,
          abi: settlementAbi,
          functionName: "claim",
          args: [configResult.tokenAddress],
          account: address,
          chainId: CREDITCOIN_TESTNET_CHAIN_ID,
        });
        setClaimTransactionHash(transactionHash);
        if (!publicClient)
          throw new Error("The Creditcoin RPC client is unavailable");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash,
        });
        if (receipt.status !== "success")
          throw new Error("The fund claim transaction failed");
        setPaymentStatus("paid");
        setFinancingStatus("repaid");
        await persistReceivableStatus("paid");
        setSettlementMessage(
          "The funder claimed the settlement funds through the wallet.",
        );
      } catch (error) {
        setPaymentStatus("claimable");
        setSettlementMessage(
          `Failed to claim funds: ${getWalletErrorMessage(error, "Wallet transaction failed")}`,
        );
      } finally {
        setSettlementSubmitting(false);
      }
      return;
    }
    if (receivableStatus === "paid" || receivableStatus === "defaulted") {
      setSelectedReceivable({ ...activeReceivable, status: receivableStatus });
      setDetailOpen(true);
    }
  };

  const openQuoteEditor = () => {
    setQuoteAdvanceRate(String(financingQuote.advanceRate));
    setQuoteValidUntil(defaultQuoteExpiry());
    setQuoteError("");
    setQuoteOpen(true);
  };

  const submitFinancingQuote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const advanceRate = Number(quoteAdvanceRate);
    const advanceAmount = (activeReceivable.amount * advanceRate) / 100;
    const annualizedYield = calculateAnnualizedYield(
      activeReceivable.amount,
      advanceAmount,
      activeReceivable.dueDate,
    );
    const validUntilTimestamp = Math.floor(
      new Date(quoteValidUntil).getTime() / 1000,
    );
    if (
      !Number.isFinite(advanceRate) ||
      advanceRate <= 0 ||
      advanceRate > 100
    ) {
      setQuoteError(
        "The advance rate must be greater than 0% and no more than 100%",
      );
      return;
    }
    if (annualizedYield === null || !Number.isFinite(annualizedYield)) {
      setQuoteError("The receivable due date must be in the future");
      return;
    }
    if (
      !Number.isFinite(validUntilTimestamp) ||
      validUntilTimestamp <= Math.floor(Date.now() / 1000)
    ) {
      setQuoteError("The offer expiration must be in the future");
      return;
    }
    setQuoteError("");
    setSettlementSubmitting(true);
    setSettlementMessage(
      "Authorize the financing principal lock in the funder wallet...",
    );
    try {
      let address = connection.address;
      let chainId = connection.chainId;
      if (!address) {
        const connected = await connectWallet();
        address = connected.address;
        chainId = connected.chainId;
      }
      if (!address)
        throw new Error("The wallet did not return a funder address");
      if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID)
        await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID });
      const configResponse = await fetch(
        `/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`,
      );
      const config = (await configResponse.json()) as FinancingConfig;
      if (!configResponse.ok)
        throw new Error(
          config.error || "Unable to load the financing contract configuration",
        );
      const request = await publicClient?.readContract({
        address: config.settlementAddress,
        abi: settlementAbi,
        functionName: "financingRequests",
        args: [receivableHash(activeReceivable.id)],
      });
      if (!request) throw new Error("The Creditcoin RPC client is unavailable");
      const principal = parseUnits(advanceAmount.toFixed(6), 6);
      const balance = await publicClient?.readContract({
        address: config.tokenAddress,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [address],
      });
      if (balance === undefined)
        throw new Error("The Creditcoin RPC client is unavailable");
      if (balance < principal)
        throw new Error(
          `Insufficient funder mUSDC balance: ${advanceAmount.toLocaleString()} required, ${formatUnits(balance, 6)} available`,
        );
      const approvalHash = await writeContractAsync({
        address: config.tokenAddress,
        abi: tokenAbi,
        functionName: "approve",
        args: [config.settlementAddress, principal],
        account: address,
        chainId: CREDITCOIN_TESTNET_CHAIN_ID,
      });
      if (!publicClient)
        throw new Error("The Creditcoin RPC client is unavailable");
      const approvalReceipt = await publicClient.waitForTransactionReceipt({
        hash: approvalHash,
      });
      if (approvalReceipt.status !== "success")
        throw new Error("Financing principal approval failed");
      setSettlementMessage(
        "Authorization succeeded. Confirm the on-chain offer to lock the financing principal...",
      );
      const validUntil = BigInt(validUntilTimestamp);
      const transactionHash = await writeContractAsync({
        address: config.settlementAddress,
        abi: settlementAbi,
        functionName: "submitOffer",
        args: [
          receivableHash(activeReceivable.id),
          principal,
          BigInt(Math.round(annualizedYield * 100)),
          validUntil,
        ],
        account: address,
        chainId: CREDITCOIN_TESTNET_CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
      });
      if (receipt.status !== "success")
        throw new Error("The on-chain offer transaction failed");
      await persistReceivableWorkflow(activeReceivable.id, {
        financingStatus: "offered",
      });
      setFinancingStatus("offered");
      const offer = await publicClient.readContract({
        address: config.settlementAddress,
        abi: settlementAbi,
        functionName: "financingOffers",
        args: [receivableHash(activeReceivable.id)],
      });
      setChainFinancingOffer(offer as ChainFinancingOffer);
      setQuoteOpen(false);
      setSettlementMessage(
        `The offer for ${activeReceivable.id} is on-chain, with ${advanceAmount.toLocaleString()} mUSDC locked.`,
      );
    } catch (error) {
      const message = `Failed to submit the offer: ${getWalletErrorMessage(error, "Wallet transaction failed")}`;
      setQuoteError(message);
      setSettlementMessage(message);
    } finally {
      setSettlementSubmitting(false);
    }
  };

  const actionLabel =
    receivableStatus === "matured"
      ? settlementSubmitting
        ? "Submitting via Relayer"
        : paymentStatus === "failed"
          ? "Retry Relayer Settlement"
          : "Execute Relayer Settlement"
      : receivableStatus === "settled"
        ? settlementSubmitting
          ? "Awaiting Wallet Confirmation"
          : `Claim ${activeReceivable.amount.toLocaleString()} mUSDC`
        : financingStatus === "not_requested"
          ? "Request Financing Quote"
          : financingStatus === "offered"
            ? "Accept Non-Recourse Offer"
            : receivableStatus === "assigned"
              ? "Advance to Demo Maturity"
              : "View Settlement Certificate";
  const contextualActionLabel = `${actionLabel} · ${activeReceivable.id}`;
  const canShowAction =
    (role === "supplier" &&
      receivableStatus === "active" &&
      financingStatus === "not_requested") ||
    (role === "supplier" && financingStatus === "offered") ||
    (role === "operator" &&
      receivableStatus === "assigned" &&
      financingStatus === "funded") ||
    (role === "funder" &&
      receivableStatus === "matured" &&
      ["pending", "failed"].includes(paymentStatus)) ||
    (role === "funder" &&
      receivableStatus === "settled" &&
      ["claimable", "claiming"].includes(paymentStatus)) ||
    ["paid", "defaulted"].includes(receivableStatus);
  const proofLevel =
    proofStatus === "recorded"
      ? 4
      : proofStatus === "submitting"
        ? 2
        : proofStatus === "building"
          ? 1
          : 0;
  const totalReceivables = receivables.reduce(
    (total, receivable) => total + receivable.amount,
    0,
  );
  const quoteAdvanceAmount =
    (activeReceivable.amount * (Number(quoteAdvanceRate) || 0)) / 100;
  const quoteFinancingCost = activeReceivable.amount - quoteAdvanceAmount;
  const quoteAnnualizedYield = calculateAnnualizedYield(
    activeReceivable.amount,
    quoteAdvanceAmount,
    activeReceivable.dueDate,
  );
  const quoteRemainingDays = Math.max(
    0,
    Math.ceil(
      (new Date(`${activeReceivable.dueDate}T00:00:00Z`).getTime() -
        Date.now()) /
        (24 * 60 * 60 * 1000),
    ),
  );
  const defaultAdvanceAmount =
    (activeReceivable.amount * financingQuote.advanceRate) / 100;
  const displayedFinancingQuote = chainFinancingOffer
    ? {
        funder: `${chainFinancingOffer[0].slice(0, 8)}…${chainFinancingOffer[0].slice(-6)}`,
        advanceAmount: Number(formatUnits(chainFinancingOffer[3], 6)),
        advanceRate:
          Number(chainFinancingOffer[4]) === 0
            ? 0
            : Number(
                (chainFinancingOffer[3] * 10_000n) / chainFinancingOffer[4],
              ) / 100,
        financingCost: Number(
          formatUnits(chainFinancingOffer[4] - chainFinancingOffer[3], 6),
        ),
        annualizedYield: Number(chainFinancingOffer[5]) / 100,
        expiresAt: new Date(
          Number(chainFinancingOffer[6]) * 1000,
        ).toLocaleString("en-US"),
      }
    : {
        ...financingQuote,
        advanceAmount: defaultAdvanceAmount,
        financingCost: activeReceivable.amount - defaultAdvanceAmount,
      };
  const hasCompletedFinancing = [
    "assigned",
    "matured",
    "settled",
    "paid",
    "defaulted",
  ].includes(receivableStatus);
  const hasFinancingRequest =
    financingStatus !== "not_requested" || hasCompletedFinancing;
  const hasFinancingOffer =
    ["offered", "funded", "repaid", "in_default"].includes(financingStatus) ||
    hasCompletedFinancing;
  const hasAcceptedFinancing =
    ["funded", "repaid", "in_default"].includes(financingStatus) ||
    hasCompletedFinancing;
  const roleWorkflowMessage =
    role === "funder" &&
    receivableStatus === "active" &&
    financingStatus === "not_requested"
      ? `Waiting for the supplier to request financing for ${activeReceivable.id}.`
      : role === "supplier" && financingStatus === "quoting"
        ? `The financing request for ${activeReceivable.id} is published and awaiting a funder offer.`
        : "";

  const connectWallet = async () => {
    const connector = connectors[0];
    if (!connector)
      throw new Error(
        "No browser EVM wallet detected. Install a wallet extension first.",
      );
    const result = await connectAsync({ connector });
    return { address: result.accounts[0], chainId: result.chainId };
  };

  const login = async () => {
    if (!selectedLoginRole) return;
    setLoginMessage("");
    if (connection.address) {
      sessionStorage.setItem(sessionRoleKey, selectedLoginRole);
      window.location.assign("/");
      return;
    }
    if (!openConnectModal) {
      setLoginMessage("The wallet connection dialog is not ready yet");
      return;
    }
    setLoginSubmitting(true);
    openConnectModal();
  };

  useEffect(() => {
    if (!loginSubmitting || !selectedLoginRole || !connection.address) return;
    sessionStorage.setItem(sessionRoleKey, selectedLoginRole);
    setLoginSubmitting(false);
    window.location.assign("/");
  }, [connection.address, loginSubmitting, selectedLoginRole]);

  useEffect(() => {
    if (!isLoginPage && !initialSessionRole) window.location.replace("/login");
  }, [initialSessionRole, isLoginPage]);

  useEffect(() => {
    if (loggedIn) sessionStorage.setItem(sessionRoleKey, role);
  }, [loggedIn, role]);

  const logout = () => {
    sessionStorage.removeItem(sessionRoleKey);
    disconnect();
    setLoggedIn(false);
    setSelectedLoginRole(null);
    setLoginSubmitting(false);
    setLoginMessage("");
    window.location.assign("/login");
  };

  const confirmPayable = async () => {
    setAuthorizationMessage("");
    try {
      let address = connection.address;
      let chainId = connection.chainId;
      if (!address) {
        setAuthorizationStep("connecting");
        const connected = await connectWallet();
        address = connected.address;
        chainId = connected.chainId;
      }
      if (!address)
        throw new Error("The wallet did not return a signing address");
      if (chainId !== CREDITCOIN_TESTNET_CHAIN_ID) {
        setAuthorizationStep("switching");
        await switchChainAsync({ chainId: CREDITCOIN_TESTNET_CHAIN_ID });
      }

      const configResponse = await fetch(
        `/api/payment-authorizations/config?receivableId=${encodeURIComponent(activeReceivable.id)}`,
      );
      const configResult =
        (await configResponse.json()) as PaymentAuthorizationConfig & {
          error?: string;
        };
      if (!configResponse.ok)
        throw new Error(
          configResult.error ||
            "Unable to load the payment authorization configuration",
        );
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const typedData = buildPaymentAuthorizationTypedData(
        configResult,
        address as Address,
        nonce,
      );

      setAuthorizationStep("signing");
      setAuthorizationMessage(
        configResult.demoMode
          ? "Sign the demo EIP-3009 authorization in your wallet. This signature will not lock or transfer funds."
          : "Sign the EIP-3009 payment authorization in your wallet.",
      );
      const signature = await signTypedDataAsync(typedData);

      setAuthorizationStep("verifying");
      setAuthorizationMessage(
        "Signature complete. The server is independently verifying and saving it...",
      );
      const response = await fetch("/api/payment-authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receivableId: activeReceivable.id,
          message: serializePaymentAuthorizationMessage(typedData.message),
          signature,
        }),
      });
      const result = (await response.json()) as {
        authorizationHash?: Hex;
        verifiedAt?: string;
        message?: { from?: Address };
        error?: string;
      };
      if (!response.ok || !result.authorizationHash)
        throw new Error(
          result.error || "The server could not save the payment authorization",
        );

      setAuthorizationHash(result.authorizationHash);
      setAuthorizationSigner(result.message?.from || (address as Address));
      setAuthorizationVerifiedAt(result.verifiedAt || new Date().toISOString());
      setAuthorizationStep("verified");
      setAuthorizationMessage(
        "Payable confirmed successfully. The payment authorization was verified and saved. This signature did not lock any USDC.",
      );
      if (receivableStatus === "pending") {
        setReceivableStatus("active");
        setReceivables((items) =>
          items.map((receivable) =>
            receivable.id === activeReceivable.id
              ? { ...receivable, status: "active" }
              : receivable,
          ),
        );
        await fetch("/api/receivables", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: activeReceivable.id, status: "active" }),
        });
      }
      setPaymentStatus("authorized");
      setProofStatus("queued");
    } catch (error) {
      setAuthorizationStep("idle");
      setAuthorizationMessage(
        getWalletErrorMessage(error, "Payment authorization failed"),
      );
    }
  };

  const selectDocument =
    (kind: "contract" | "invoice") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      if (kind === "contract") setContractFile(file);
      else setInvoiceFile(file);
      setAnalysisMessage("");
    };

  const analyzeDocuments = async () => {
    if (!contractFile || !invoiceFile) {
      setAnalysisMessage("Upload both the contract and invoice files first");
      return;
    }
    setAnalyzing(true);
    setAnalysisMessage("");
    try {
      const response = await fetch("/api/analyze-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractText: await readDocumentText(contractFile),
          invoiceText: await readDocumentText(invoiceFile),
        }),
      });
      const result = (await response.json()) as Record<string, string | number>;
      if (!response.ok)
        throw new Error(String(result.error || "Document analysis failed"));
      const form = createFormRef.current;
      if (!form) return;
      for (const field of [
        "buyer",
        "supplier",
        "contractNumber",
        "invoice",
        "amount",
        "dueDate",
      ]) {
        const input = form.elements.namedItem(field);
        if (input instanceof HTMLInputElement && result[field] !== undefined)
          input.value = String(result[field]);
      }
      setAnalysisMessage(
        "Analysis complete. Review the automatically populated information.",
      );
    } catch (error) {
      setAnalysisMessage(
        error instanceof Error ? error.message : "Document analysis failed",
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const createReceivable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      buyer: String(data.get("buyer")),
      supplier: String(data.get("supplier")),
      invoice: String(data.get("invoice")),
      contractNumber: String(data.get("contractNumber")),
      amount: Number(data.get("amount")),
      dueDate: String(data.get("dueDate")),
    };
    try {
      const response = await fetch("/api/receivables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as Receivable & { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Unable to save the receivable");
      setReceivables((items) => [...items, result]);
      selectReceivable(result);
      setContractFile(null);
      setInvoiceFile(null);
      setAnalysisMessage("");
      setCreateOpen(false);
    } catch (error) {
      setAnalysisMessage(
        error instanceof Error
          ? error.message
          : "Unable to save the receivable",
      );
    }
  };

  const actionPanel = (
    <div className="next-action">
      <span>
        <Gauge size={18} />
      </span>
      <div>
        <strong>
          {activeReceivable.id} · {receivableStatusNames[receivableStatus]}
        </strong>
        <p
          className={
            paymentStatus === "failed" ||
            (authorizationMessage && authorizationStep === "idle")
              ? "authorization-error"
              : ""
          }
        >
          {settlementMessage ||
            roleWorkflowMessage ||
            authorizationMessage ||
            (receivableStatus === "pending"
              ? `Waiting for the buyer to confirm the ${activeReceivable.amount.toLocaleString()} mUSDC payable and sign the maturity payment authorization.`
              : receivableStatus === "active"
                ? "The payable is confirmed and eligible for non-recourse financing."
                : receivableStatus === "settled"
                  ? `On-chain settlement is complete. ${activeReceivable.amount.toLocaleString()} mUSDC is available for the funder to claim. Use the funder wallet associated with this receivable.`
                  : "Continue the workflow to view ownership and settlement status updates.")}
        </p>
      </div>
      {role === "buyer" &&
      (receivableStatus === "pending" || !authorizationHash) ? (
        <button
          className="primary"
          disabled={authorizationStep !== "idle"}
          onClick={() => void confirmPayable()}
        >
          {authorizationStep !== "idle" ? (
            <LoaderCircle className="spin" size={14} />
          ) : null}
          {authorizationStep === "connecting"
            ? "Connecting Wallet"
            : authorizationStep === "switching"
              ? "Switching to CC3"
              : authorizationStep === "signing"
                ? "Awaiting Wallet Signature"
                : authorizationStep === "verifying"
                  ? "Verifying Signature"
                  : `Confirm Payable · ${activeReceivable.id}`}
        </button>
      ) : role === "funder" && financingStatus === "quoting" ? (
        <button
          className="primary"
          disabled={settlementSubmitting}
          onClick={openQuoteEditor}
        >
          Create and Submit Offer · {activeReceivable.id}
        </button>
      ) : canShowAction ? (
        <button
          className="secondary"
          disabled={settlementSubmitting}
          onClick={() => void advance()}
        >
          {settlementSubmitting && <LoaderCircle className="spin" size={14} />}
          {contextualActionLabel}
        </button>
      ) : null}
    </div>
  );

  if (isLoginPage) {
    return (
      <main className="login-page">
        <section className="login-shell" aria-labelledby="login-title">
          <header className="login-brand">
            <span>
              <ShieldCheck size={20} />
            </span>
            <strong>
              Attest<em>Flow</em>
            </strong>
            <small>CREDITCOIN CC3</small>
          </header>
          <div className="login-heading">
            <small>SECURE WORKSPACE</small>
            <h1 id="login-title">Choose Your Role</h1>
            <p>Your role determines workspace permissions. Select a role, then connect the corresponding wallet account.</p>
          </div>
          <div className="role-grid">
            {loginRoles.map((item, index) => (
              <button
                className={selectedLoginRole === item ? "selected" : ""}
                key={item}
                onClick={() => {
                  setSelectedLoginRole(item);
                  setLoginMessage("");
                }}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{roleNames[item]}</strong>
                  <small>{roleDescriptions[item]}</small>
                </div>
                {selectedLoginRole === item && <Check size={16} />}
              </button>
            ))}
          </div>
          <button
            className="wallet-login"
            disabled={!selectedLoginRole}
            onClick={() => void login()}
          >
            {loginSubmitting ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <WalletCards size={17} />
            )}
            {loginSubmitting
              ? "Connect in Wallet Dialog"
              : selectedLoginRole
                ? `Sign In as ${roleNames[selectedLoginRole]}`
                : "Select a Role First"}
          </button>
          {loginMessage && <p className="login-error">{loginMessage}</p>}
          <footer>
            <i />
            Creditcoin Testnet <span>Wallet addresses are used only for identity and on-chain signatures</span>
          </footer>
        </section>
      </main>
    );
  }

  if (!loggedIn) return null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>
            <ShieldCheck size={18} />
          </span>
          <strong>
            Attest<em>Flow</em>
          </strong>
        </div>
        <nav>
          <small>BUSINESS</small>
          <button
            className="active"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <LayoutDashboard size={17} />
            Workspace
          </button>
          <button onClick={() => goTo("receivable")}>
            <FileCheck2 size={17} />
            Receivables<b>1</b>
          </button>
          <button onClick={() => goTo("settlement")}>
            <WalletCards size={17} />
            Settlement
          </button>
          <button onClick={() => goTo("activity")}>
            <History size={17} />
            Audit Trail
          </button>
          <small>MANAGEMENT</small>
          <button>
            <Building2 size={17} />
            Organizations & Members
          </button>
          <button>
            <Settings size={17} />
            Business Settings
          </button>
        </nav>
        <div className="mock-note">
          <div>
            <Sparkles size={15} />
            <strong>CC3 Credit Financing Demo</strong>
          </div>
          <p>Confirmation without fund lock · Non-recourse financing · USDC settlement at maturity</p>
          <button
            onClick={() => {
              setReceivableStatus(authorizationHash ? "active" : "pending");
              setFinancingStatus("not_requested");
              setPaymentStatus(authorizationHash ? "authorized" : "not_due");
              setProofStatus(authorizationHash ? "queued" : "not_started");
              setAuthorizationStep(authorizationHash ? "verified" : "idle");
              setAuthorizationMessage(
                authorizationHash
                  ? "The payment authorization was verified and saved by the server. No USDC was locked."
                  : "",
              );
              setSettlementMessage("");
              setSettlementTransactionHash(null);
              setClaimTransactionHash(null);
              setRole("supplier");
              setSelectedReceivable(activeReceivable);
            }}
          >
            <RefreshCcw size={14} />
            Reset Demo
          </button>
        </div>
        <div className="side-user">
          <span>{roleNames[role][0]}</span>
          <div>
            <strong>{roleNames[role]} Account</strong>
            <small>
              {connection.address
                ? `${connection.address.slice(0, 6)}…${connection.address.slice(-4)}`
                : "Wallet Session"}
            </small>
          </div>
          <button title="Sign out and switch roles" onClick={logout}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main>
        <header>
          <label>
            <Search size={16} />
            <input placeholder="Search receivables, invoices, or organizations" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="header-actions">
            <span className="network">
              <i />
              CREDITCOIN CC3
            </span>
            <span className="role-identity">{roleNames[role]}</span>
            <button className="wallet-chip" onClick={logout} title="Sign out">
              <WalletCards size={14} />
              {connection.address
                ? `${connection.address.slice(0, 6)}…${connection.address.slice(-4)}`
                : "Wallet Session"}
              <LogOut size={13} />
            </button>
            <button className="icon">
              <Bell size={17} />
            </button>
          </div>
        </header>

        <div className="content">
          <section className="page-title">
            <div>
              <small>CREDIT RECEIVABLE FINANCING PROTOCOL · RWA</small>
              <h1>{roleNames[role]} Workspace</h1>
              <p>The buyer confirms the obligation without locking funds upfront, while the funder provides non-recourse financing based on credit.</p>
            </div>
          </section>

          <section className="metrics">
            <article>
              <span className="mint">
                <FileText size={18} />
              </span>
              <div>
                <small>Receivables Balance</small>
                <strong>${totalReceivables.toLocaleString()}</strong>
                <p>{receivables.length} active certificates</p>
              </div>
            </article>
            <article>
              <span className="blue">
                <CircleDollarSign size={18} />
              </span>
              <div>
                <small>Financing Received</small>
                <strong>
                  {["funded", "repaid", "in_default"].includes(financingStatus)
                    ? "$96,840"
                    : "$0"}
                </strong>
                <p>Non-recourse · Funder assumes credit risk</p>
              </div>
            </article>
            <article>
              <span className="amber">
                <Clock3 size={18} />
              </span>
              <div>
                <small>Pending Actions</small>
                <strong>
                  {receivables.length === 0 || receivableStatus === "paid"
                    ? "0"
                    : "1"}
                </strong>
                <p>
                  {receivables.length === 0
                    ? "No receivables"
                    : receivableStatusNames[receivableStatus]}
                </p>
              </div>
            </article>
            <article>
              <span className="green">
                <ShieldCheck size={18} />
              </span>
              <div>
                <small>Available Credit</small>
                <strong>$500,000</strong>
                <p>$100,000 utilized · Not a cash balance</p>
              </div>
            </article>
          </section>

          <section className="workspace">
            <article className="panel receivable" id="receivable">
              <div className="panel-head">
                <div>
                  <h2>Core Receivables</h2>
                  <p>Full lifecycle of the current demo transaction</p>
                </div>
                <button onClick={() => setCreateOpen(true)}>
                  <Plus size={14} />
                  New Receivable
                </button>
              </div>
              {receivables.map((receivable) => {
                const currentStatus =
                  receivable.id === activeReceivable.id
                    ? receivableStatus
                    : receivable.status;
                const isCurrent = receivable.id === activeReceivable.id;
                return (
                  <div
                    className={`receivable-row ${isCurrent ? "selected" : ""}`}
                    key={receivable.id}
                  >
                    <button
                      className="receivable-select"
                      onClick={() =>
                        selectReceivable(receivable, currentStatus)
                      }
                      aria-label={`Select receivable ${receivable.id}`}
                    >
                      <span className="company">
                        {receivable.buyer.slice(0, 2)}
                      </span>
                      <div>
                        <strong>
                          {receivable.buyer}
                          {isCurrent && <em>Current</em>}
                        </strong>
                        <small>
                          {receivable.id} · {receivable.invoice}
                        </small>
                      </div>
                      <div className="amount">
                        <strong>${receivable.amount.toLocaleString()}</strong>
                        <small>Due {receivable.dueDate}</small>
                      </div>
                      <span className={`status ${currentStatus}`}>
                        {receivableStatusNames[currentStatus]}
                      </span>
                    </button>
                  </div>
                );
              })}
            </article>

            <article className="panel activity" id="activity">
              <div className="panel-head">
                <div>
                  <h2>Recent Activity</h2>
                  <p>Auditable events across the full workflow</p>
                </div>
                <MoreHorizontal size={17} />
              </div>
              {hasFinancingOffer && (
                <div className="financing-quote">
                  <div>
                    <small>Funder</small>
                    <strong>{displayedFinancingQuote.funder}</strong>
                  </div>
                  <div>
                    <small>Advance Amount</small>
                    <strong>
                      ${displayedFinancingQuote.advanceAmount.toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <small>Advance Rate</small>
                    <strong>{displayedFinancingQuote.advanceRate}%</strong>
                  </div>
                  <div>
                    <small>Financing Cost</small>
                    <strong>
                      ${displayedFinancingQuote.financingCost.toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <small>Annualized Yield</small>
                    <strong>{displayedFinancingQuote.annualizedYield}%</strong>
                  </div>
                  <div>
                    <small>Recourse</small>
                    <strong>Non-Recourse</strong>
                  </div>
                  <p>
                    Offer valid until {displayedFinancingQuote.expiresAt}. Settlement at maturity is based on the receivable face value of $
                    {activeReceivable.amount.toLocaleString()}.
                  </p>
                </div>
              )}
              {receivables.length > 0 && <div className="events">
                <div>
                  <i className="green" />
                  <span>
                    <strong>Trade Documents Validated</strong>
                    <p>Three-way matching complete with no duplicate financing detected</p>
                    <small>Today 09:43</small>
                  </span>
                </div>
                <div>
                  <i className="blue" />
                  <span>
                    <div className="event-title">
                      <strong>Confirmation Request Submitted</strong>
                      {authorizationStep === "verified" &&
                        authorizationHash && (
                          <em>
                            <Check size={10} />
                            Payment authorization verified and saved
                          </em>
                        )}
                    </div>
                    <p>Huachen Precision submitted the invoice and acceptance record</p>
                    {authorizationStep === "verified" && authorizationHash && (
                      <code
                        className="event-authorization"
                        title={authorizationHash}
                      >
                        {authorizationSigner
                          ? `${authorizationSigner.slice(0, 8)}…${authorizationSigner.slice(-6)}`
                          : "Signing wallet verified"}{" "}
                        ·{" "}
                        {authorizationVerifiedAt
                          ? new Date(authorizationVerifiedAt).toLocaleString(
                              "en-US",
                            )
                          : "Time pending"}{" "}
                        · {authorizationHash.slice(0, 10)}…
                        {authorizationHash.slice(-8)}
                      </code>
                    )}
                    <small>Today 09:42</small>
                  </span>
                </div>
                {hasFinancingRequest && (
                  <div>
                    <i className="blue" />
                    <span>
                      <strong>Supplier Requested Financing</strong>
                      <p>
                        The supplier published the {activeReceivable.amount.toLocaleString()}{" "}
                        mUSDC receivable on-chain and is awaiting a funder offer
                      </p>
                      <small>
                        {financingRequestedAt
                          ? new Date(financingRequestedAt).toLocaleString(
                              "en-US",
                            )
                          : "On-chain record confirmed"}
                      </small>
                    </span>
                  </div>
                )}
                {hasFinancingOffer && (
                  <div>
                    <i className="blue" />
                    <span>
                      <strong>Funder Submitted an Offer</strong>
                      <p>
                        {displayedFinancingQuote.funder} offered{" "}
                        {displayedFinancingQuote.advanceAmount.toLocaleString()}{" "}
                        mUSDC at an annualized yield of{" "}
                        {displayedFinancingQuote.annualizedYield}%
                      </p>
                      <small>
                        {financingOfferedAt
                          ? new Date(financingOfferedAt).toLocaleString("en-US")
                          : "On-chain record confirmed"}
                      </small>
                    </span>
                  </div>
                )}
                {hasAcceptedFinancing && (
                  <div>
                    <i className="green" />
                    <span>
                      <strong>Supplier Accepted the Offer</strong>
                      <p>
                        The supplier accepted the on-chain offer. 
                        {displayedFinancingQuote.advanceAmount.toLocaleString()}{" "}
                        mUSDC was disbursed, completing the receivable transfer
                      </p>
                      <small>
                        {financingAcceptedAt
                          ? new Date(financingAcceptedAt).toLocaleString(
                              "en-US",
                            )
                          : "On-chain record confirmed"}
                      </small>
                    </span>
                  </div>
                )}
                <div>
                  <i
                    className={
                      ["settled", "paid"].includes(receivableStatus)
                        ? "green"
                        : "blue"
                    }
                  />
                  <span>
                    <strong>Maturity Settlement</strong>
                    <p>
                      {receivableStatus === "paid"
                        ? "The funder has claimed the settlement funds"
                        : receivableStatus === "settled"
                          ? "On-chain settlement is complete and awaiting the funder's claim"
                          : receivableStatus === "matured"
                            ? "The certificate has matured and on-chain settlement can be executed"
                            : `Settlement is scheduled for maturity on ${activeReceivable.dueDate}`}
                    </p>
                    <small>
                      {receivableStatus === "paid"
                        ? "Complete"
                        : receivableStatus === "settled"
                          ? "Awaiting Claim"
                          : receivableStatus === "matured"
                            ? "Ready"
                            : "Awaiting Maturity"}
                    </small>
                  </span>
                </div>
              </div>}
              {receivables.length > 0 && (
                <div className="activity-workflow">{actionPanel}</div>
              )}
            </article>
          </section>

          {receivables.length > 0 && (
            <>
          <section className="panel proof-panel" id="proof">
            <div className="panel-head">
              <div>
                <h2>CC3 Audit Proof</h2>
                <p>Generate an evidence commitment from a real source transaction and register it asynchronously on Creditcoin CC3</p>
              </div>
              <span
                className={`proof-badge ${proofStatus === "recorded" ? "verified" : ""}`}
              >
                <i />
                {proofStatus === "not_started"
                  ? "Awaiting Buyer Confirmation"
                  : proofStatus === "waiting_source" || proofStatus === "queued"
                    ? "Awaiting Source Transaction"
                    : proofStatus === "building"
                      ? "Building Evidence"
                      : proofStatus === "submitting"
                        ? "Registering On-Chain"
                        : proofStatus === "recorded"
                          ? "Audit Proof Recorded"
                          : "Proof Task Failed"}
              </span>
            </div>
            <div className="proof-flow">
              {[
                [
                  "1",
                  "Source transaction",
                  "Creditcoin CC3",
                  auditProofJob?.sourceTransactionHash
                    ? `${auditProofJob.sourceTransactionHash.slice(0, 10)}…${auditProofJob.sourceTransactionHash.slice(-8)}`
                    : "Waiting for financing request",
                ],
                [
                  "2",
                  "Evidence commitment",
                  "Evidence Builder",
                  auditProofJob?.evidenceHash
                    ? `${auditProofJob.evidenceHash.slice(0, 10)}…${auditProofJob.evidenceHash.slice(-8)}`
                    : "Pending",
                ],
                [
                  "3",
                  "CC3 registry",
                  "AuditProofRegistry",
                  auditProofJob?.registrationTransactionHash
                    ? `${auditProofJob.registrationTransactionHash.slice(0, 10)}…${auditProofJob.registrationTransactionHash.slice(-8)}`
                    : "Pending",
                ],
                [
                  "4",
                  "Audit proof recorded",
                  "Verified Receivable",
                  auditProofJob?.registeredAt
                    ? new Date(auditProofJob.registeredAt).toLocaleString(
                        "en-US",
                      )
                    : activeReceivable.id,
                ],
              ].map(([number, title, system, evidence], index) => {
                const complete = proofLevel > index;
                const current =
                  proofStatus !== "not_started" &&
                  proofStatus !== "failed" &&
                  proofLevel === index;
                return (
                  <div
                    className={`proof-step ${complete ? "complete" : ""} ${current ? "current" : ""}`}
                    key={title}
                  >
                    <span>{complete ? <Check size={14} /> : number}</span>
                    <small>{system}</small>
                    <strong>{title}</strong>
                    <code>
                      {proofLevel === 0 && index > 0 ? "Pending" : evidence}
                    </code>
                  </div>
                );
              })}
            </div>
            <div className="proof-foot">
              <ShieldCheck size={15} />
              <p>
                {auditProofJob?.error ||
                  "The proof audits transaction facts. It does not indicate sufficient buyer funds, locked funds, or guaranteed repayment."}
              </p>
              {auditProofJob?.registrationTransactionHash ? (
                <a
                  href={`https://creditcoin-testnet.blockscout.com/tx/${auditProofJob.registrationTransactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Registration Transaction
                  <ArrowRight size={13} />
                </a>
              ) : (
                <button onClick={() => goTo("receivable")}>
                  View Asset
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </section>

          <section className="panel protocol" id="settlement">
            <div className="protocol-title">
              <span>
                <Zap size={19} />
              </span>
              <div>
                <h2>Maturity Settlement Monitor</h2>
                <p>EIP-3009 future authorization · Restricted relayer · Funder wallet claim</p>
              </div>
            </div>
            <div className="protocol-stats">
              <div>
                <small>Settlement Status</small>
                <strong>
                  {paymentStatus === "paid"
                    ? "Claimed by Funder"
                    : paymentStatus === "claiming"
                      ? "Awaiting Wallet Confirmation"
                      : paymentStatus === "claimable"
                        ? "Awaiting Funder Claim"
                        : paymentStatus === "failed"
                          ? "Relayer Settlement Failed"
                          : paymentStatus === "pending"
                            ? "Ready for Settlement"
                            : paymentStatus === "authorized"
                              ? "Verified and Saved"
                              : "Awaiting Signature"}
                </strong>
              </div>
              <div>
                <small>Business Due Date</small>
                <strong>{activeReceivable.dueDate} UTC</strong>
              </div>
              <div>
                <small>Buyer Signing Wallet</small>
                <strong>
                  {authorizationSigner
                    ? `${authorizationSigner.slice(0, 6)}…${authorizationSigner.slice(-4)}`
                    : "Not Signed"}
                </strong>
              </div>
              <div>
                <small>Authorization Hash</small>
                <strong title={authorizationHash || ""}>
                  {authorizationHash
                    ? `${authorizationHash.slice(0, 8)}…${authorizationHash.slice(-6)}`
                    : "Not Generated"}
                </strong>
              </div>
            </div>
            {(settlementTransactionHash || claimTransactionHash) && (
              <div className="balance-buttons">
                {settlementTransactionHash && (
                  <a
                    href={`https://creditcoin-testnet.blockscout.com/tx/${settlementTransactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View Relayer Settlement Transaction
                  </a>
                )}
                {claimTransactionHash && (
                  <a
                    href={`https://creditcoin-testnet.blockscout.com/tx/${claimTransactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View Fund Claim Transaction
                  </a>
                )}
              </div>
            )}
          </section>
            </>
          )}
        </div>
      </main>
      {quoteOpen && (
        <>
          <button
            className="drawer-scrim"
            aria-label="Close offer"
            disabled={settlementSubmitting}
            onClick={() => setQuoteOpen(false)}
          />
          <div
            className="create-modal quote-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quote-title"
          >
            <div className="drawer-head">
              <div>
                <small>NON-RECOURSE OFFER</small>
                <h2 id="quote-title">Submit Non-Recourse Financing Offer</h2>
              </div>
              <button
                aria-label="Close"
                disabled={settlementSubmitting}
                onClick={() => setQuoteOpen(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={submitFinancingQuote}>
              <div className="quote-context">
                <span>
                  <small>Receivable</small>
                  <strong>{activeReceivable.id}</strong>
                </span>
                <span>
                  <small>Face Value</small>
                  <strong>
                    {activeReceivable.amount.toLocaleString()} mUSDC
                  </strong>
                </span>
              </div>
              <div className="form-grid">
                <label>
                  Advance Rate (%)
                  <input
                    required
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={quoteAdvanceRate}
                    onChange={(event) =>
                      setQuoteAdvanceRate(event.target.value)
                    }
                  />
                </label>
                <label>
                  Calculated Annualized Yield (%)
                  <output className="quote-output">
                    {quoteAnnualizedYield === null
                      ? "Unavailable"
                      : quoteAnnualizedYield.toFixed(2)}
                  </output>
                  <small>Calculated using {quoteRemainingDays} days until maturity</small>
                </label>
              </div>
              <label>
                Offer Expiration
                <input
                  required
                  type="datetime-local"
                  value={quoteValidUntil}
                  onChange={(event) => setQuoteValidUntil(event.target.value)}
                />
              </label>
              <div className="quote-summary">
                <span>
                  <small>Advance Amount</small>
                  <strong>
                    {quoteAdvanceAmount.toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}{" "}
                    mUSDC
                  </strong>
                </span>
                <span>
                  <small>Financing Cost</small>
                  <strong>
                    {quoteFinancingCost.toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}{" "}
                    mUSDC
                  </strong>
                </span>
              </div>
              <p>
                After submission, the advance amount will be locked in the settlement contract. When the supplier accepts, the contract will disburse the funds and complete the receivable transfer.
              </p>
              {quoteError && <p className="analysis-message">{quoteError}</p>}
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={settlementSubmitting}
                  onClick={() => setQuoteOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={settlementSubmitting}
                >
                  {settlementSubmitting ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <CircleDollarSign size={14} />
                  )}
                  {settlementSubmitting ? "Awaiting Wallet Confirmation" : "Confirm and Submit On-Chain Offer"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
      {createOpen && (
        <>
          <button
            className="drawer-scrim"
            aria-label="Close new receivable"
            onClick={() => setCreateOpen(false)}
          />
          <div
            className="create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
          >
            <div className="drawer-head">
              <div>
                <small>NEW RECEIVABLE</small>
                <h2 id="create-title">Create Core Receivable</h2>
              </div>
              <button aria-label="Close" onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </div>
            <form ref={createFormRef} onSubmit={createReceivable}>
              <section className="document-upload">
                <div>
                  <strong>Upload Trade Documents</strong>
                  <small>AI will read the contract and invoice and populate the fields below</small>
                </div>
                <div className="upload-grid">
                  <label className={contractFile ? "has-file" : ""}>
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,.json,.csv,application/pdf,text/plain"
                      onChange={selectDocument("contract")}
                    />
                    <Upload size={18} />
                    <span>
                      <strong>{contractFile?.name || "Upload Contract"}</strong>
                      <small>PDF, TXT, MD, JSON, or CSV</small>
                    </span>
                    {contractFile && <Check size={15} />}
                  </label>
                  <label className={invoiceFile ? "has-file" : ""}>
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,.json,.csv,application/pdf,text/plain"
                      onChange={selectDocument("invoice")}
                    />
                    <Upload size={18} />
                    <span>
                      <strong>{invoiceFile?.name || "Upload Invoice"}</strong>
                      <small>PDF, TXT, MD, JSON, or CSV</small>
                    </span>
                    {invoiceFile && <Check size={15} />}
                  </label>
                </div>
                <button
                  className="analyze-button"
                  type="button"
                  disabled={analyzing}
                  onClick={analyzeDocuments}
                >
                  {analyzing ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {analyzing ? "Analyzing Trade Documents..." : "Analyze and Populate with AI"}
                </button>
                {analysisMessage && (
                  <p className="analysis-message">{analysisMessage}</p>
                )}
              </section>
              <div className="form-grid">
                <label>
                  Buyer
                  <input
                    name="buyer"
                    required
                    placeholder="e.g. Global Manufacturing Group"
                  />
                </label>
                <label>
                  Original Supplier
                  <input
                    name="supplier"
                    required
                    placeholder="e.g. Huachen Precision Co., Ltd."
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Contract Number
                  <input
                    name="contractNumber"
                    required
                    placeholder="SC-2026-0818"
                  />
                </label>
                <label>
                  Invoice Number
                  <input name="invoice" required placeholder="INV-8892" />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Receivable Amount (USDC)
                  <input
                    name="amount"
                    required
                    type="number"
                    min="1"
                    step="1"
                    placeholder="100000"
                  />
                </label>
                <label>
                  Due Date
                  <input name="dueDate" required type="date" />
                </label>
              </div>
              <p>
                After submission, the certificate will enter Awaiting Buyer Confirmation status. AI analysis is for data entry assistance only; review all fields before submitting.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary">
                  <Plus size={14} />
                  Create Receivable
                </button>
              </div>
            </form>
          </div>
        </>
      )}
      {detailOpen && (
        <>
          <button
            className="drawer-scrim"
            aria-label="Close details"
            onClick={() => setDetailOpen(false)}
          />
          <aside className="drawer">
            <div className="drawer-head">
              <div>
                <small>Digital Receivable Certificate</small>
                <h2>{selectedReceivable.id}</h2>
              </div>
              <button aria-label="Close" onClick={() => setDetailOpen(false)}>
                ×
              </button>
            </div>
            <div className="certificate">
              <span className={`status ${selectedReceivable.status}`}>
                {receivableStatusNames[selectedReceivable.status]}
              </span>
              <strong>${selectedReceivable.amount.toLocaleString()}</strong>
              <small>Due {selectedReceivable.dueDate}</small>
              <FileCheck2 size={40} />
            </div>
            <section>
              <h3>Transaction Parties</h3>
              <dl>
                <div>
                  <dt>Buyer</dt>
                  <dd>{selectedReceivable.buyer}</dd>
                </div>
                <div>
                  <dt>Original Supplier</dt>
                  <dd>{selectedReceivable.supplier}</dd>
                </div>
                <div>
                  <dt>Current Rights Holder</dt>
                  <dd>
                    {[
                      "assigned",
                      "matured",
                      "settled",
                      "paid",
                      "defaulted",
                    ].includes(selectedReceivable.status)
                      ? "Yuanhai Capital"
                      : selectedReceivable.supplier}
                  </dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>Trade Documents</h3>
              <dl>
                <div>
                  <dt>Contract Number</dt>
                  <dd>{selectedReceivable.contractNumber}</dd>
                </div>
                <div>
                  <dt>Invoice Number</dt>
                  <dd>{selectedReceivable.invoice}</dd>
                </div>
                <div>
                  <dt>Acceptance Status</dt>
                  <dd className="verified">
                    <Check size={13} />
                    Verified
                  </dd>
                </div>
              </dl>
            </section>
            <section>
              <h3>Dual-Signature Binding</h3>
              <div className="signatures">
                <div>
                  <ShieldCheck size={17} />
                  <span>
                    <strong>Approved Payable</strong>
                    <small>0x2e84...90c1</small>
                  </span>
                </div>
                <div>
                  <Zap size={17} />
                  <span>
                    <strong>Payment Authorization</strong>
                    <small>0x79ad...38e2</small>
                  </span>
                </div>
              </div>
            </section>
            <p className="legal">
              This certificate is a non-recourse digital receivable record in a demo environment. Payment authorization does not freeze funds or guarantee buyer repayment at maturity.
            </p>
          </aside>
        </>
      )}
    </div>
  );
}

export default App;
