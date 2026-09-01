// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC3009Token is IERC20 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

contract ReceivableSettlement is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct FinancingOffer {
        address funder;
        address supplier;
        address token;
        uint256 principal;
        uint256 faceValue;
        uint256 annualizedYieldBps;
        uint64 validUntil;
        bool accepted;
    }

    struct FinancingRequest {
        address supplier;
        address token;
        uint256 faceValue;
    }

    mapping(address token => bool allowed) public allowedTokens;
    mapping(address account => bool allowed) public operators;
    mapping(bytes32 receivableIdHash => FinancingRequest request) public financingRequests;
    mapping(bytes32 receivableIdHash => FinancingOffer offer) public financingOffers;
    mapping(bytes32 receivableIdHash => bool settled) public settledReceivables;
    mapping(bytes32 authorizationHash => bool used) public usedAuthorizations;
    mapping(address token => mapping(address account => uint256 amount)) public claimable;
    mapping(address token => uint256 amount) public totalLiability;

    error AlreadySettled(bytes32 receivableIdHash);
    error AuthorizationAlreadyUsed(bytes32 authorizationHash);
    error InvalidOffer(bytes32 receivableIdHash);
    error InvalidAmount();
    error InvalidRecipient();
    error OfferAlreadyExists(bytes32 receivableIdHash);
    error OfferExpired(bytes32 receivableIdHash);
    error OfferNotExpired(bytes32 receivableIdHash);
    error OnlyOperator(address caller);
    error OnlySupplier(address caller);
    error TokenNotAllowed(address token);
    error TransferAmountMismatch(uint256 expected, uint256 received);

    event OperatorUpdated(address indexed operator, bool allowed);
    event ReceivableSettled(
        bytes32 indexed receivableIdHash,
        bytes32 indexed authorizationHash,
        address indexed payer,
        address token,
        address recipient,
        uint256 amount
    );
    event ReceivableSettledAndTransferred(
        bytes32 indexed receivableIdHash,
        bytes32 indexed authorizationHash,
        address indexed payer,
        address token,
        address recipient,
        uint256 amount
    );
    event TokenAllowed(address indexed token, bool allowed);
    event FinancingRequested(
        bytes32 indexed receivableIdHash,
        address indexed supplier,
        address indexed token,
        uint256 faceValue
    );
    event FinancingOfferSubmitted(
        bytes32 indexed receivableIdHash,
        address indexed funder,
        address indexed supplier,
        address token,
        uint256 principal,
        uint256 faceValue,
        uint256 annualizedYieldBps,
        uint64 validUntil
    );
    event FinancingOfferAccepted(bytes32 indexed receivableIdHash, address indexed supplier, address indexed funder);
    event FinancingOfferCancelled(bytes32 indexed receivableIdHash, address indexed funder, uint256 principal);
    event Claimed(address indexed token, address indexed account, uint256 amount);

    constructor(address initialOwner, address initialToken) Ownable(initialOwner) {
        if (initialToken == address(0)) revert TokenNotAllowed(address(0));
        operators[initialOwner] = true;
        allowedTokens[initialToken] = true;
        emit OperatorUpdated(initialOwner, true);
        emit TokenAllowed(initialToken, true);
    }

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert OnlyOperator(msg.sender);
        _;
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        if (operator == address(0)) revert InvalidRecipient();
        operators[operator] = allowed;
        emit OperatorUpdated(operator, allowed);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert TokenNotAllowed(address(0));
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function requestFinancing(bytes32 receivableIdHash, address token, uint256 faceValue) external whenNotPaused {
        if (!allowedTokens[token]) revert TokenNotAllowed(token);
        if (faceValue == 0) revert InvalidAmount();
        if (financingRequests[receivableIdHash].supplier != address(0)) revert OfferAlreadyExists(receivableIdHash);

        financingRequests[receivableIdHash] = FinancingRequest({
            supplier: msg.sender,
            token: token,
            faceValue: faceValue
        });
        emit FinancingRequested(receivableIdHash, msg.sender, token, faceValue);
    }

    function submitOffer(
        bytes32 receivableIdHash,
        uint256 principal,
        uint256 annualizedYieldBps,
        uint64 validUntil
    ) external whenNotPaused nonReentrant {
        FinancingRequest memory request = financingRequests[receivableIdHash];
        if (request.supplier == address(0)) revert InvalidOffer(receivableIdHash);
        if (principal == 0 || request.faceValue < principal) revert InvalidAmount();
        if (validUntil <= block.timestamp) revert OfferExpired(receivableIdHash);
        if (financingOffers[receivableIdHash].funder != address(0)) revert OfferAlreadyExists(receivableIdHash);

        financingOffers[receivableIdHash] = FinancingOffer({
            funder: msg.sender,
            supplier: request.supplier,
            token: request.token,
            principal: principal,
            faceValue: request.faceValue,
            annualizedYieldBps: annualizedYieldBps,
            validUntil: validUntil,
            accepted: false
        });

        uint256 balanceBefore = IERC20(request.token).balanceOf(address(this));
        IERC20(request.token).safeTransferFrom(msg.sender, address(this), principal);
        uint256 received = IERC20(request.token).balanceOf(address(this)) - balanceBefore;
        if (received != principal) revert TransferAmountMismatch(principal, received);

        emit FinancingOfferSubmitted(
            receivableIdHash,
            msg.sender,
            request.supplier,
            request.token,
            principal,
            request.faceValue,
            annualizedYieldBps,
            validUntil
        );
    }

    function acceptOffer(bytes32 receivableIdHash) external whenNotPaused nonReentrant {
        FinancingOffer storage offer = financingOffers[receivableIdHash];
        if (offer.funder == address(0) || offer.accepted) revert InvalidOffer(receivableIdHash);
        if (msg.sender != offer.supplier) revert OnlySupplier(msg.sender);
        if (offer.validUntil < block.timestamp) revert OfferExpired(receivableIdHash);

        offer.accepted = true;
        IERC20(offer.token).safeTransfer(offer.supplier, offer.principal);
        emit FinancingOfferAccepted(receivableIdHash, offer.supplier, offer.funder);
    }

    function cancelOffer(bytes32 receivableIdHash) external nonReentrant {
        FinancingOffer memory offer = financingOffers[receivableIdHash];
        if (offer.funder == address(0) || offer.accepted || msg.sender != offer.funder) revert InvalidOffer(receivableIdHash);
        if (offer.validUntil >= block.timestamp) revert OfferNotExpired(receivableIdHash);

        delete financingOffers[receivableIdHash];
        IERC20(offer.token).safeTransfer(offer.funder, offer.principal);
        emit FinancingOfferCancelled(receivableIdHash, offer.funder, offer.principal);
    }

    function settleWithAuthorization(
        bytes32 receivableIdHash,
        address token,
        address payer,
        address recipient,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyOperator whenNotPaused nonReentrant {
        if (!allowedTokens[token]) revert TokenNotAllowed(token);
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (settledReceivables[receivableIdHash]) revert AlreadySettled(receivableIdHash);
        FinancingOffer memory offer = financingOffers[receivableIdHash];
        if (!offer.accepted || offer.token != token || offer.funder != recipient || offer.faceValue != amount) {
            revert InvalidOffer(receivableIdHash);
        }

        bytes32 authorizationHash = keccak256(
            abi.encode(token, payer, address(this), amount, validAfter, validBefore, nonce)
        );
        if (usedAuthorizations[authorizationHash]) revert AuthorizationAlreadyUsed(authorizationHash);

        settledReceivables[receivableIdHash] = true;
        usedAuthorizations[authorizationHash] = true;

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC3009Token(token).transferWithAuthorization(
            payer,
            address(this),
            amount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert TransferAmountMismatch(amount, received);

        claimable[token][recipient] += amount;
        totalLiability[token] += amount;
        emit ReceivableSettled(receivableIdHash, authorizationHash, payer, token, recipient, amount);
    }

    function settleAndTransferWithAuthorization(
        bytes32 receivableIdHash,
        address token,
        address payer,
        address recipient,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyOperator whenNotPaused nonReentrant {
        if (!allowedTokens[token]) revert TokenNotAllowed(token);
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (settledReceivables[receivableIdHash]) revert AlreadySettled(receivableIdHash);
        FinancingOffer memory offer = financingOffers[receivableIdHash];
        if (!offer.accepted || offer.token != token || offer.funder != recipient || offer.faceValue != amount) {
            revert InvalidOffer(receivableIdHash);
        }

        bytes32 authorizationHash = keccak256(
            abi.encode(token, payer, address(this), amount, validAfter, validBefore, nonce)
        );
        if (usedAuthorizations[authorizationHash]) revert AuthorizationAlreadyUsed(authorizationHash);

        settledReceivables[receivableIdHash] = true;
        usedAuthorizations[authorizationHash] = true;

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC3009Token(token).transferWithAuthorization(
            payer,
            address(this),
            amount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert TransferAmountMismatch(amount, received);

        IERC20(token).safeTransfer(recipient, amount);
        emit ReceivableSettledAndTransferred(receivableIdHash, authorizationHash, payer, token, recipient, amount);
    }

    function claim(address token) external nonReentrant returns (uint256 amount) {
        amount = claimable[token][msg.sender];
        if (amount == 0) revert InvalidAmount();
        claimable[token][msg.sender] = 0;
        totalLiability[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(token, msg.sender, amount);
    }

    function claimFor(address token, address account) external nonReentrant returns (uint256 amount) {
        amount = claimable[token][account];
        if (amount == 0) revert InvalidAmount();
        claimable[token][account] = 0;
        totalLiability[token] -= amount;
        IERC20(token).safeTransfer(account, amount);
        emit Claimed(token, account, amount);
    }
}