// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AuditProofRegistry is Ownable {
    bytes32 public constant RECEIVABLE_ATTESTED_EVENT_SIGNATURE =
        keccak256("ReceivableAttested(bytes32,bytes32,address)");

    struct AuditProof {
        bytes32 queryId;
        bytes32 evidenceHash;
        address buyer;
        uint64 registeredAt;
        address registrar;
    }

    INativeQueryVerifier public immutable verifier;
    uint64 public immutable sourceChainKey;
    address public immutable sourceContract;

    mapping(bytes32 receivableIdHash => AuditProof proof) public proofs;
    mapping(bytes32 queryId => bool processed) public processedQueries;

    error InvalidProof();
    error InvalidSourceChain(uint64 chainKey);
    error InvalidSourceContract(address source);
    error ProofAlreadyRegistered(bytes32 receivableIdHash);
    error QueryAlreadyProcessed(bytes32 queryId);

    event AuditProofRegistered(
        bytes32 indexed receivableIdHash,
        bytes32 indexed queryId,
        bytes32 indexed evidenceHash,
        address buyer,
        address registrar
    );

    constructor(address initialOwner, uint64 expectedSourceChainKey, address expectedSourceContract) Ownable(initialOwner) {
        if (expectedSourceChainKey == 0 || expectedSourceContract == address(0)) revert InvalidProof();
        verifier = NativeQueryVerifierLib.getVerifier();
        sourceChainKey = expectedSourceChainKey;
        sourceContract = expectedSourceContract;
    }

    function registerProof(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external onlyOwner returns (bool) {
        if (chainKey != sourceChainKey) revert InvalidSourceChain(chainKey);

        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
        INativeQueryVerifier.ContinuityProof memory continuityProof = INativeQueryVerifier.ContinuityProof({
            lowerEndpointDigest: lowerEndpointDigest,
            roots: continuityRoots
        });
        uint64 transactionIndex = verifier.calculateTxIndex(merkleProof);
        bytes32 queryId = keccak256(abi.encode(chainKey, blockHeight, transactionIndex));
        if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);
        if (!verifier.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof)) {
            revert InvalidProof();
        }

        EvmV1Decoder.CommonTxFields memory transaction = EvmV1Decoder.decodeCommonTxFields(encodedTransaction);
        if (transaction.toIsNull || transaction.to != sourceContract) {
            revert InvalidSourceContract(transaction.to);
        }

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert InvalidProof();

        (bytes32 receivableIdHash, bytes32 evidenceHash, address buyer) = _readAttestation(receipt);
        if (buyer != transaction.from) revert InvalidProof();
        if (proofs[receivableIdHash].registeredAt != 0) revert ProofAlreadyRegistered(receivableIdHash);

        processedQueries[queryId] = true;
        proofs[receivableIdHash] = AuditProof({
            queryId: queryId,
            evidenceHash: evidenceHash,
            buyer: buyer,
            registeredAt: uint64(block.timestamp),
            registrar: msg.sender
        });
        emit AuditProofRegistered(receivableIdHash, queryId, evidenceHash, buyer, msg.sender);
        return true;
    }

    function isVerified(bytes32 receivableIdHash) external view returns (bool) {
        return proofs[receivableIdHash].registeredAt != 0;
    }

    function _readAttestation(
        EvmV1Decoder.ReceiptFields memory receipt
    ) internal view returns (bytes32 receivableIdHash, bytes32 evidenceHash, address buyer) {
        EvmV1Decoder.LogEntry[] memory logs =
            EvmV1Decoder.getLogsByEventSignature(receipt, RECEIVABLE_ATTESTED_EVENT_SIGNATURE);
        for (uint256 index; index < logs.length; ++index) {
            EvmV1Decoder.LogEntry memory entry = logs[index];
            if (entry.address_ != sourceContract || entry.topics.length != 4 || entry.data.length != 0) continue;

            receivableIdHash = entry.topics[1];
            evidenceHash = entry.topics[2];
            buyer = address(uint160(uint256(entry.topics[3])));
            if (receivableIdHash != bytes32(0) && evidenceHash != bytes32(0) && buyer != address(0)) {
                return (receivableIdHash, evidenceHash, buyer);
            }
        }
        revert InvalidProof();
    }
}