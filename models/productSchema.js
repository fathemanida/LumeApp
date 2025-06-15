const mongoose = require("mongoose");
const { Schema } = mongoose;

const productSchema = new Schema(
  {
    productName: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true
    },
    regularPrice: {
      type: Number,
      required: true,
      min: 0
    },
    salePrice: {
      type: Number,
      required: true,
      min: 0
    },
    sizes: [{ 
      size: {
        type: String,
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        min: 0
      }
    }],
    productCode: {
      type: String,
      required: true,
      unique: true
    },
    productStock: {
      type: Number,
      default: 0,
    },
    productOffer: {
      active: {
        type: Boolean,
        default: false
      },
      discountType: {
        type: String,
        enum: ['percentage', 'flat'],
        default: 'percentage'
      },
      discountValue: {
        type: Number,
        min: 0
      },
      startDate: {
        type: Date
      },
      endDate: {
        type: Date
      }
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    productImage: [{
      type: String,
      required: true
    }],
    isListed: {
      type: Boolean,
      default: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["Available", "Out of Stock", "Discountinued"],
      default: "Available",
      required: true,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    new: {
      type: Boolean,
      default: false,
    },
    createdOn: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const Product = mongoose.model("Product", productSchema);

module.exports = Product;