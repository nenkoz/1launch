// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MultiTokenAuctionResolver
 * @dev Smart contract that handles multi-token auction settlements
 * Uses permits + 1inch Fusion for seamless token conversion
 */
contract MultiTokenAuctionResolver is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // 1inch Fusion API integration
    address public constant FUSION_SETTLEMENT = 0x1111111254fb6c44bAC0beD2854e76F90643097d; // 1inch router
    address public constant USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // Arbitrum USDC
    
    // Events
    event TokensSwappedAndAuctioned(
        address indexed user,
        address indexed fromToken,
        uint256 fromAmount,
        uint256 usdcReceived,
        address indexed auctionToken,
        uint256 auctionTokensReceived
    );

    /**
     * @dev Execute full flow: Permit → Fusion Swap → Auction Settlement
     * This is called by our backend for winning bidders only
     */
    function executePermitSwapAndAuction(
        // Permit parameters for source token
        address sourceToken,
        address user,
        uint256 sourceAmount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        // Fusion swap parameters
        bytes calldata fusionCalldata,
        // Auction parameters
        address auctionToken,
        uint256 expectedAuctionTokens
    ) external onlyOwner nonReentrant returns (uint256 actualAuctionTokens) {
        
        // Step 1: Execute permit to get user's source tokens
        IERC20Permit(sourceToken).permit(user, address(this), sourceAmount, deadline, v, r, s);
        IERC20(sourceToken).safeTransferFrom(user, address(this), sourceAmount);

        // Step 2: Approve 1inch to spend source tokens
        IERC20(sourceToken).safeApprove(FUSION_SETTLEMENT, sourceAmount);

        // Step 3: Execute 1inch Fusion swap (source token → USDC)
        uint256 usdcBalanceBefore = IERC20(USDC).balanceOf(address(this));
        
        (bool success, ) = FUSION_SETTLEMENT.call(fusionCalldata);
        require(success, "Fusion swap failed");

        uint256 usdcReceived = IERC20(USDC).balanceOf(address(this)) - usdcBalanceBefore;
        require(usdcReceived > 0, "No USDC received from swap");

        // Step 4: "Purchase" auction tokens with received USDC
        // (Transfer USDC to auction contract and get auction tokens)
        actualAuctionTokens = _purchaseAuctionTokens(auctionToken, usdcReceived, expectedAuctionTokens);

        // Step 5: Transfer auction tokens to user
        IERC20(auctionToken).safeTransfer(user, actualAuctionTokens);

        emit TokensSwappedAndAuctioned(
            user,
            sourceToken,
            sourceAmount,
            usdcReceived,
            auctionToken,
            actualAuctionTokens
        );

        return actualAuctionTokens;
    }

    /**
     * @dev Execute for USDC bids (no swap needed)
     */
    function executeUSDCPermitAndAuction(
        address user,
        uint256 usdcAmount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address auctionToken,
        uint256 expectedAuctionTokens
    ) external onlyOwner nonReentrant returns (uint256 actualAuctionTokens) {
        
        // Step 1: Execute USDC permit
        IERC20Permit(USDC).permit(user, address(this), usdcAmount, deadline, v, r, s);
        IERC20(USDC).safeTransferFrom(user, address(this), usdcAmount);

        // Step 2: Purchase auction tokens directly
        actualAuctionTokens = _purchaseAuctionTokens(auctionToken, usdcAmount, expectedAuctionTokens);

        // Step 3: Transfer auction tokens to user
        IERC20(auctionToken).safeTransfer(user, actualAuctionTokens);

        emit TokensSwappedAndAuctioned(
            user,
            USDC,
            usdcAmount,
            usdcAmount,
            auctionToken,
            actualAuctionTokens
        );

        return actualAuctionTokens;
    }

    /**
     * @dev Internal function to "purchase" auction tokens
     * In practice, this transfers USDC to auction contract and receives tokens
     */
    function _purchaseAuctionTokens(
        address auctionToken,
        uint256 usdcAmount,
        uint256 expectedTokens
    ) internal returns (uint256 actualTokens) {
        // This would interact with your auction contract
        // For now, simplified logic
        
        // Transfer USDC to auction contract (or treasury)
        IERC20(USDC).safeTransfer(owner(), usdcAmount);
        
        // In a real implementation, this would:
        // 1. Transfer USDC to auction contract
        // 2. Call auction contract to get tokens
        // 3. Return actual tokens received
        
        return expectedTokens; // Simplified for now
    }

    /**
     * @dev Emergency functions
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    /**
     * @dev Batch execute multiple winning bids for gas efficiency
     */
    function batchExecuteWinningBids(
        address[] calldata users,
        address[] calldata sourceTokens,
        uint256[] calldata sourceAmounts,
        uint256[] calldata deadlines,
        uint8[] calldata vs,
        bytes32[] calldata rs,
        bytes32[] calldata ss,
        bytes[] calldata fusionCalldatas,
        address auctionToken,
        uint256[] calldata expectedAuctionTokens
    ) external onlyOwner nonReentrant {
        require(users.length == sourceTokens.length, "Array length mismatch");
        require(users.length == sourceAmounts.length, "Array length mismatch");
        require(users.length == deadlines.length, "Array length mismatch");
        require(users.length == vs.length, "Array length mismatch");
        require(users.length == rs.length, "Array length mismatch");
        require(users.length == ss.length, "Array length mismatch");
        require(users.length == fusionCalldatas.length, "Array length mismatch");
        require(users.length == expectedAuctionTokens.length, "Array length mismatch");

        for (uint256 i = 0; i < users.length; i++) {
            if (sourceTokens[i] == USDC) {
                // Handle USDC bids
                this.executeUSDCPermitAndAuction(
                    users[i],
                    sourceAmounts[i],
                    deadlines[i],
                    vs[i],
                    rs[i],
                    ss[i],
                    auctionToken,
                    expectedAuctionTokens[i]
                );
            } else {
                // Handle other tokens with Fusion
                this.executePermitSwapAndAuction(
                    sourceTokens[i],
                    users[i],
                    sourceAmounts[i],
                    deadlines[i],
                    vs[i],
                    rs[i],
                    ss[i],
                    fusionCalldatas[i],
                    auctionToken,
                    expectedAuctionTokens[i]
                );
            }
        }
    }
}