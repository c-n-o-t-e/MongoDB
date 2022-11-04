const mongoose = require("mongoose");

const transferSchema = new mongoose.Schema({
  market: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  totalMintedInMarket: {
    type: Number,
    required: true,
  },
  totalBurntInMarket: {
    type: Number,
    required: true,
  },
});

// connect transferSchema with the "positions" collection
module.exports = mongoose.model("Transfer", transferSchema);
