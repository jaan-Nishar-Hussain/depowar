// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockDEX} from "../src/mocks/MockDEX.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract MockDEXTest is Test {
    MockDEX dex;
    MockERC20 usdc;
    MockERC20 weth;
    address lp = address(0xA11CE);
    address trader = address(0xB0B);

    function setUp() public {
        dex = new MockDEX();
        usdc = new MockERC20("Mock USDC", "USDC", 6);
        weth = new MockERC20("Mock WETH", "WETH", 18);

        usdc.mint(lp, 1_000_000e6);
        weth.mint(lp, 1000e18);
        vm.startPrank(lp);
        usdc.approve(address(dex), type(uint256).max);
        weth.approve(address(dex), type(uint256).max);
        dex.addLiquidity(address(usdc), address(weth), 1_000_000e6, 1000e18);
        vm.stopPrank();

        usdc.mint(trader, 100_000e6);
        weth.mint(trader, 1_000_000e18);
        vm.startPrank(trader);
        usdc.approve(address(dex), type(uint256).max);
        weth.approve(address(dex), type(uint256).max);
        vm.stopPrank();
    }

    function test_SwapReturnsQuotedOutput() public {
        uint256 expected = dex.getAmountOut(address(weth), address(usdc), 1e18);
        vm.prank(trader);
        uint256 out = dex.swap(address(weth), address(usdc), 1e18, 0);
        assertEq(out, expected);
        assertGt(out, 0);
        assertEq(usdc.balanceOf(trader), 100_000e6 + expected);
        assertEq(weth.balanceOf(trader), 1_000_000e18 - 1e18);
    }

    function test_RevertOnInsufficientOutput() public {
        uint256 quoted = dex.getAmountOut(address(weth), address(usdc), 1e18);
        vm.expectRevert();
        vm.prank(trader);
        dex.swap(address(weth), address(usdc), 1e18, quoted + 1);
    }

    function test_RevertOnZeroAmount() public {
        vm.expectRevert(MockDEX.ZeroAmount.selector);
        dex.getAmountOut(address(weth), address(usdc), 0);
    }

    function test_RevertOnUninitializedPair() public {
        MockERC20 dai = new MockERC20("Mock DAI", "DAI", 18);
        vm.expectRevert(MockDEX.PairNotInitialized.selector);
        dex.getAmountOut(address(dai), address(usdc), 1e18);
    }

    function test_SwapFailCountdownReverts() public {
        dex.setSwapFailCountdown(1);
        vm.expectRevert(MockDEX.SwapFailed.selector);
        vm.prank(trader);
        dex.swap(address(weth), address(usdc), 1e18, 0);

        dex.setSwapFailCountdown(0);
        vm.prank(trader);
        dex.swap(address(weth), address(usdc), 1e18, 0);
    }

    function testFuzz_AmountOutRespectsMinOut(uint256 amountIn) public {
        amountIn = bound(amountIn, 1e6, 50e18);
        uint256 quoted = dex.getAmountOut(address(weth), address(usdc), amountIn);
        vm.prank(trader);
        uint256 out = dex.swap(address(weth), address(usdc), amountIn, quoted);
        assertEq(out, quoted);
    }
}
