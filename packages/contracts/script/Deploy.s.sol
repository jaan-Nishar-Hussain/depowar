// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {DepositReceiver} from "../src/DepositReceiver.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockDEX} from "../src/mocks/MockDEX.sol";
import {MockBridge} from "../src/mocks/MockBridge.sol";

/// @notice Deploys the PayMesh mock stack (tokens, receiver, DEX, bridge) and
///         seeds liquidity. Works against Anvil and Sepolia-family testnets.
contract DeployScript is Script {
    function run() external {
        address owner = vm.envOr("RECEIVER_OWNER", msg.sender);

        vm.startBroadcast();
        MockERC20 usdc = new MockERC20("Mock USDC", "USDC", 6);
        MockERC20 weth = new MockERC20("Mock WETH", "WETH", 18);
        DepositReceiver receiver = new DepositReceiver(owner);
        MockDEX dex = new MockDEX();
        MockBridge bridge = new MockBridge(owner);

        usdc.mint(msg.sender, 2_000_000e6);
        weth.mint(msg.sender, 2000e18);
        usdc.approve(address(dex), type(uint256).max);
        weth.approve(address(dex), type(uint256).max);
        dex.addLiquidity(address(usdc), address(weth), 1_000_000e6, 1000e18);
        bridge.setRelayer(msg.sender);
        usdc.mint(address(bridge), 1_000_000e6);
        vm.stopBroadcast();

        console2.log("MockUSDC", address(usdc));
        console2.log("MockWETH", address(weth));
        console2.log("DepositReceiver", address(receiver));
        console2.log("MockDEX", address(dex));
        console2.log("MockBridge", address(bridge));
    }
}
