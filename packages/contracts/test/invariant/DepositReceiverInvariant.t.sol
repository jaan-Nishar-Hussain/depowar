// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DepositReceiver} from "../../src/DepositReceiver.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

/// @notice Handler that lets the invariant runner exercise deposits safely.
contract DepositHandler {
    DepositReceiver internal immutable receiver;
    MockERC20 internal immutable token;

    constructor(DepositReceiver receiver_, MockERC20 token_) {
        receiver = receiver_;
        token = token_;
    }

    function deposit(uint256 amount) external {
        amount = amount % 1e30;
        if (amount == 0) amount = 1;
        token.mint(address(this), amount);
        token.approve(address(receiver), amount);
        receiver.deposit(address(token), amount);
    }
}

contract DepositReceiverInvariant is Test {
    DepositReceiver receiver;
    MockERC20 token;
    DepositHandler handler;
    address owner = address(0xABCD);

    function setUp() public {
        receiver = new DepositReceiver(owner);
        token = new MockERC20("Mock USDC", "USDC", 6);
        handler = new DepositHandler(receiver, token);
        // the handler becomes the token owner so it can mint for deposits
        token.transferOwnership(address(handler));
        targetContract(address(handler));
    }

    /// The core invariant from the PRD: this contract never retains a residual
    /// balance. Every deposit is fully forwarded to the owner.
    function invariant_receiverRetainsNoTokens() public view {
        assertEq(token.balanceOf(address(receiver)), 0, "receiver must never retain tokens");
    }
}
