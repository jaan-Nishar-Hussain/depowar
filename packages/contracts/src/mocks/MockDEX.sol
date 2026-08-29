// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockDEX
 * @notice Minimal constant-product (Uniswap V2-style) router for same-chain
 *         swaps on Anvil / testnets. Includes failure injection so the
 *         fallback-route logic can be exercised deterministically.
 */
contract MockDEX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30; // 0.3%

    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        bool exists;
    }

    mapping(address => mapping(address => Pool)) internal _pools;

    /// @dev When > 0, the next N swaps revert (used to force fallback routes).
    uint256 public swapFailCountdown;

    event LiquidityAdded(
        address indexed token0, address indexed token1, uint256 amount0, uint256 amount1
    );
    event Swap(
        address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut
    );

    error InvalidPair();
    error ZeroAmount();
    error PairNotInitialized();
    error InsufficientOutput(uint256 minAmountOut, uint256 amountOut);
    error SwapFailed();

    function _ordered(address a, address b) internal pure returns (address t0, address t1) {
        if (a == b || a == address(0) || b == address(0)) revert InvalidPair();
        (t0, t1) = a < b ? (a, b) : (b, a);
    }

    function addLiquidity(address tokenA, address tokenB, uint256 amountA, uint256 amountB)
        external
        nonReentrant
        returns (uint256 liquidity)
    {
        (address t0, address t1) = _ordered(tokenA, tokenB);
        if (amountA == 0 || amountB == 0) revert ZeroAmount();
        Pool storage pool = _pools[t0][t1];
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);
        if (!pool.exists) {
            pool.token0 = t0;
            pool.token1 = t1;
            pool.exists = true;
        }
        if (t0 == tokenA) {
            pool.reserve0 += amountA;
            pool.reserve1 += amountB;
        } else {
            pool.reserve0 += amountB;
            pool.reserve1 += amountA;
        }
        pool.totalLiquidity += amountA + amountB;
        liquidity = amountA + amountB;
        emit LiquidityAdded(t0, t1, amountA, amountB);
    }

    function getPool(address tokenA, address tokenB) external view returns (Pool memory) {
        (address t0, address t1) = _ordered(tokenA, tokenB);
        return _pools[t0][t1];
    }

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn)
        public
        view
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        (address t0, address t1) = _ordered(tokenIn, tokenOut);
        Pool storage pool = _pools[t0][t1];
        if (!pool.exists) revert PairNotInitialized();
        bool inIsToken0 = tokenIn == pool.token0;
        uint256 reserveIn = inIsToken0 ? pool.reserve0 : pool.reserve1;
        uint256 reserveOut = inIsToken0 ? pool.reserve1 : pool.reserve0;
        if (reserveIn == 0 || reserveOut == 0) revert PairNotInitialized();
        uint256 amountInAfterFee = (amountIn * (10000 - FEE_BPS)) / 10000;
        amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (swapFailCountdown > 0) {
            swapFailCountdown--;
            revert SwapFailed();
        }
        amountOut = getAmountOut(tokenIn, tokenOut, amountIn);
        if (amountOut < minAmountOut) revert InsufficientOutput(minAmountOut, amountOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        emit Swap(tokenIn, tokenOut, amountIn, amountOut);
    }

    function setSwapFailCountdown(uint256 count) external {
        swapFailCountdown = count;
    }
}
