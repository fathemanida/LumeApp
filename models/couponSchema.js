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
  },
  usedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    validate: {
      validator: function(v) {
        // Ensure no duplicate user IDs in usedBy array
        return this.usedBy.filter(id => id.toString() === v.toString()).length <= 1;
      },
      message: 'User has already used this coupon'
    }
  }]
});

// Add compound index to prevent duplicate coupon usage
couponSchema.index({ code: 1, 'usedBy': 1 });

module.exports = mongoose.model("Coupon", couponSchema);
