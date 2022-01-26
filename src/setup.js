import config from './config';
import { ChainService, SubstrateChainUtils } from '@deip/chain-service';
import { genSha256Hash } from '@deip/toolbox';
import { PROTOCOL_CHAIN } from '@deip/constants';
import { u8aToHex } from '@polkadot/util';
import { Keyring } from '@polkadot/api';
import { MongoTools } from 'node-mongotools';
import {
  CreateDaoCmd,
  CreateAssetCmd,
  IssueAssetCmd,
  TransferAssetCmd,
  AddDaoMemberCmd
} from '@deip/command-models';



setupTenantPortal()
  .then(() => {
    console.log('\nRunning Casimir tx-builder...\n');
  })
  .then(() => {
    console.log('Successfully finished !');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });


async function setupTenantPortal() {
  console.log(`Setting up Tenant Portal ...`);
  await createReadModelStorage();
  await createFaucetDao();
  await createTenantDao();
  await createDefaultFaucetAssets();
  console.log(`Tenant Portal is set.`);
}


async function getChainService() {
  const chainService = await ChainService.getInstanceAsync({
    PROTOCOL: config.DEIP_PROTOCOL_CHAIN,
    DEIP_FULL_NODE_URL: config.DEIP_APPCHAIN_NODE_URL,
    CORE_ASSET: config.DEIP_APPCHAIN_CORE_ASSET,
    CHAIN_ID: config.DEIP_CHAIN_ID
  });
  return chainService;
}


async function createFaucetDao() {
  const chainService = await getChainService();
  const chainTxBuilder = chainService.getChainTxBuilder();
  const api = chainService.getChainNodeClient();
  const rpc = chainService.getChainRpc();
  const { username: faucetDaoId, wif: faucetSeed } = config.DEIP_APPCHAIN_FAUCET_ACCOUNT;

  const existingFaucetDao = await rpc.getAccountAsync(faucetDaoId);
  if (existingFaucetDao)
    return existingFaucetDao;

  const owner = { auths: [], weight: 1 };
  if (PROTOCOL_CHAIN.SUBSTRATE == config.DEIP_PROTOCOL_CHAIN) {
    const seedPubKey = u8aToHex(getFaucetSeedAccount().publicKey).substring(2);
    owner.auths.push({ key: seedPubKey })
  } else {
    owner.auths.push({ name: faucetDaoId })
  }

  console.log(`Creating Faucet DAO ...`);
  const createFaucetDaoTx = await chainTxBuilder.begin()
    .then((txBuilder) => {
      const createDaoCmd = new CreateDaoCmd({
        entityId: faucetDaoId,
        authority: { owner },
        creator: "faucet",
        memoKey: "faucet",
        description: genSha256Hash({ "description": "Faucet DAO" }),
        // offchain
        isTeamAccount: false,
        attributes: []
      });
      txBuilder.addCmd(createDaoCmd);
      return txBuilder.end();
    });

  const createFaucetDaoTxSigned = await createFaucetDaoTx.signAsync(faucetSeed, api);
  await sendTxAndWaitAsync(createFaucetDaoTxSigned);
  const faucetDao = await rpc.getAccountAsync(faucetDaoId);
  console.log(`Faucet DAO created`, /*faucetDao*/);

  if (PROTOCOL_CHAIN.SUBSTRATE == config.DEIP_PROTOCOL_CHAIN) {
    const faucetDaoAddress = daoIdToSubstrateAddress(faucetDaoId, api);
    const tx = api.tx.balances.transfer(faucetDaoAddress, config.DEIP_APPCHAIN_FAUCET_DAO_FUNDING_AMOUNT);
    await tx.signAsync(getFaucetSeedAccount());
    await api.rpc.author.submitExtrinsic(tx.toHex());
    await waitAsync(config.DEIP_APPCHAIN_MILLISECS_PER_BLOCK);
  }

  return faucetDao;
}


async function createTenantDao() {
  const chainService = await getChainService();
  const chainTxBuilder = chainService.getChainTxBuilder();
  const api = chainService.getChainNodeClient();
  const rpc = chainService.getChainRpc();
  const { id: tenantDaoId, privKey: tenantPrivKey, members } = config.DEIP_PORTAL_TENANT;
  const tenantSeed = await chainService.generateChainSeedAccount({ username: tenantDaoId, privateKey: tenantPrivKey });

  const existingTenantDao = await rpc.getAccountAsync(tenantDaoId);
  if (!existingTenantDao) {
    console.log(`Creating Tenant DAO ...`);
    await fundAddressFromFaucet(tenantSeed.getPubKey(), config.DEIP_APPCHAIN_DAO_SEED_FUNDING_AMOUNT);
    const createTenantDaoTx = await chainTxBuilder.begin()
      .then((txBuilder) => {
        const createDaoCmd = new CreateDaoCmd({
          entityId: tenantDaoId,
          authority: {
            owner: {
              auths: [{ key: tenantSeed.getPubKey(), weight: 1 }],
              weight: 1
            }
          },
          creator: getDaoCreator(tenantSeed),
          description: genSha256Hash({ "description": "Tenant DAO" }),
          // offchain
          isTeamAccount: true,
          attributes: []
        });

        txBuilder.addCmd(createDaoCmd);
        return txBuilder.end();
      });

    const createTenantDaoBytenantSeedTx = await createTenantDaoTx.signAsync(getDaoCreatorPrivKey(tenantSeed), api);
    await sendTxAndWaitAsync(createTenantDaoBytenantSeedTx);
    await fundAddressFromFaucet(tenantDaoId, config.DEIP_APPCHAIN_DAO_FUNDING_AMOUNT);

    const createdTenantDao = await rpc.getAccountAsync(tenantDaoId);
    console.log(`Tenant DAO created`, /*createdTenantDao*/);
  }

  const tenantDao = await rpc.getAccountAsync(tenantDaoId);
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const { daoId: tenantMemberDaoId, password } = member;
    const tenantMember = await chainService.generateChainSeedAccount({ username: tenantMemberDaoId, password: password });

    const existingTenantMemberDao = await rpc.getAccountAsync(tenantMemberDaoId);
    if (!existingTenantMemberDao) {
      console.log(`Creating Tenant Member DAO ...`);
      await fundAddressFromFaucet(tenantMember.getPubKey(), config.DEIP_APPCHAIN_DAO_SEED_FUNDING_AMOUNT);
      const createTenantMemberDaoTx = await chainTxBuilder.begin()
        .then((txBuilder) => {
          const createDaoCmd = new CreateDaoCmd({
            entityId: tenantMemberDaoId,
            authority: {
              owner: {
                auths: [{ key: tenantMember.getPubKey(), weight: 1 }],
                weight: 1
              }
            },
            creator: getDaoCreator(tenantMember),
            description: genSha256Hash({ "description": "Tenant DAO" }),
            // offchain
            isTeamAccount: false,
            attributes: []
          });

          txBuilder.addCmd(createDaoCmd);
          return txBuilder.end();
        });

      const createTenantMemberDaoBytenantSeedTx = await createTenantMemberDaoTx.signAsync(getDaoCreatorPrivKey(tenantMember), api);
      await sendTxAndWaitAsync(createTenantMemberDaoBytenantSeedTx);
      await fundAddressFromFaucet(tenantMemberDaoId, config.DEIP_APPCHAIN_DAO_FUNDING_AMOUNT);

      const createdTenantMemberDao = await rpc.getAccountAsync(tenantDaoId);
      console.log(`Tenant Member DAO`, /*createdTenantMemberDao*/);
    }

    const isMember = tenantDao.authority.owner.auths.some((auth) => auth.daoId == tenantMemberDaoId);
    if (!isMember) {
      console.log(`Adding Tenant Member DAO ${tenantMemberDaoId} to Tenant DAO ${tenantDaoId} ...`);
      const addTenantMemberDaoToTenantDaoTx = await chainTxBuilder.begin()
        .then((txBuilder) => {
          const addDaoMemberCmd = new AddDaoMemberCmd({
            teamId: tenantDaoId,
            member: tenantMemberDaoId,
            isThresholdPreserved: true
          });

          txBuilder.addCmd(addDaoMemberCmd);
          return txBuilder.end();
        });
      const addTenantMemberDaoToTenantDaoByTenantDaoTx = await addTenantMemberDaoToTenantDaoTx.signAsync(tenantSeed.getPrivKey(), api);
      await sendTxAndWaitAsync(addTenantMemberDaoToTenantDaoByTenantDaoTx);
    }

  }

  const updatedTenantDao = await rpc.getAccountAsync(tenantDaoId);
  console.log(`Tenant DAO finalized`, /*updatedTenantDao*/);
  return updatedTenantDao;
}


async function createDefaultFaucetAssets() {
  const chainService = await getChainService();
  const chainTxBuilder = chainService.getChainTxBuilder();
  const api = chainService.getChainNodeClient();
  const rpc = chainService.getChainRpc();
  const { username: faucetDaoId, wif: faucetSeed } = config.DEIP_APPCHAIN_FAUCET_ACCOUNT;
  const defautFaucetAssets = config.DEIP_APPCHAIN_FAUCET_ASSETS;

  const assets = [];
  for (let i = 0; i < defautFaucetAssets.length; i++) {
    const defautFaucetAsset = defautFaucetAssets[i];
    const { id: assetId, symbol, precision } = defautFaucetAsset;

    const existingAsset = await rpc.getAssetAsync(assetId);
    if (existingAsset) {
      assets.push(existingAsset);
      continue;
    }

    console.log(`Creating and issuing ${symbol} asset to ${faucetDaoId} DAO ...`);
    const createAndIssueAssetTx = await chainTxBuilder.begin()
      .then((txBuilder) => {

        const maxSupply = 999999999999999;
        const createAssetCmd = new CreateAssetCmd({
          entityId: assetId,
          issuer: faucetDaoId,
          name: `Stablecoin ${symbol}`,
          symbol: symbol,
          precision: precision,
          description: "",
          minBalance: 1,
          maxSupply: maxSupply
        });
        txBuilder.addCmd(createAssetCmd);

        const issueAssetCmd = new IssueAssetCmd({
          issuer: faucetDaoId,
          asset: { "id": assetId, symbol, precision, "amount": maxSupply },
          recipient: faucetDaoId
        });
        txBuilder.addCmd(issueAssetCmd);

        return txBuilder.end();
      });

    const createAndIssueAssetByFaucetDaoTx = await createAndIssueAssetTx.signAsync(faucetSeed, api);
    await sendTxAndWaitAsync(createAndIssueAssetByFaucetDaoTx);
    const asset = await rpc.getAssetAsync(assetId);
    assets.push(asset);
    console.log(`${symbol} asset created and issued to ${faucetDaoId} DAO`, /*asset*/);
  }

  return assets;
}


async function createReadModelStorage() {
  const mongoTools = new MongoTools();
  const mongorestorePromise = mongoTools.mongorestore({
    uri: config.DEIP_APPCHAIN_READ_MODEL_STORAGE,
    dumpFile: `${__dirname}/mongodump.gz`,
  })
    .then((success) => {
      console.info("success", success.message);
      if (success.stderr) {
        console.info("stderr:\n", success.stderr); // mongorestore binary write details on stderr
      }
    })
    .catch((err) => console.error("error", err));

  await mongorestorePromise;
}


function getDaoCreator(seed) {
  const { username: faucetDaoId } = config.DEIP_APPCHAIN_FAUCET_ACCOUNT;
  if (PROTOCOL_CHAIN.SUBSTRATE == config.DEIP_PROTOCOL_CHAIN) {
    return seed.getUsername();
  }
  return faucetDaoId;
}


function getDaoCreatorPrivKey(seed) {
  const { wif: faucetSeed } = config.DEIP_APPCHAIN_FAUCET_ACCOUNT;
  if (PROTOCOL_CHAIN.SUBSTRATE == config.DEIP_PROTOCOL_CHAIN) {
    return seed.getPrivKey();
  }
  return faucetSeed;
}


async function fundAddressFromFaucet(daoIdOrAddress, amount) {
  if (!amount) return;

  const chainService = await getChainService();
  const chainTxBuilder = chainService.getChainTxBuilder();
  const api = chainService.getChainNodeClient();
  const { username: faucetDaoId, wif: faucetSeed } = config.DEIP_APPCHAIN_FAUCET_ACCOUNT;

  const fundDaoTx = await chainTxBuilder.begin()
    .then((txBuilder) => {
      const transferAssetCmd = new TransferAssetCmd({
        from: faucetDaoId,
        to: daoIdOrAddress,
        asset: { ...config.DEIP_APPCHAIN_CORE_ASSET, amount }
      });

      txBuilder.addCmd(transferAssetCmd);
      return txBuilder.end();
    });

  const fundDaoTxSigned = await fundDaoTx.signAsync(faucetSeed, api);
  await sendTxAndWaitAsync(fundDaoTxSigned);
}


async function sendTxAndWaitAsync(finalizedTx, timeout = config.DEIP_APPCHAIN_MILLISECS_PER_BLOCK) {
  const chainService = await getChainService();
  const rpc = chainService.getChainRpc();
  const api = chainService.getChainNodeClient();
  if (config.DEIP_PORTAL_TENANT) {
    const { id: tenantDaoId, privKey: tenantPrivKey } = config.DEIP_PORTAL_TENANT;
    const { tx } = finalizedTx.getPayload();
    await tx.signByTenantAsync({ tenant: tenantDaoId, tenantPrivKey: tenantPrivKey }, api);
  }
  await finalizedTx.sendAsync(rpc);
  await waitAsync(timeout);
}


function daoIdToSubstrateAddress(daoId, api) {
  const address = SubstrateChainUtils.daoIdToAddress(toHexFormat(daoId), api.registry);
  return address;
}


function getFaucetSeedAccount() {
  const keyring = new Keyring({ type: 'sr25519' });
  const keyringPair = keyring.createFromJson(config.DEIP_APPCHAIN_FAUCET_SUBSTRATE_SEED_ACCOUNT_JSON);
  keyringPair.unlock();
  return keyringPair;
}


function toHexFormat(id) {
  const hexId = id.indexOf(`0x`) === 0 ? id : `0x${id}`;
  return hexId;
}


async function waitAsync(timeout = config.DEIP_APPCHAIN_MILLISECS_PER_BLOCK) {
  return new Promise(async (resolve, reject) => {
    try {
      setTimeout(() => resolve(), timeout);
    } catch (err) {
      reject(err);
    }
  });
}