// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "openzeppelin-contracts/security/ReentrancyGuard.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";
import {Pausable} from "openzeppelin-contracts/security/Pausable.sol";

/**
 * @title AuctionControllerWithResolver
 * @dev Combined auction controller and resolver for private auction bids
 * This contract handles both auction management and order execution
 */
contract AuctionControllerWithResolver is ReentrancyGuard, Ownable, Pausable {
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

    // Resolver state variables
    mapping(bytes32 => bool) public filledOrders;
    mapping(address => bool) public authorizedFillers;

    IERC20 public immutable USDC;
    address public immutable ONE_INCH_AGGREGATION_ROUTER;

    bytes32[] public activeAuctions;
    uint256 public constant MIN_AUCTION_DURATION = 1 minutes; // Minimum 1 minute duration
    uint256 public constant MAX_AUCTION_DURATION = 7 days; // Maximum 7 days duration
    uint256 public constant PLATFORM_FEE_BPS = 250; // 2.5% platform fee

    // Events
    event AuctionCreated(
        bytes32 indexed auctionId,
        address indexed tokenAddress,
        address indexed creator,
        uint256 totalSupply,
        uint256 targetAllocation,
        uint256 startTime,
        uint256 endTime
    );

    event BidPlaced(
        bytes32 indexed auctionId,
        address indexed bidder,
        uint256 price,
        uint256 quantity,
        bytes32 orderHash
    );

    event BidFilled(
        bytes32 indexed auctionId,
        address indexed bidder,
        uint256 filledAmount,
        uint256 price
    );

    event AuctionSettled(
        bytes32 indexed auctionId,
        uint256 clearingPrice,
        uint256 totalRaised,
        uint256 filledBidsCount
    );

    event OneInchOrderProcessed(
        bytes32 indexed auctionId,
        bytes32 indexed orderHash,
        address indexed maker,
        uint256 makingAmount,
        uint256 takingAmount
    );

    // Resolver events
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed resolver,
        uint256 makingAmount,
        uint256 takingAmount
    );

    event FillerAuthorized(address indexed filler);
    event FillerRevoked(address indexed filler);

    // Errors
    error AuctionNotFound();
    error AuctionAlreadyExists();
    error AuctionNotActive();
    error AuctionEnded();
    error AuctionNotEnded();
    error AuctionAlreadySettled();
    error InvalidBid();
    error BidTooLow();
    error OrderNotFound();
    error OrderNotActive();
    error OrderExpired();
    error OrderAlreadyFilled();
    error UnauthorizedFiller();
    error InvalidOrder();
    error InsufficientBalance();

    constructor(
        address _usdc,
        address _oneInchRouter
    ) Ownable(msg.sender) {
        USDC = IERC20(_usdc);
        ONE_INCH_AGGREGATION_ROUTER = _oneInchRouter;
    }

    /**
     * @dev Create a new auction
     */
    function createAuction(
        address tokenAddress,
        uint256 totalSupply,
        uint256 targetAllocation,
        uint256 startTime,
        uint256 endTime,
        string calldata metadataURI
    ) external whenNotPaused returns (bytes32 auctionId) {
        if (tokenAddress == address(0)) revert InvalidOrder();
        if (totalSupply == 0) revert InvalidOrder();
        if (targetAllocation == 0 || targetAllocation > totalSupply) revert InvalidOrder();
        if (startTime >= endTime) revert InvalidOrder();
        if (endTime - startTime < MIN_AUCTION_DURATION) revert InvalidOrder();
        if (endTime - startTime > MAX_AUCTION_DURATION) revert InvalidOrder();

        auctionId = keccak256(
            abi.encodePacked(
                tokenAddress,
                totalSupply,
                targetAllocation,
                startTime,
                endTime,
                msg.sender,
                block.timestamp
            )
        );

        if (auctions[auctionId].creator != address(0)) revert AuctionAlreadyExists();

        auctions[auctionId] = Auction({
            tokenAddress: tokenAddress,
            totalSupply: totalSupply,
            targetAllocation: targetAllocation,
            startTime: startTime,
            endTime: endTime,
            creator: msg.sender,
            isSettled: false,
            clearingPrice: 0,
            totalRaised: 0,
            metadataURI: metadataURI
        });

        activeAuctions.push(auctionId);

        emit AuctionCreated(
            auctionId,
            tokenAddress,
            msg.sender,
            totalSupply,
            targetAllocation,
            startTime,
            endTime
        );
    }

    /**
     * @dev Place a bid for an auction
     */
    function placeBid(
        bytes32 auctionId,
        uint256 price,
        uint256 quantity,
        bytes32 orderHash
    ) external whenNotPaused {
        Auction storage auction = auctions[auctionId];
        if (auction.creator == address(0)) revert AuctionNotFound();
        if (block.timestamp < auction.startTime) revert AuctionNotActive();
        if (block.timestamp > auction.endTime) revert AuctionEnded();
        if (auction.isSettled) revert AuctionAlreadySettled();
        if (price == 0 || quantity == 0) revert InvalidBid();

        // Check if bidder already has a bid
        uint256 existingBidIndex = bidderIndexes[auctionId][msg.sender];
        if (existingBidIndex > 0) {
            // Update existing bid
            Bid storage existingBid = auctionBids[auctionId][existingBidIndex - 1];
            existingBid.price = price;
            existingBid.quantity = quantity;
            existingBid.orderHash = orderHash;
            existingBid.isOneInchOrder = orderHash != bytes32(0);
        } else {
            // Create new bid
            auctionBids[auctionId].push(Bid({
                bidder: msg.sender,
                price: price,
                quantity: quantity,
                orderHash: orderHash,
                isFilled: false,
                filledAmount: 0,
                isOneInchOrder: orderHash != bytes32(0)
            }));

            bidderIndexes[auctionId][msg.sender] = auctionBids[auctionId].length;
        }

        // Map order hash to auction ID for 1inch integration
        if (orderHash != bytes32(0)) {
            orderHashToAuctionId[orderHash] = auctionId;
        }

        emit BidPlaced(auctionId, msg.sender, price, quantity, orderHash);
    }

    /**
     * @dev Fill a private auction order (resolver functionality)
     */
    function fillPrivateAuctionOrder(
        bytes32 orderHash,
        address maker,
        address makerAsset,
        address takerAsset,
        uint256 makingAmount,
        uint256 takingAmount,
        bytes calldata orderData,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        // Check authorization
        if (!authorizedFillers[msg.sender]) revert UnauthorizedFiller();
        
        // Check if order already filled
        if (filledOrders[orderHash]) revert OrderAlreadyFilled();

        // Mark order as filled
        filledOrders[orderHash] = true;

        // Transfer tokens from maker to this contract
        IERC20(makerAsset).safeTransferFrom(maker, address(this), makingAmount);

        // Transfer tokens from this contract to maker
        IERC20(takerAsset).safeTransfer(maker, takingAmount);

        // Update auction bid if this is a 1inch order
        bytes32 auctionId = orderHashToAuctionId[orderHash];
        if (auctionId != bytes32(0)) {
            Bid[] storage bids = auctionBids[auctionId];
            for (uint256 i = 0; i < bids.length; i++) {
                if (bids[i].orderHash == orderHash) {
                    bids[i].isFilled = true;
                    bids[i].filledAmount = takingAmount;

                    emit OneInchOrderProcessed(
                        auctionId,
                        orderHash,
                        maker,
                        makingAmount,
                        takingAmount
                    );
                    emit BidFilled(
                        auctionId,
                        maker,
                        takingAmount,
                        bids[i].price
                    );
                    break;
                }
            }
        }

        emit OrderFilled(
            orderHash,
            maker,
            msg.sender,
            makingAmount,
            takingAmount
        );
    }

    /**
     * @dev Batch fill multiple private auction orders
     */
    function fillBatchPrivateAuctionOrders(
        bytes32[] calldata orderHashes,
        address[] calldata makers,
        address[] calldata makerAssets,
        address[] calldata takerAssets,
        uint256[] calldata makingAmounts,
        uint256[] calldata takingAmounts,
        bytes[] calldata orderData,
        bytes[] calldata signatures
    ) external nonReentrant whenNotPaused {
        // Check authorization
        if (!authorizedFillers[msg.sender]) revert UnauthorizedFiller();
        
        // Validate array lengths
        require(
            orderHashes.length == makers.length &&
            makers.length == makerAssets.length &&
            makerAssets.length == takerAssets.length &&
            takerAssets.length == makingAmounts.length &&
            makingAmounts.length == takingAmounts.length &&
            takingAmounts.length == orderData.length &&
            orderData.length == signatures.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < orderHashes.length; i++) {
            // Check if order already filled
            if (filledOrders[orderHashes[i]]) continue;

            // Mark order as filled
            filledOrders[orderHashes[i]] = true;

            // Transfer tokens from maker to this contract
            IERC20(makerAssets[i]).safeTransferFrom(
                makers[i], 
                address(this), 
                makingAmounts[i]
            );

            // Transfer tokens from this contract to maker
            IERC20(takerAssets[i]).safeTransfer(
                makers[i], 
                takingAmounts[i]
            );

            // Update auction bid if this is a 1inch order
            bytes32 auctionId = orderHashToAuctionId[orderHashes[i]];
            if (auctionId != bytes32(0)) {
                Bid[] storage bids = auctionBids[auctionId];
                for (uint256 j = 0; j < bids.length; j++) {
                    if (bids[j].orderHash == orderHashes[i]) {
                        bids[j].isFilled = true;
                        bids[j].filledAmount = takingAmounts[i];

                        emit OneInchOrderProcessed(
                            auctionId,
                            orderHashes[i],
                            makers[i],
                            makingAmounts[i],
                            takingAmounts[i]
                        );
                        emit BidFilled(
                            auctionId,
                            makers[i],
                            takingAmounts[i],
                            bids[j].price
                        );
                        break;
                    }
                }
            }

            emit OrderFilled(
                orderHashes[i],
                makers[i],
                msg.sender,
                makingAmounts[i],
                takingAmounts[i]
            );
        }
    }

    /**
     * @dev Settle auction and execute winning bids
     */
    function settleAuction(
        bytes32 auctionId
    ) external whenNotPaused {
        Auction storage auction = auctions[auctionId];
        if (auction.creator == address(0)) revert AuctionNotFound();
        if (block.timestamp < auction.endTime) revert AuctionNotEnded();
        if (auction.isSettled) revert AuctionAlreadySettled();

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

            // Skip already filled 1inch orders (they were executed via resolver)
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
     * @dev Authorize a filler to execute orders
     */
    function authorizeFiller(address filler) external onlyOwner {
        authorizedFillers[filler] = true;
        emit FillerAuthorized(filler);
    }

    /**
     * @dev Revoke filler authorization
     */
    function revokeFiller(address filler) external onlyOwner {
        authorizedFillers[filler] = false;
        emit FillerRevoked(filler);
    }

    /**
     * @dev Check if an order has been filled
     */
    function isOrderFilled(bytes32 orderHash) external view returns (bool) {
        return filledOrders[orderHash];
    }

    /**
     * @dev Check if an address is authorized to fill orders
     */
    function isAuthorizedFiller(address filler) external view returns (bool) {
        return authorizedFillers[filler];
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
     * @dev Get active auctions
     */
    function getActiveAuctions() external view returns (bytes32[] memory) {
        return activeAuctions;
    }

    /**
     * @dev Sort bids by price (highest first)
     */
    function _sortBidsByPrice(
        Bid[] storage bids
    ) internal view returns (uint256[] memory) {
        uint256[] memory indexes = new uint256[](bids.length);
        for (uint256 i = 0; i < bids.length; i++) {
            indexes[i] = i;
        }

        // Simple bubble sort for gas efficiency
        for (uint256 i = 0; i < indexes.length; i++) {
            for (uint256 j = i + 1; j < indexes.length; j++) {
                if (bids[indexes[i]].price < bids[indexes[j]].price) {
                    uint256 temp = indexes[i];
                    indexes[i] = indexes[j];
                    indexes[j] = temp;
                }
            }
        }

        return indexes;
    }

    /**
     * @dev Emergency function to recover stuck tokens
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    /**
     * @dev Get contract balance of a token
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @dev Pause/unpause contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
} 