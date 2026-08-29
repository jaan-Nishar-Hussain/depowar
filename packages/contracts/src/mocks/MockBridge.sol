// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockBridge
 * @notice Simulates a cross-chain bridge.
 *
 *         On the source chain, `deposit` locks tokens and emits
 *         `TransferInitiated`. A relayer (the PayMesh worker) reads that event
 *         off-chain and calls `settle` on the destination-side deployment,
 *         which pays out the destination token from this contract's balance.
 *         `settleFailCountdown` injects failures for fallback-route tests.
 */
contract MockBridge is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Transfer {
        uint256 id;
        address from;
        address token;
        uint256 amount;
        uint256 destChainId;
        address destToken;
        address destAddress;
        bool claimed;
        bool exists;
    }

    uint256 public nextId;
    mapping(uint256 => Transfer) public transfers;
    address public relayer;

    /// @dev When > 0, the next N settle calls revert.
    uint256 public settleFailCountdown;

    event TransferInitiated(
        uint256 indexed id,
        address indexed from,
        address token,
        uint256 amount,
        uint256 destChainId,
        address destToken,
        address destAddress
    );
    event TransferSettled(
        uint256 indexed id, address destAddress, address destToken, uint256 amount
    );

    error NotRelayer();
    error TransferNotFound(uint256 id);
    error AlreadyClaimed(uint256 id);
    error ZeroAmount();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setRelayer(address relayer_) external onlyOwner {
        relayer = relayer_;
    }

    function getTransfer(uint256 id) external view returns (Transfer memory) {
        return transfers[id];
    }

    function setSettleFailCountdown(uint256 count) external onlyOwner {
        settleFailCountdown = count;
    }

    function deposit(
        address token,
        uint256 amount,
        uint256 destChainId,
        address destToken,
        address destAddress
    ) external nonReentrant returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        id = nextId++;
        transfers[id] = Transfer(
            id, msg.sender, token, amount, destChainId, destToken, destAddress, false, true
        );
        emit TransferInitiated(id, msg.sender, token, amount, destChainId, destToken, destAddress);
    }

    /// @notice Relayer call on the destination chain: pays `amount` of
    ///         `destToken` from this deployment's balance to `destAddress`.
    ///         Cross-chain settlement is mocked (no proof verification); the
    ///         relayer relays the amount that was locked on the source side.
    function settle(uint256 id, address destToken, uint256 amount, address destAddress)
        external
        nonReentrant
    {
        if (msg.sender != relayer) revert NotRelayer();
        Transfer storage t = transfers[id];
        if (t.claimed) revert AlreadyClaimed(id);
        if (settleFailCountdown > 0) {
            settleFailCountdown--;
            revert TransferNotFound(id);
        }
        if (amount == 0) revert ZeroAmount();
        t.claimed = true;
        IERC20(destToken).safeTransfer(destAddress, amount);
        emit TransferSettled(id, destAddress, destToken, amount);
    }
}
