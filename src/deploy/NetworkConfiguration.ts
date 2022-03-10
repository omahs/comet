import * as path from 'path';
import * as fs from 'fs/promises';
import { Contract } from 'ethers';

import { AssetConfigStruct } from '../../build/types/Comet';
import { ProtocolConfiguration } from './index';
import { BigNumberish, Signature, ethers } from 'ethers';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { fileExists } from '../../plugins/deployment_manager/Utils';

function isAddress(a: string): boolean {
  return a.match(/^0x[a-fA-F0-9]{40}$/) !== null;
}

function address(a: string): string {
  if (!isAddress(a)) {
    throw new Error(`expected address, got \`${a}\``);
  }

  return a;
}

function floor(n: number): bigint {
  return BigInt(Math.floor(n));
}

function number(n: number, checkRange: boolean = true): bigint {
  return floor(Number(n));
}

function percentage(n: number, checkRange: boolean = true): bigint {
  if (checkRange) {
    if (n > 1.0) {
      throw new Error(`percentage greater than 100% [received=${n}]`);
    } else if (n < 0) {
      throw new Error(`percentage less than 0% [received=${n}]`);
    }
  }

  return floor(n * 1e18);
}

interface NetworkRateConfiguration {
  kink: number;
  slopeLow: number;
  slopeHigh: number;
  base: number;
}

interface NetworkTrackingConfiguration {
  indexScale: number;
  baseSupplySpeed: number;
  baseBorrowSpeed: number;
  baseMinForRewards: number;
}

interface NetworkAssetConfiguration {
  priceFeed: string;
  decimals: number;
  borrowCF: number;
  liquidateCF: number;
  liquidationFactor: number;
  supplyCap: number;
}

interface NetworkConfiguration {
  symbol: string;
  governor: string;
  pauseGuardian: string;
  baseToken: string;
  baseTokenPriceFeed: string;
  reserveRate: number;
  borrowMin: number;
  storeFrontPriceFactor: number;
  targetReserves: number;
  rates: NetworkRateConfiguration;
  tracking: NetworkTrackingConfiguration;
  assets: { [name: string]: NetworkAssetConfiguration };
}

interface InterestRateInfo {
  kink: BigNumberish;
  perYearInterestRateSlopeLow: BigNumberish;
  perYearInterestRateSlopeHigh: BigNumberish;
  perYearInterestRateBase: BigNumberish;
}

interface TrackingInfo {
  trackingIndexScale: BigNumberish;
  baseTrackingSupplySpeed: BigNumberish;
  baseTrackingBorrowSpeed: BigNumberish;
  baseMinForRewards: BigNumberish;
}

function getContractAddress(contractName: string, contractMap: ContractMap): string {
  let contract = contractMap.get(contractName);
  if (!contract) {
    throw new Error(
      `Cannot find contract \`${contractName}\` in contract map with keys \`${JSON.stringify(
        [...contractMap.keys()]
      )}\``
    );
  }
  return contract.address;
}

function getInterestRateInfo(rates: NetworkRateConfiguration): InterestRateInfo {
  return {
    kink: percentage(rates.kink),
    perYearInterestRateSlopeLow: percentage(rates.slopeLow),
    perYearInterestRateSlopeHigh: percentage(rates.slopeHigh),
    perYearInterestRateBase: percentage(rates.base),
  };
}

function getTrackingInfo(tracking: NetworkTrackingConfiguration): TrackingInfo {
  return {
    trackingIndexScale: number(tracking.indexScale),
    baseTrackingSupplySpeed: number(tracking.baseSupplySpeed),
    baseTrackingBorrowSpeed: number(tracking.baseBorrowSpeed),
    baseMinForRewards: number(tracking.baseMinForRewards),
  };
}

export function packAssetConfig(assetAddress: string, assetConfig: NetworkAssetConfiguration): AssetConfigStruct {
    const descale = (10n**18n) / (10n**4n);
    let priceFeedAddress = address(assetConfig.priceFeed);
    let decimals = BigInt(assetConfig.decimals);
    let borrowCF = BigInt(percentage(assetConfig.borrowCF));
    let liquidateCF = BigInt(percentage(assetConfig.liquidateCF));
    let liquidationFactor = BigInt(percentage(assetConfig.liquidationFactor));
    let supplyCap = BigInt(number(assetConfig.supplyCap)); // TODO: Decimals (what?)
    return {
      word_a: (
        (BigInt(assetAddress)) |
          ((borrowCF / descale) << 160n) |
          ((liquidateCF / descale) << 176n) |
          ((liquidationFactor / descale) << 192n)
      ),
      word_b: (
        (BigInt(priceFeedAddress)) |
          (decimals << 160n) |
          ((supplyCap / (10n**decimals)) << 168n)
      ),
    };
}

function getAssetConfigs(
  assets: { [name: string]: NetworkAssetConfiguration },
  contractMap: ContractMap
): AssetConfigStruct[] {
  return Object.entries(assets).map(([assetName, assetConfig]) => {
    return packAssetConfig(getContractAddress(assetName, contractMap), assetConfig);
  });
}

function getNetworkConfigurationFilePath(network: string): string {
  return path.join(__dirname, '..', '..', 'deployments', network, 'configuration.json');
}

export async function hasNetworkConfiguration(network: string): Promise<boolean> {
  let configurationFile = getNetworkConfigurationFilePath(network);
  return await fileExists(configurationFile);
}

async function loadNetworkConfiguration(network: string): Promise<NetworkConfiguration> {
  let configurationFile = getNetworkConfigurationFilePath(network);
  let configurationJson = await fs.readFile(configurationFile, 'utf8');
  return JSON.parse(configurationJson) as NetworkConfiguration;
}

export async function getConfiguration(
  network: string,
  hre: HardhatRuntimeEnvironment,
  contractMapOverride?: ContractMap
): Promise<ProtocolConfiguration> {
  let networkConfiguration = await loadNetworkConfiguration(network);
  let deploymentManager = new DeploymentManager(network, hre);
  let contractMap = contractMapOverride ?? await deploymentManager.contracts();

  let symbol = networkConfiguration.symbol;
  let baseToken = getContractAddress(networkConfiguration.baseToken, contractMap);
  let baseTokenPriceFeed = address(networkConfiguration.baseTokenPriceFeed);
  let governor = address(networkConfiguration.governor);
  let pauseGuardian = address(networkConfiguration.pauseGuardian);
  let reserveRate = percentage(networkConfiguration.reserveRate);
  let baseBorrowMin = number(networkConfiguration.borrowMin); // TODO: in token units (?)
  let storeFrontPriceFactor = number(networkConfiguration.storeFrontPriceFactor);
  let targetReserves = number(networkConfiguration.targetReserves);

  let interestRateInfo = getInterestRateInfo(networkConfiguration.rates);
  let trackingInfo = getTrackingInfo(networkConfiguration.tracking);

  let assetConfigs = getAssetConfigs(networkConfiguration.assets, contractMap);

  return {
    symbol,
    governor,
    pauseGuardian,
    baseToken,
    baseTokenPriceFeed,
    ...interestRateInfo,
    reserveRate,
    storeFrontPriceFactor,
    ...trackingInfo,
    baseBorrowMin,
    targetReserves,
    assetConfigs,
  };
}
