// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 token;
    address owner = address(this);

    function setUp() public {
        token = new MockERC20("Mock USDC", "USDC", 6);
    }

    function test_DecimalsAreRespected() public view {
        assertEq(token.decimals(), 6);
    }

    function test_MintOnlyOwner() public {
        token.mint(owner, 1000e6);
        assertEq(token.balanceOf(owner), 1000e6);
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        token.mint(address(0xBEEF), 1);
    }

    function test_BurnOnlyOwner() public {
        token.mint(owner, 1000e6);
        token.burn(owner, 400e6);
        assertEq(token.balanceOf(owner), 600e6);
    }

    function testFuzz_MintAndBurnRoundTrip(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        token.mint(owner, amount);
        token.burn(owner, amount);
        assertEq(token.balanceOf(owner), 0);
    }
}
