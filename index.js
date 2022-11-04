require("dotenv").config();

const ethers = require("ethers");
const express = require("express");
const mongoose = require("mongoose");
const config = require("./config.json");
const { createServer } = require("http");

const app = express();
const server = createServer(app);
const { MultiCall } = require("@indexed-finance/multicall");

const abi = require("./Abi/abi1.json");
const abi2 = require("./Abi/abi2.json");
const abi3 = require("./Abi/abi3.json");
const builds = require("./build.schema");
const position = require("./position.schema");
const uPnL = require("./uPnL.schema");
const transfer = require("./transfer.schema");
const mongoDBUrl = `${process.env.MONGO_DB_URL}`;

const network = {
  name: "goerli",
  chainId: 5,
  _defaultProvider: (providers) =>
    new providers.JsonRpcProvider(
      "https://goerli.infura.io/v3/429eb57532b54560b1d4cc4201724bf0"
    ),
};

const provider = ethers.getDefaultProvider(network);

const marketContract = new ethers.Contract(
  config.MARKETS["WETH/BETA"],
  abi,
  provider
);

const stateContract = new ethers.Contract(
  config.CORE_CONTRACTS.overlayV1StateContractAddress,
  abi2,
  provider
);
const tokenContract = new ethers.Contract(
  config.CORE_CONTRACTS.overlayV1TokenContractAddress,
  abi3,
  provider
);

/**
 * Gets triggered when /positions with name of market pair is typed
 * on the supporting discord channel.
 * Returns the amount of OVL as collateral in different positions.
 */
async function getPositionsInMarkets(eventLog, costData, market, i) {
  let count = [0, 0, 0, 0, 0];

  for (let y = 0; y < eventLog.length; y++) {
    const collateral = Number(costData[1][y]) / 1e18;
    if (collateral > 0 && collateral <= 10) {
      count[0] += 1;
    } else if (collateral > 10 && collateral <= 20) {
      count[1] += 1;
    } else if (collateral > 20 && collateral <= 100) {
      count[2] += 1;
    } else if (collateral > 100 && collateral <= 500) {
      count[3] += 1;
    } else if (collateral > 500 && collateral <= 1000) {
      count[4] += 1;
    }
  }

  position.create({
    market: market[i],
    date: new Date(),
    collateralInOVLBetween0and10: count[0],
    collateralInOVLBetween11and20: count[1],
    collateralInOVLBetween21and100: count[2],
    collateralInOVLBetween101and500: count[3],
    collateralInOVLBetween501and1000: count[4],
  });
}

/**
 * Gets triggered when /uPnL with name of market pair is typed
 * on the supporting discord channel.
 * Returns the unrealized profit and loss of positions in a market.
 */
async function getuPnLinMarket(market, eventLog, costData, i, multi) {
  let totalProfit = 0;
  let totalLoss = 0;

  const inputs0 = [];

  for (let z = 0; z < eventLog.length; z++) {
    inputs0.push({
      target: stateContract.address,
      function: "value",
      args: [
        `${config.MARKETS[market[i]]}`,
        `${eventLog[z].args[0]}`,
        `${eventLog[z].args[1]}`,
      ],
    });
  }

  const valueData = await multi.multiCall(abi2, inputs0);

  for (let w = 0; w < eventLog.length; w++) {
    if (Number(valueData[1][w]) > Number(costData[1][w])) {
      const profit = valueData[1][w] - costData[1][w];
      totalProfit += profit;
    } else {
      const loss = costData[1][w] - valueData[1][w];
      totalLoss += loss;
    }
  }

  uPnL.create({
    market: market[i],
    date: new Date(),
    totalProfit: totalProfit / 1e18,
    totalLoss: totalLoss / 1e18,
  });
}

/**
 * Gets triggered when /transfers with name of market pair is typed
 * on the supporting discord channel.
 * Returns the total minted and burnt OVL in a market.
 */
async function getTransfersInMarkets(market, i) {
  const filter1 = tokenContract.filters.Transfer(
    ethers.constants.AddressZero,
    config.MARKETS[market[i]]
  );
  const mintedEventLog = await tokenContract.queryFilter(filter1, 0);

  const filter2 = tokenContract.filters.Transfer(
    config.MARKETS[market[i]],
    ethers.constants.AddressZero
  );
  const burntEventLog = await tokenContract.queryFilter(filter2, 0);

  let totalBurntInMarket = 0;
  let totalMintedInMarket = 0;

  for (let i = 0; i < burntEventLog.length; i++) {
    totalBurntInMarket += Number(burntEventLog[i].args[2]);
  }

  for (let i = 0; i < mintedEventLog.length; i++) {
    totalMintedInMarket += Number(mintedEventLog[i].args[2]);
  }

  transfer.create({
    market: market[i],
    date: new Date(),
    totalMintedInMarket: totalMintedInMarket / 1e18,
    totalBurntInMarket: totalBurntInMarket / 1e18,
  });
}

/**
 * Listens to the build function event,
 * sends a message of %CapOI bought in new position
 * to a supporting discord channel
 */
marketContract.on("Build", async (sender, positionId, userOI) => {
  console.log("starting");

  const marketCapOi = await stateContract.capOi(marketContract.address);
  const collateral = await stateContract.cost(
    marketContract.address,
    sender,
    positionId
  );

  const capOI = marketCapOi.toString();
  const percentage = userOI * 100;
  const percentageOfCapOiBought = percentage / capOI;

  builds.create({
    capOI: capOI / 1e18,
    userOI: userOI / 1e18,
    sender: sender,
    collateralInOVL: collateral / 1e18,
    percentageOfCapOiBought: percentageOfCapOiBought,
  });
});

let blockNumberThreshold = 0;

provider.on("block", async () => {
  if (blockNumberThreshold < provider.blockNumber) {
    console.log("working");
    console.log(blockNumberThreshold);
    console.log(provider.blockNumber);
    let market = ["WETH/USDC", "WETH/THETA"];

    for (let i = 0; i < market.length; i++) {
      const marketContract = new ethers.Contract(
        config.MARKETS[market[i]],
        abi,
        provider
      );

      const filter = marketContract.filters.Build();
      const eventLog = await marketContract.queryFilter(
        filter,
        blockNumberThreshold
      );

      const multi = new MultiCall(provider);
      const inputs = [];

      for (let e = 0; e < eventLog.length; e++) {
        inputs.push({
          target: stateContract.address,
          function: "cost",
          args: [
            `${config.MARKETS[market[i]]}`,
            `${eventLog[e].args[0]}`,
            `${eventLog[e].args[1]}`,
          ],
        });
      }

      const costData = await multi.multiCall(abi2, inputs);

      await getuPnLinMarket(market, eventLog, costData, i, multi);
      await getPositionsInMarkets(eventLog, costData, market, i);
      await getTransfersInMarkets(market, i);

      console.log("transfer");
    }

    blockNumberThreshold = provider.blockNumber + 5;
  }
});

mongoose.connection.once("open", () => {
  console.log("connection ready");
});

mongoose.connection.on("error", (err) => {
  console.error(err);
});

server.listen(8080, async function () {
  await mongoose.connect(mongoDBUrl);
  console.log("Listening on http://0.0.0.0:8080");
});
