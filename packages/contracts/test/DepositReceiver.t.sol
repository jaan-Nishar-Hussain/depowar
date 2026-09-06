// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DepositReceiver} from "../src/DepositReceiver.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// Minimal contract owner used to prove contract-type settlement (PRD test
/// case: "Settlement to an EOA vs. settlement to a contract call").
contract TokenHolder {
    function balanceOf(address token) external view returns (uint256) {
        return MockERC20(token).balanceOf(address(this));
    }
}

contract DepositReceiverTest is Test {
    DepositReceiver receiver;
    MockERC20 token;
    address owner = address(0xABCD);
    address sender = address(0x1111);

    function setUp() public {
        receiver = new DepositReceiver(owner);
        token = new MockERC20("Mock USDC", "USDC", 6);
        token.mint(sender, 1_000_000e6);
        vm.prank(sender);
        token.approve(address(receiver), type(uint256).max);
    }

    function test_DepositTransfersFullAmountToOwner() public {
        vm.prank(sender);
        vm.expectEmit(true, true, false, true);
        emit DepositReceiver.Received(sender, address(token), 500_000e6);
        receiver.deposit(address(token), 500_000e6);

        assertEq(token.balanceOf(owner), 500_000e6, "owner should receive the deposit");
        assertEq(token.balanceOf(address(receiver)), 0, "receiver must not retain funds");
    }

    function test_RevertWhenZeroAmount() public {
        vm.expectRevert(DepositReceiver.ZeroAmount.selector);
        vm.prank(sender);
        receiver.deposit(address(token), 0);
    }

    function test_RevertWhenZeroToken() public {
        vm.expectRevert(DepositReceiver.ZeroToken.selector);
        vm.prank(sender);
        receiver.deposit(address(0), 1);
    }

    function test_RevertWithoutApproval() public {
        address other = address(0x2222);
        token.mint(other, 100e6);
        vm.expectRevert();
        vm.prank(other);
        receiver.deposit(address(token), 100e6);
    }

    function testFuzz_DepositEmitsCorrectAmount(uint256 amount) public {
        vm.assume(amount > 0 && amount < 1e30);
        token.mint(sender, amount);
        vm.prank(sender);
        token.approve(address(receiver), amount);

        vm.prank(sender);
        vm.expectEmit(true, true, false, true);
        emit DepositReceiver.Received(sender, address(token), amount);
        receiver.deposit(address(token), amount);

        assertEq(token.balanceOf(address(receiver)), 0, "receiver must never retain funds");
        assertEq(token.balanceOf(owner), amount, "owner must receive the exact amount");
    }

    function test_ContractSettlementForwardsToContractOwner() public {
        // Contract-type settlement (PRD §Dynamic Settlement Configuration):
        // the configured destination is a smart contract, not an EOA.
        TokenHolder holder = new TokenHolder();
        DepositReceiver contractReceiver = new DepositReceiver(address(holder));
        token.mint(sender, 123_456e6);
        vm.prank(sender);
        token.approve(address(contractReceiver), type(uint256).max);

        vm.prank(sender);
        contractReceiver.deposit(address(token), 123_456e6);

        assertEq(
            token.balanceOf(address(holder)), 123_456e6, "contract owner must receive the deposit"
        );
        assertEq(token.balanceOf(address(contractReceiver)), 0, "receiver must not retain funds");
    }
}
