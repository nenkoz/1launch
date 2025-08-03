// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title AuctionFusionResolver
 * @dev Smart contract that acts as intermediary for private auctions with 1inch Fusion
 * 
 * How it works:
 * 1. User signs 1inch Fusion order: LINK → USDC, receiver = this contract
 * 2. We submit winning orders to 1inch Fusion
 * 3. This contract receives USDC from successful swaps
 * 4. This contract distributes auction tokens to users
 */
contract AuctionFusionResolver is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Events
    event BidExecuted(
        address indexed user,
        address indexed sourceToken,
        uint256 sourceAmount,
        address indexed auctionToken,
        uint256 auctionTokensReceived,
        uint256 usdcReceived
    );

    event EmergencyWithdraw(address indexed token, uint256 amount);

    // Constants
    IERC20 public immutable USDC;
    address public immutable ONE_INCH_ROUTER;

    // Mappings
    mapping(address => bool) public authorizedAuctionTokens;
    mapping(address => uint256) public auctionTokenRates; // USDC per auction token (6 decimals)

    constructor(
        address _usdc,
        address _oneInchRouter
    ) {
        USDC = IERC20(_usdc);
        ONE_INCH_ROUTER = _oneInchRouter;
        _transferOwnership(msg.sender);
    }

    /**
     * @dev Authorize an auction token for trading
     */
    function authorizeAuctionToken(
        address auctionToken,
        uint256 rateUSDCPer6Decimals
    ) external onlyOwner {
        authorizedAuctionTokens[auctionToken] = true;
        auctionTokenRates[auctionToken] = rateUSDCPer6Decimals;
    }

    /**
     * @dev Execute auction bid - called by our backend after 1inch Fusion fills the order
     * This function is called AFTER 1inch has already swapped user's tokens to USDC
     * and sent the USDC to this contract
     */
    function executeAuctionBid(
        address user,
        address sourceToken,
        uint256 sourceAmount,
        address auctionToken,
        uint256 expectedAuctionTokens,
        uint256 usdcReceived
    ) public onlyOwner nonReentrant {
        require(authorizedAuctionTokens[auctionToken], "Auction token not authorized");
        require(usdcReceived > 0, "No USDC received");

        // Calculate auction tokens to distribute based on USDC received
        uint256 auctionTokensToDistribute = (usdcReceived * 1e18) / auctionTokenRates[auctionToken];
        
        // Ensure we don't exceed expected amount (slippage protection)
        require(auctionTokensToDistribute >= expectedAuctionTokens, "Insufficient auction tokens");

        // Transfer auction tokens to user
        IERC20(auctionToken).safeTransfer(user, auctionTokensToDistribute);

        emit BidExecuted(
            user,
            sourceToken,
            sourceAmount,
            auctionToken,
            auctionTokensToDistribute,
            usdcReceived
        );
    }



    /**
     * @dev Deposit auction tokens for distribution
     */
    function depositAuctionTokens(
        address auctionToken,
        uint256 amount
    ) external onlyOwner {
        require(authorizedAuctionTokens[auctionToken], "Auction token not authorized");
        IERC20(auctionToken).safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @dev Emergency withdraw function
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
        emit EmergencyWithdraw(token, amount);
    }

    /**
     * @dev Get USDC balance of this contract
     */
    function getUSDCBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    /**
     * @dev Get auction token balance
     */
    function getAuctionTokenBalance(address auctionToken) external view returns (uint256) {
        return IERC20(auctionToken).balanceOf(address(this));
    }

    /**
     * @dev Batch execute multiple auction bids
     */
    function batchExecuteAuctionBids(
        address[] calldata users,
        address[] calldata sourceTokens,
        uint256[] calldata sourceAmounts,
        address auctionToken,
        uint256[] calldata expectedAuctionTokens,
        uint256[] calldata usdcAmounts
    ) external onlyOwner nonReentrant {
        require(users.length == sourceTokens.length, "Array length mismatch");
        require(users.length == sourceAmounts.length, "Array length mismatch");
        require(users.length == expectedAuctionTokens.length, "Array length mismatch");
        require(users.length == usdcAmounts.length, "Array length mismatch");

        for (uint256 i = 0; i < users.length; i++) {
            executeAuctionBid(
                users[i],
                sourceTokens[i],
                sourceAmounts[i],
                auctionToken,
                expectedAuctionTokens[i],
                usdcAmounts[i]
            );
        }
    }
}