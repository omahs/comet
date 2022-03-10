import { ethers, exp, expect, makeProtocol, ONE } from './helpers';
import {
  CometExt__factory,
  CometHarness__factory,
  FaucetToken__factory,
  SimplePriceFeed__factory,
} from '../build/types';

describe('constructor', function () {
  it('sets the baseBorrowMin', async function () {
    const { comet } = await makeProtocol({
      baseBorrowMin: exp(100,6)
    });
    expect(await comet.baseBorrowMin()).to.eq(exp(100,6));
  });

  it('does not verify configs', async function () {
    const [governor, pauseGuardian] = await ethers.getSigners();

    // extension delegate
    const CometExtFactory = (await ethers.getContractFactory('CometExt')) as CometExt__factory;
    const extensionDelegate = await CometExtFactory.deploy({
      symbol32: ethers.utils.formatBytes32String('📈BASE')
    });
    await extensionDelegate.deployed();

    // tokens
    const assets = {
      USDC: { decimals: 6 },
    };
    const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
    const tokens = {};
    for (const symbol in assets) {
      const config = assets[symbol];
      const decimals = config.decimals;
      const token = (tokens[symbol] = await FaucetFactory.deploy(1e6, symbol, decimals, symbol));
      await token.deployed();
    }

    // price feeds
    let priceFeeds = {};
    const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
    for (const asset in assets) {
      const priceFeed = await PriceFeedFactory.deploy(exp(1,8), 8);
      await priceFeed.deployed();
      priceFeeds[asset] = priceFeed;
    }

    const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
    const comet = await CometFactory.deploy({
      governor: governor.address,
      pauseGuardian: pauseGuardian.address,
      extensionDelegate: extensionDelegate.address,
      baseToken: tokens["USDC"].address,
      baseTokenPriceFeed: priceFeeds["USDC"].address,
      kink: exp(8, 17),
      perYearInterestRateBase: exp(5, 15),
      perYearInterestRateSlopeLow: exp(1, 17),
      perYearInterestRateSlopeHigh: exp(3, 18),
      reserveRate: exp(1, 17),
      storeFrontPriceFactor: exp(1, 18),
      trackingIndexScale: exp(1, 15),
      baseTrackingSupplySpeed: exp(1, 15),
      baseTrackingBorrowSpeed: exp(1, 15),
      baseMinForRewards: exp(1,6),
      baseBorrowMin: exp(1, 6),
      targetReserves: 0,
      assetConfigs: [{
        word_a: 0,
        word_b: 0,
      }],
    });
    expect((await comet.getAssetInfo(0)).asset).to.be.equal('0x0000000000000000000000000000000000000000');
  });

  it('reverts if baseTokenPriceFeed does not have 8 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {
            priceFeedDecimals: 18,
          },
        },
      })
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  // Note: with pre-packing we do not check this
  it.skip('reverts if asset has a price feed that does not have 8 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {},
          COMP: {
            initial: 1e7,
            decimals: 18,
            initialPrice: 1.2345,
            priceFeedDecimals: 18,
          },
        },
      })
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  it('reverts if base token has more than 18 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {
            decimals: 19,
          },
        },
      })
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  it('reverts if initializeStorage is called after initialization', async () => {
    const { comet } = await makeProtocol();
    await expect(
      comet.initializeStorage()
    ).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });
});
