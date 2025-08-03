// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// 1inch Limit Order Protocol interfaces
interface IOrderMixin {
    struct Order {
        uint256 salt;
        address makerAsset;
        address takerAsset;
        address maker;
        address receiver;
        address allowedSender;
        uint256 makingAmount;
        uint256 takingAmount;
        uint256 expiration;
        bytes makerAssetData;
        bytes takerAssetData;
        bytes getMakingAmount;
        bytes getTakingAmount;
        bytes predicate;
        bytes permit;
        bytes preInteraction;
        bytes postInteraction;
    }

    function fillOrder(
        Order memory order,
        bytes calldata signature,
        bytes calldata interaction,
        uint256 makingAmount,
        uint256 takingAmountThreshold
    )
        external
        payable
        returns (uint256 actualMakingAmount, uint256 actualTakingAmount);

    function cancelOrder(Order memory order) external;
}

interface IPreInteraction {
    function preInteraction(
        IOrderMixin.Order memory order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external;
}

interface IPostInteraction {
    function postInteraction(
        IOrderMixin.Order memory order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external;
}

/**
 * @title AuctionController
 * @dev Manages Dutch auctions with 1inch limit order integration
 */
contract AuctionController is
    ReentrancyGuard,
    Ownable,
    Pausable,
    IPreInteraction,
    IPostInteraction
{
    using SafeERC20 for IERC20;

    // Auction structure
    struct Auction {
        address tokenAddress;
        uint256 totalSupply;
        uint256 targetAllocation; // 40% of total supply
        uint256 startTime;
        uint256 endTime;
        address creator;
        bool isSettled;
        uint256 clearingPrice;
        uint256 totalRaised;
        string metadataURI; // IPFS hash for token metadata
    }

    // Bid structure for tracking
    struct Bid {
        address bidder;
        uint256 price; // Price per token in USDC (6 decimals)
        uint256 quantity; // Number of tokens
        bytes32 orderHash; // 1inch order hash
        bool isFilled;
        uint256 filledAmount;
        bool isOneInchOrder; // Flag to identify 1inch orders
    }

    // State variables
    mapping(bytes32 => Auction) public auctions;
    mapping(bytes32 => Bid[]) public auctionBids;
    mapping(bytes32 => mapping(address => uint256)) public bidderIndexes;
    mapping(bytes32 => bytes32) public orderHashToAuctionId; // Map 1inch order hashes to auction IDs

    IERC20 public immutable USDC;
    address public immutable ONE_INCH_AGGREGATION_ROUTER;

    bytes32[] public activeAuctions;
    uint256 public constant MIN_AUCTION_DURATION = 1 minutes; // Minimum 1 minute duration
    uint256 public constant MAX_AUCTION_DURATION = 7 days; // Maximum 7 days duration
    uint256 public constant PLATFORM_FEE_BPS = 250; // 2.5% platform fee

    // Events
    event AuctionCreated(
        bytes32 indexed auctionId,
        address indexed creator,
        address indexed tokenAddress,
        uint256 targetAllocation,
        uint256 endTime
    );

    event BidPlaced(
        bytes32 indexed auctionId,
        address indexed bidder,
        uint256 price,
        uint256 quantity,
        bytes32 orderHash
    );

    event OneInchOrderProcessed(
        bytes32 indexed auctionId,
        bytes32 indexed orderHash,
        address indexed bidder,
        uint256 makingAmount,
        uint256 takingAmount
    );

    event AuctionSettled(
        bytes32 indexed auctionId,
        uint256 clearingPrice,
        uint256 totalRaised,
        uint256 filledBids
    );
    event PermitBidExecuted(
        bytes32 indexed auctionId,
        address indexed bidder,
        uint256 usdcAmount,
        uint256 tokenAmount
    );

    event BidFilled(
        bytes32 indexed auctionId,
        address indexed bidder,
        uint256 amount,
        uint256 price
    );

    // Modifiers
    modifier onlyActiveAuction(bytes32 auctionId) {
        require(auctions[auctionId].endTime > block.timestamp, "Auction ended");
        require(!auctions[auctionId].isSettled, "Auction settled");
        _;
    }

    modifier onlyEndedAuction(bytes32 auctionId) {
        require(
            auctions[auctionId].endTime <= block.timestamp,
            "Auction still active"
        );
        require(!auctions[auctionId].isSettled, "Already settled");
        _;
    }

    modifier onlyOneInchRouter() {
        require(msg.sender == ONE_INCH_AGGREGATION_ROUTER, "Only 1inch router");
        _;
    }

    constructor(
        address _usdc,
        address _oneInchRouter,
        address _initialOwner
    ) Ownable() {
        USDC = IERC20(_usdc);
        ONE_INCH_AGGREGATION_ROUTER = _oneInchRouter;
        _transferOwnership(_initialOwner);
    }

    /**
     * @dev Create a new Dutch auction
     * @param tokenAddress Address of the token to auction
     * @param totalSupply Total supply of the token
     * @param targetAllocation Amount of tokens to auction (40% of total)
     * @param duration Duration of the auction in seconds
     * @param metadataURI IPFS hash for token metadata
     */
    function createAuction(
        address tokenAddress,
        uint256 totalSupply,
        uint256 targetAllocation,
        uint256 duration,
        string calldata metadataURI
    ) external whenNotPaused returns (bytes32 auctionId) {
        require(tokenAddress != address(0), "Invalid token address");
        require(totalSupply > 0, "Invalid total supply");
        require(
            targetAllocation <= (totalSupply * 40) / 100,
            "Allocation too high"
        );
        require(
            duration >= MIN_AUCTION_DURATION &&
                duration <= MAX_AUCTION_DURATION,
            "Invalid duration"
        );

        // Verify caller owns enough tokens
        IERC20 token = IERC20(tokenAddress);
        require(
            token.balanceOf(msg.sender) >= targetAllocation,
            "Insufficient token balance"
        );

        auctionId = keccak256(
            abi.encodePacked(
                tokenAddress,
                totalSupply,
                block.timestamp,
                msg.sender
            )
        );

        // Transfer tokens to contract
        token.safeTransferFrom(msg.sender, address(this), targetAllocation);

        auctions[auctionId] = Auction({
            tokenAddress: tokenAddress,
            totalSupply: totalSupply,
            targetAllocation: targetAllocation,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            creator: msg.sender,
            isSettled: false,
            clearingPrice: 0,
            totalRaised: 0,
            metadataURI: metadataURI
        });

        activeAuctions.push(auctionId);

        emit AuctionCreated(
            auctionId,
            msg.sender,
            tokenAddress,
            targetAllocation,
            block.timestamp + duration
        );
    }

    /**
     * @dev Place a bid in the auction (called by 1inch integration or directly)
     * @param auctionId The auction ID
     * @param bidder Address of the bidder
     * @param price Price per token in USDC (6 decimals)
     * @param quantity Number of tokens to bid for
     * @param orderHash 1inch order hash for this bid (can be 0x0 for direct bids)
     */
    function placeBid(
        bytes32 auctionId,
        address bidder,
        uint256 price,
        uint256 quantity,
        bytes32 orderHash
    ) external onlyActiveAuction(auctionId) whenNotPaused {
        require(
            msg.sender == ONE_INCH_AGGREGATION_ROUTER || msg.sender == owner(),
            "Unauthorized"
        );
        require(bidder != address(0), "Invalid bidder");
        require(price > 0 && quantity > 0, "Invalid bid amounts");

        Auction storage auction = auctions[auctionId];
        require(
            quantity <= auction.targetAllocation,
            "Quantity exceeds allocation"
        );

        // Add bid to array
        auctionBids[auctionId].push(
            Bid({
                bidder: bidder,
                price: price,
                quantity: quantity,
                orderHash: orderHash,
                isFilled: false,
                filledAmount: 0,
                isOneInchOrder: orderHash != bytes32(0)
            })
        );

        // Store bidder index for quick lookup
        bidderIndexes[auctionId][bidder] = auctionBids[auctionId].length - 1;

        // Map order hash to auction ID if it's a 1inch order
        if (orderHash != bytes32(0)) {
            orderHashToAuctionId[orderHash] = auctionId;
        }

        emit BidPlaced(auctionId, bidder, price, quantity, orderHash);
    }

    /**
     * @dev 1inch PreInteraction - validates auction state before order execution
     */
    function preInteraction(
        IOrderMixin.Order memory order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external override onlyOneInchRouter {
        // Get auction ID from order hash mapping
        bytes32 auctionId = orderHashToAuctionId[orderHash];
        require(auctionId != bytes32(0), "Order not associated with auction");

        Auction memory auction = auctions[auctionId];

        // Validate auction is still active
        require(block.timestamp <= auction.endTime, "Auction has ended");
        require(!auction.isSettled, "Auction already settled");

        // Validate this contract is the allowed sender
        require(order.allowedSender == address(this), "Invalid allowed sender");

        // Validate the order is for the correct auction token
        require(
            order.takerAsset == auction.tokenAddress,
            "Wrong token for auction"
        );
        require(order.makerAsset == address(USDC), "Must pay in USDC");
    }

    /**
     * @dev 1inch PostInteraction - updates auction state after order execution
     */
    function postInteraction(
        IOrderMixin.Order memory order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external override onlyOneInchRouter {
        bytes32 auctionId = orderHashToAuctionId[orderHash];
        require(auctionId != bytes32(0), "Order not associated with auction");

        // Find the bid and update it
        Bid[] storage bids = auctionBids[auctionId];
        for (uint256 i = 0; i < bids.length; i++) {
            if (bids[i].orderHash == orderHash) {
                bids[i].isFilled = true;
                bids[i].filledAmount = takingAmount; // Tokens received

                emit OneInchOrderProcessed(
                    auctionId,
                    orderHash,
                    order.maker,
                    makingAmount,
                    takingAmount
                );
                emit BidFilled(
                    auctionId,
                    order.maker,
                    takingAmount,
                    bids[i].price
                );
                break;
            }
        }
    }

    /**
     * @dev Settle auction and execute winning bids
     * @param auctionId The auction to settle
     */
    function settleAuction(
        bytes32 auctionId
    ) external onlyEndedAuction(auctionId) whenNotPaused nonReentrant {
        Auction storage auction = auctions[auctionId];
        Bid[] storage bids = auctionBids[auctionId];

        // Sort bids by price (highest first) - simplified for gas efficiency
        uint256[] memory sortedIndexes = _sortBidsByPrice(bids);

        uint256 remainingAllocation = auction.targetAllocation;
        uint256 totalRaised = 0;
        uint256 filledBidsCount = 0;
        uint256 clearingPrice = 0;

        // Fill bids from highest price until allocation is exhausted
        for (
            uint256 i = 0;
            i < sortedIndexes.length && remainingAllocation > 0;
            i++
        ) {
            uint256 bidIndex = sortedIndexes[i];
            Bid storage bid = bids[bidIndex];

            // Skip already filled 1inch orders (they were executed via 1inch)
            if (bid.isOneInchOrder && bid.isFilled) {
                remainingAllocation -= bid.filledAmount;
                totalRaised += (bid.filledAmount * bid.price) / 1e18;
                clearingPrice = bid.price;
                filledBidsCount++;
                continue;
            }

            uint256 fillAmount = bid.quantity;
            if (fillAmount > remainingAllocation) {
                fillAmount = remainingAllocation;
            }

            if (fillAmount > 0) {
                bid.isFilled = true;
                bid.filledAmount = fillAmount;

                uint256 cost = (fillAmount * bid.price) / 1e18; // Convert to USDC
                totalRaised += cost;
                remainingAllocation -= fillAmount;
                clearingPrice = bid.price;
                filledBidsCount++;

                // Transfer tokens to bidder (for non-1inch orders)
                if (!bid.isOneInchOrder) {
                    IERC20(auction.tokenAddress).safeTransfer(
                        bid.bidder,
                        fillAmount
                    );
                }

                emit BidFilled(auctionId, bid.bidder, fillAmount, bid.price);
            }
        }

        // Calculate platform fee
        uint256 platformFee = (totalRaised * PLATFORM_FEE_BPS) / 10000;
        uint256 creatorAmount = totalRaised - platformFee;

        // Transfer USDC to creator and platform (for non-1inch settlements)
        if (creatorAmount > 0) {
            USDC.safeTransfer(auction.creator, creatorAmount);
        }
        if (platformFee > 0) {
            USDC.safeTransfer(owner(), platformFee);
        }

        // Return unsold tokens to creator
        if (remainingAllocation > 0) {
            IERC20(auction.tokenAddress).safeTransfer(
                auction.creator,
                remainingAllocation
            );
        }

        // Update auction state
        auction.isSettled = true;
        auction.clearingPrice = clearingPrice;
        auction.totalRaised = totalRaised;

        emit AuctionSettled(
            auctionId,
            clearingPrice,
            totalRaised,
            filledBidsCount
        );
    }

    /**
     * @dev Get auction details
     */
    function getAuction(
        bytes32 auctionId
    ) external view returns (Auction memory) {
        return auctions[auctionId];
    }

    /**
     * @dev Get bids for an auction
     */
    function getAuctionBids(
        bytes32 auctionId
    ) external view returns (Bid[] memory) {
        return auctionBids[auctionId];
    }

    /**
     * @dev Get auction ID from 1inch order hash
     */
    function getAuctionFromOrderHash(
        bytes32 orderHash
    ) external view returns (bytes32) {
        return orderHashToAuctionId[orderHash];
    }

    /**
     * @dev Get active auctions
     */
    function getActiveAuctions() external view returns (bytes32[] memory) {
        return activeAuctions;
    }

    /**
     * @dev Internal function to sort bids by price (descending)
     * @dev Simplified implementation - in production, consider more gas-efficient sorting
     */
    function _sortBidsByPrice(
        Bid[] storage bids
    ) internal view returns (uint256[] memory) {
        uint256 length = bids.length;
        uint256[] memory indexes = new uint256[](length);

        // Initialize indexes
        for (uint256 i = 0; i < length; i++) {
            indexes[i] = i;
        }

        // Simple bubble sort (for small arrays)
        for (uint256 i = 0; i < length - 1; i++) {
            for (uint256 j = 0; j < length - i - 1; j++) {
                if (bids[indexes[j]].price < bids[indexes[j + 1]].price) {
                    uint256 temp = indexes[j];
                    indexes[j] = indexes[j + 1];
                    indexes[j + 1] = temp;
                }
            }
        }

        return indexes;
    }

    // Emergency functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Emergency token recovery
     */
    function emergencyTokenRecovery(
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    /**
     * @dev Execute a bid using ERC20 permit signature (for automatic settlement)
     * @param owner The owner of the USDC tokens (bidder)
     * @param spender The address authorized to spend (this contract)
     * @param value The amount of USDC authorized
     * @param deadline The permit deadline
     * @param v Recovery parameter of permit signature
     * @param r R component of permit signature
     * @param s S component of permit signature
     * @param tokenAmount Amount of tokens to transfer to bidder
     * @param tokenAddress Address of the auction token
     */
    function executePermitBid(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 tokenAmount,
        address tokenAddress
    ) external onlyOwner nonReentrant {
        require(spender == address(this), "Invalid spender");
        require(block.timestamp <= deadline, "Permit expired");
        require(tokenAmount > 0, "Invalid token amount");

        // Get USDC contract with permit support
        IERC20Permit usdcPermit = IERC20Permit(address(USDC));
        IERC20 usdc = USDC;
        IERC20 auctionToken = IERC20(tokenAddress);

        // Execute permit to allow this contract to spend USDC
        usdcPermit.permit(owner, spender, value, deadline, v, r, s);

        // Calculate actual USDC cost based on clearing price
        // For now, we'll use the full permitted amount
        // In production, this should be calculated based on actual clearing price
        uint256 usdcAmount = value;

        // Transfer USDC from bidder to this contract
        usdc.safeTransferFrom(owner, address(this), usdcAmount);

        // Transfer auction tokens to bidder
        auctionToken.safeTransfer(owner, tokenAmount);

        emit PermitBidExecuted(
            keccak256(abi.encodePacked(tokenAddress, block.timestamp)), // placeholder auction ID
            owner,
            usdcAmount,
            tokenAmount
        );
    }
}
