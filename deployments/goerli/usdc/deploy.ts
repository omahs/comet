import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, cloneGov, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

const clone = {
  usdcImpl: '0xa2327a938Febf5FEC13baCFb16Ae10EcBc4cbDCF',
  usdcProxy: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  wbtc: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  link: '0x514910771af9ca656af840dff83e8264ecf986ca',
};

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  await mintTokens(deploymentManager);
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Deploy governance contracts
  const { COMP, fauceteer, timelock } = await cloneGov(deploymentManager);

  const usdcProxyAdmin = await deploymentManager.deploy('USDC:admin', 'vendor/proxy/transparent/ProxyAdmin.sol', []);
  const usdcImpl = await deploymentManager.clone('USDC:implementation', clone.usdcImpl, []);
  const usdcProxy = await deploymentManager.clone('USDC', clone.usdcProxy, [usdcImpl.address]);
  const usdcProxyAdminSlot = '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b';
  const USDC = usdcImpl.attach(usdcProxy.address);

  await deploymentManager.idempotent(
    async () => !sameAddress(await ethers.provider.getStorageAt(usdcProxy.address, usdcProxyAdminSlot), usdcProxyAdmin.address),
    async () => {
      trace(`Changing admin of USDC proxy to ${usdcProxyAdmin.address}`);
      trace(await wait(usdcProxy.connect(signer).changeAdmin(usdcProxyAdmin.address)));

      trace(`Initializing USDC`);
      trace(await wait(USDC.connect(signer).initialize(
        'USD Coin',     // name
        'USDC',         // symbol
        'USD',          // currency
        6,              // decimals
        signer.address, // Master Minter
        signer.address, // Pauser
        signer.address, // Blacklister
        signer.address  // Owner
      )));
    }
  );

  const WBTC = await deploymentManager.clone('WBTC', clone.wbtc, []);
  const WETH = await deploymentManager.clone('WETH', clone.weth, []);

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { rewards } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'Bulker.sol',
    [timelock.address, WETH.address]
  );

  await deploymentManager.idempotent(
    async () => (await COMP.balanceOf(rewards.address)).eq(0),
    async () => {
      trace(`Sending some COMP to CometRewards`);
      const amount = exp(1_000_000, 18);
      trace(await wait(COMP.connect(signer).transfer(rewards.address, amount)));
      trace(`COMP.balanceOf(${rewards.address}): ${await COMP.balanceOf(rewards.address)}`);
      trace(`COMP.balanceOf(${signer.address}): ${await COMP.balanceOf(signer.address)}`);
    }
  );

  return { ...deployed, fauceteer, bulker };
}

async function mintTokens(deploymentManager: DeploymentManager) {
  const trace = deploymentManager.tracer();
  const signer = await deploymentManager.getSigner();
  const contracts = await deploymentManager.contracts();
  const fauceteer = contracts.get('fauceteer');

  trace(`Attempting to mint as ${signer.address}...`);

  const WETH = contracts.get('WETH');
  await deploymentManager.idempotent(
    async () => (await WETH.balanceOf(signer.address)).lt(exp(0.01, 18)),
    async () => {
      trace(`Minting 0.01 WETH for signer (this is a precious resource!)`);
      trace(await wait(WETH.connect(signer).deposit({ value: exp(0.01, 18) })));
      trace(`WETH.balanceOf(${signer.address}): ${await WETH.balanceOf(signer.address)}`);
    }
  );

  // If we haven't spidered new contracts (which we could before minting, but its slow),
  //  then the proxy contract won't have the impl functions yet, so just do it explicitly
  const usdcProxy = contracts.get('USDC'), usdcImpl = contracts.get('USDC:implementation');
  const USDC = usdcImpl.attach(usdcProxy.address);
  await deploymentManager.idempotent(
    async () => (await USDC.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 100M USDC to fauceteer`);
      const amount = exp(100_000_000, await USDC.decimals());
      trace(await wait(USDC.connect(signer).configureMinter(signer.address, amount)));
      trace(await wait(USDC.connect(signer).mint(fauceteer.address, amount)));
      trace(`USDC.balanceOf(${fauceteer.address}): ${await USDC.balanceOf(fauceteer.address)}`);
    }
  );

  const WBTC = contracts.get('WBTC');
  await deploymentManager.idempotent(
    async () => (await WBTC.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 20 WBTC to fauceteer`);
      const amount = exp(20, await WBTC.decimals());
      trace(await wait(WBTC.connect(signer).mint(fauceteer.address, amount)));
      trace(`WBTC.balanceOf(${fauceteer.address}): ${await WBTC.balanceOf(fauceteer.address)}`);
    }
  );
}