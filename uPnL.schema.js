const mongoose = require("mongoose");

const uPnLSchema = new mongoose.Schema({
  market: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  totalProfit: {
    type: Number,
    required: true,
  },
  totalLoss: {
    type: Number,
    required: true,
  },
});

// connect uPnLSchema with the "positions" collection
module.exports = mongoose.model("uPnL", uPnLSchema);
