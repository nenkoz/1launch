// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuctionResolver
 * @dev Resolver for filling private auction orders
 * This contract acts as a resolver to fill 1inch limit orders for private auctions
 */
contract AuctionResolver is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // State variables
    mapping(bytes32 => bool) public filledOrders;
    mapping(address => bool) public authorizedFillers;
    
    // Events
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
    error OrderAlreadyFilled();
    error UnauthorizedFiller();
    error InvalidOrder();
    error InsufficientBalance();

    constructor() {
        _transferOwnership(msg.sender);
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
     * @dev Fill a private auction order
     * This function is called by authorized fillers to execute orders
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
    ) external nonReentrant {
        // Check authorization
        if (!authorizedFillers[msg.sender]) revert UnauthorizedFiller();
        
        // Check if order already filled
        if (filledOrders[orderHash]) revert OrderAlreadyFilled();

        // Mark order as filled
        filledOrders[orderHash] = true;

        // Transfer tokens from maker to resolver (this contract)
        IERC20(makerAsset).safeTransferFrom(maker, address(this), makingAmount);

        // Transfer tokens from resolver to maker
        IERC20(takerAsset).safeTransfer(maker, takingAmount);

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
    ) external nonReentrant {
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

            // Transfer tokens from maker to resolver (this contract)
            IERC20(makerAssets[i]).safeTransferFrom(
                makers[i], 
                address(this), 
                makingAmounts[i]
            );

            // Transfer tokens from resolver to maker
            IERC20(takerAssets[i]).safeTransfer(
                makers[i], 
                takingAmounts[i]
            );

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
} 