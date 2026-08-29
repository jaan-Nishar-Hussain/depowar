// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockBridge} from "../src/mocks/MockBridge.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract MockBridgeTest is Test {
    MockBridge bridge;
    MockERC20 usdc;
    address owner = address(this);
    address relayer = address(0x1234);
    address sender = address(0x2222);
    address recipient = address(0x3333);
    uint256 internal destChain = 84532;

    function setUp() public {
        bridge = new MockBridge(owner);
        bridge.setRelayer(relayer);
        usdc = new MockERC20("Mock USDC", "USDC", 6);

        // destination-side liquidity held by the bridge
        usdc.mint(address(bridge), 1_000_000e6);

        usdc.mint(sender, 100_000e6);
        vm.prank(sender);
        usdc.approve(address(bridge), type(uint256).max);
    }

    function test_DepositLocksTokensAndEmits() public {
        vm.prank(sender);
        vm.expectEmit(true, true, false, true);
        emit MockBridge.TransferInitiated(
            0, sender, address(usdc), 100e6, destChain, address(usdc), recipient
        );
        uint256 id = bridge.deposit(address(usdc), 100e6, destChain, address(usdc), recipient);

        assertEq(id, 0);
        assertEq(usdc.balanceOf(sender), 100_000e6 - 100e6);
        assertEq(usdc.balanceOf(address(bridge)), 1_000_000e6 + 100e6);
        MockBridge.Transfer memory t = bridge.getTransfer(id);
        assertTrue(t.exists);
        assertEq(t.destAddress, recipient);
        assertFalse(t.claimed);
    }

    function test_SettlePaysOutToRecipient() public {
        vm.prank(sender);
        uint256 id = bridge.deposit(address(usdc), 100e6, destChain, address(usdc), recipient);

        vm.prank(relayer);
        vm.expectEmit(true, true, true, true);
        emit MockBridge.TransferSettled(id, recipient, address(usdc), 100e6);
        bridge.settle(id, address(usdc), 100e6, recipient);

        assertEq(usdc.balanceOf(recipient), 100e6);
        assertTrue(bridge.getTransfer(id).claimed);
        assertEq(usdc.balanceOf(address(bridge)), 1_000_000e6);
    }

    function test_RevertWhenNotRelayer() public {
        vm.prank(sender);
        uint256 id = bridge.deposit(address(usdc), 100e6, destChain, address(usdc), recipient);

        vm.expectRevert(MockBridge.NotRelayer.selector);
        bridge.settle(id, address(usdc), 100e6, recipient);
    }

    function test_RevertOnDoubleSettle() public {
        vm.prank(sender);
        uint256 id = bridge.deposit(address(usdc), 100e6, destChain, address(usdc), recipient);
        vm.prank(relayer);
        bridge.settle(id, address(usdc), 100e6, recipient);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(MockBridge.AlreadyClaimed.selector, id));
        bridge.settle(id, address(usdc), 100e6, recipient);
    }

    /// The mock accepts settlement for an id it has no local record of (the
    /// transfer was initiated on the source chain); it pays out from its own
    /// balance, like a relayer.
    function test_SettleUnknownIdPaysOut() public {
        vm.prank(relayer);
        bridge.settle(999, address(usdc), 100e6, recipient);
        assertEq(usdc.balanceOf(recipient), 100e6);
        assertTrue(bridge.getTransfer(999).claimed);
    }

    function test_SettleFailCountdownReverts() public {
        vm.prank(sender);
        uint256 id = bridge.deposit(address(usdc), 100e6, destChain, address(usdc), recipient);

        bridge.setSettleFailCountdown(1);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(MockBridge.TransferNotFound.selector, id));
        bridge.settle(id, address(usdc), 100e6, recipient);

        bridge.setSettleFailCountdown(0);
        vm.prank(relayer);
        bridge.settle(id, address(usdc), 100e6, recipient);
        assertTrue(bridge.getTransfer(id).claimed);
    }
}
