// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ReceivableAttestationSource {
    error InvalidAttestation();

    event ReceivableAttested(
        bytes32 indexed receivableIdHash,
        bytes32 indexed evidenceHash,
        address indexed buyer
    );

    function attest(bytes32 receivableIdHash, bytes32 evidenceHash) external {
        if (receivableIdHash == bytes32(0) || evidenceHash == bytes32(0)) revert InvalidAttestation();
        emit ReceivableAttested(receivableIdHash, evidenceHash, msg.sender);
    }
}