// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AuditProofRegistry is Ownable {
    struct AuditProof {
        bytes32 sourceTransactionHash;
        bytes32 evidenceHash;
        uint64 registeredAt;
        address registrar;
    }

    mapping(bytes32 receivableIdHash => AuditProof proof) public proofs;

    error ProofAlreadyRegistered(bytes32 receivableIdHash);
    error InvalidProof();

    event AuditProofRegistered(
        bytes32 indexed receivableIdHash,
        bytes32 indexed sourceTransactionHash,
        bytes32 indexed evidenceHash,
        address registrar
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerProof(
        bytes32 receivableIdHash,
        bytes32 sourceTransactionHash,
        bytes32 evidenceHash
    ) external onlyOwner {
        if (receivableIdHash == bytes32(0) || sourceTransactionHash == bytes32(0) || evidenceHash == bytes32(0)) {
            revert InvalidProof();
        }
        if (proofs[receivableIdHash].registeredAt != 0) revert ProofAlreadyRegistered(receivableIdHash);

        proofs[receivableIdHash] = AuditProof({
            sourceTransactionHash: sourceTransactionHash,
            evidenceHash: evidenceHash,
            registeredAt: uint64(block.timestamp),
            registrar: msg.sender
        });
        emit AuditProofRegistered(receivableIdHash, sourceTransactionHash, evidenceHash, msg.sender);
    }
}