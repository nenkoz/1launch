// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title AuctionToken
 * @dev Standard ERC20 token for auction launches
 */
// Minimal ERC20 token for efficient deployment
contract AuctionToken is ERC20 {
    uint8 private immutable _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint256 totalSupply,
        uint8 decimals_,
        address owner
    ) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(owner, totalSupply);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}

/**
 * @title TokenFactory
 * @dev Factory contract for deploying auction tokens
 */
contract TokenFactory is Ownable, Pausable {
    // Events
    event TokenDeployed(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply
    );

    // Tracking deployed tokens
    mapping(address => bool) public isDeployedToken;
    address[] public deployedTokens;
    mapping(address => address[]) public creatorTokens;

    // Fee structure
    uint256 public deploymentFee = 0; // No fee for testing
    address public feeRecipient;

    constructor(address _initialOwner, address _feeRecipient) Ownable() {
        feeRecipient = _feeRecipient;
        _transferOwnership(_initialOwner);
    }

    /**
     * @dev Deploy a new auction token
     * @param name Token name
     * @param symbol Token symbol
     * @param totalSupply Total supply (in wei units, accounting for decimals)
     * @param decimals Number of decimals
     */
    function deployToken(
        string memory name,
        string memory symbol,
        uint256 totalSupply,
        uint256 decimals
    ) external payable whenNotPaused returns (address tokenAddress) {
        require(msg.value >= deploymentFee, "Insufficient deployment fee");
        require(bytes(name).length > 0, "Empty name");
        require(bytes(symbol).length > 0, "Empty symbol");
        require(totalSupply > 0, "Invalid total supply");
        require(decimals <= 18, "Too many decimals");
        require(decimals <= 255, "Decimals must fit in uint8");

        // Deploy new token
        AuctionToken token = new AuctionToken(
            name,
            symbol,
            totalSupply,
            uint8(decimals), // Cast to uint8 for the token constructor
            msg.sender // Creator becomes owner
        );

        tokenAddress = address(token);

        // Track deployment
        isDeployedToken[tokenAddress] = true;
        deployedTokens.push(tokenAddress);
        creatorTokens[msg.sender].push(tokenAddress);

        // Transfer fee to recipient
        if (feeRecipient != address(0) && msg.value > 0) {
            payable(feeRecipient).transfer(msg.value);
        }

        emit TokenDeployed(tokenAddress, msg.sender, name, symbol, totalSupply);
    }

    /**
     * @dev Get tokens created by a specific address
     */
    function getCreatorTokens(
        address creator
    ) external view returns (address[] memory) {
        return creatorTokens[creator];
    }

    /**
     * @dev Get all deployed tokens
     */
    function getAllDeployedTokens() external view returns (address[] memory) {
        return deployedTokens;
    }

    /**
     * @dev Get total number of deployed tokens
     */
    function getDeployedTokenCount() external view returns (uint256) {
        return deployedTokens.length;
    }

    /**
     * @dev Update deployment fee (only owner)
     */
    function updateDeploymentFee(uint256 newFee) external onlyOwner {
        deploymentFee = newFee;
    }

    /**
     * @dev Update fee recipient (only owner)
     */
    function updateFeeRecipient(address newRecipient) external onlyOwner {
        feeRecipient = newRecipient;
    }

    /**
     * @dev Pause/unpause deployment
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Emergency withdrawal
     */
    function emergencyWithdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}
