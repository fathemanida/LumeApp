const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  description: {
    type: String,
    required: true
  },
  discountType: {
    type: String,
    enum: ["PERCENTAGE", "FLAT"],
    required: true
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0
  },
  maxDiscount: {
    type: Number,
    validate: {
      validator: function(value) {
        return this.discountType !== 'PERCENTAGE' || (value && value > 0);
      },
      message: 'Maximum discount is required for percentage discount'
    }
  },
  minOrderAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  expiryDate: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

module.exports = mongoose.model("Coupon", couponSchema);
