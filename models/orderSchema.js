const mongoose = require('mongoose');
const { Schema } = mongoose;
const { v4: uuidv4 } = require("uuid");

const orderSchema = new mongoose.Schema({
    orderId: {
        type: String,
        default: () => uuidv4(),
        unique: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    razorpayOrderId: {
        type: String
    },
    items: [{
        productId: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        originalPrice: {
            type: Number,
            required: true
        },
        price: {
            type: Number,
            required: true
        },
        appliedOffer: {
            type: {
                offerId: {
                    type: Schema.Types.ObjectId,
                    ref: 'Offer'
                },
                offerType: {
                    type: String,
                    enum: ['product', 'category']
                },
                offerName: String,
                discountType: {
                    type: String,
                    enum: ['percentage', 'fixed']
                },
                discountValue: Number,
                discountAmount: Number 
            },
            default: null
        },
        couponPerUnit: {
            type: Number,
            default: 0
        },
        totalCouponDiscount: {
            type: Number,
            default: 0 
        },
        finalPrice: {
            type: Number,
            required: true 
        },
        status: {
            type: String,
            enum: ['Active', 'Cancelled', 'Delivered', 'Shipped', 'Returned', 'Return Requested'],
            default: 'Active'
        }
    }],
    totalAmount: {
        type: Number,
        required: true
    },
    address: {
        type: Schema.Types.ObjectId,
        ref: 'address',
        required: true
    },
    paymentMethod: {
        type: String,
        required: true,
        enum: ['COD', 'ONLINE', 'Razorpay', 'Wallet']
    },
    status: {
        type: String,
        required: true,
        enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Return Requested', 'Return Rejected', 'Failed'],
        default: 'Pending'
    },
    usedCoupon: {
        type: Schema.Types.ObjectId,
        ref: 'Coupon'
    },
    couponDiscount: {
        type: Number,
        default: 0
    },
   
    couponDistribution: {
        totalQuantities: {
            type: Number,
            default: 0
        },
        couponPerUnit: {
            type: Number,
            default: 0 
        }
    },
    offerDiscount: {
        type: Number,
        default: 0
    },
    subtotal: {
        type: Number,
        required: true
    },
    shipping: {
        type: Number,
        required: true,
        default: 0
    },
    returnRequest: {
        type: {
            requestedAt: Date,
            reason: String,
            description: String,
            items: [{
                productId: {
                    type: Schema.Types.ObjectId,
                    ref: "Products"
                },
                quantity: Number
            }],
            status: {
                type: String,
                enum: ['Pending', 'Accepted', 'Rejected'],
                default: 'Pending'
            },
            adminResponse: String,
            respondedAt: Date
        },
        required: false,
        default: null
    },
    createdOn: {
        type: Date,
        default: Date.now,
        required: true
    },
    couponApplied: {
        type: Boolean,
        default: false
    },
    estimatedDelivery: {
        type: Date
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    coupon: {
        code: { type: String },
        discount: { type: Number },
        type: { type: String }
    },
   
  address: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address'
  },
});

const Order = mongoose.model("Order", orderSchema);
module.exports = Order;