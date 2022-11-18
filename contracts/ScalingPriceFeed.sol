// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract ScalingPriceFeed is AggregatorV3Interface {
    /** Custom errors **/
    error InvalidInt256();

    /// @notice Version of the price feed
    uint public constant override version = 1;

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice Underlying Chainlink price feed where prices are fetched from
    address public immutable underlyingPriceFeed;

    /// @notice Description of the price feed
    string public description;

    /// @notice Whether or not the price should be upscaled
    bool internal immutable shouldUpscale;

    /// @notice The amount to upscale or downscale the price by
    int256 internal immutable rescaleFactor;

    /**
     * @notice Construct a new scaling price feed
     * @param underlyingPriceFeed_ The address of the underlying price feed to fetch prices from
     * @param decimals_ The number of decimals for the returned prices
     **/
    constructor(address underlyingPriceFeed_, uint8 decimals_) {
        underlyingPriceFeed = underlyingPriceFeed_;
        decimals = decimals_;
        description = AggregatorV3Interface(underlyingPriceFeed_).description();

        uint8 chainlinkPriceFeedDecimals = AggregatorV3Interface(underlyingPriceFeed_).decimals();
        // Note: Solidity does not allow setting immutables in if/else statements
        shouldUpscale = chainlinkPriceFeedDecimals < decimals_ ? true : false;
        rescaleFactor = (shouldUpscale
            ? signed256(10 ** (decimals_ - chainlinkPriceFeedDecimals))
            : signed256(10 ** (chainlinkPriceFeedDecimals - decimals_))
        );
    }

    /**
     * @notice Price for a specific round
     * @param roundId_ The round id to fetch the price for
     * @return roundId Round id from the underlying price feed
     * @return answer Latest price for the asset in terms of ETH
     * @return startedAt Timestamp when the round was started; passed on from underlying price feed
     * @return updatedAt Timestamp when the round was last updated; passed on from underlying price feed
     * @return answeredInRound Round id in which the answer was computed; passed on from underlying price feed
     **/
    function getRoundData(uint80 roundId_) external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        (uint80 roundId, int256 price, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) = AggregatorV3Interface(underlyingPriceFeed).getRoundData(roundId_);
        return (roundId, scalePrice(price), startedAt, updatedAt, answeredInRound);
    }

    /**
     * @notice Price for the latest round
     * @return roundId Round id from the underlying price feed
     * @return answer Latest price for the asset in terms of ETH
     * @return startedAt Timestamp when the round was started; passed on from underlying price feed
     * @return updatedAt Timestamp when the round was last updated; passed on from underlying price feed
     * @return answeredInRound Round id in which the answer was computed; passed on from underlying price feed
     **/
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        (uint80 roundId, int256 price, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) = AggregatorV3Interface(underlyingPriceFeed).latestRoundData();
        return (roundId, scalePrice(price), startedAt, updatedAt, answeredInRound);
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
    }

    function scalePrice(int256 price) internal view returns (int256) {
        int256 scaledPrice;
        if (shouldUpscale) {
            scaledPrice = price * rescaleFactor;
        } else {
            scaledPrice = price / rescaleFactor;
        }
        return scaledPrice;
    }
}