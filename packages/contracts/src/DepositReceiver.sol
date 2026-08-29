// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DepositReceiver
 * @notice Settlement target for PayMesh contract-type recipients.
 *
 *         Pulls the deposit from the sender and immediately forwards the full
 *         amount to the owner (the recipient). It never retains a residual
 *         balance, which is the invariant we prove with Foundry invariant
 *         tests and Halmos.
 */
contract DepositReceiver is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event Received(address indexed from, address indexed token, uint256 amount);

    error ZeroToken();
    error ZeroAmount();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @dev Moves `amount` of `token` from msg.sender to the owner.
     *      Reverts on zero token/amount. Protected against reentrancy.
     */
    function deposit(address token, uint256 amount) external nonReentrant {
        if (token == address(0)) revert ZeroToken();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(token).safeTransfer(owner(), amount);
        emit Received(msg.sender, token, amount);
    }
}
