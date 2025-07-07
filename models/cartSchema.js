const mongoose = require('mongoose');
const { Schema } = mongoose;

const cartSchema = new mongoose.Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    items: [{
        productId: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        size: {
            type: String,
            default: 'default'
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        price: {
            type: Number,
            required: true
        },
        totalPrice: {
            type: Number,
            required: true
        },
        status: {
            type: String,
            default: "Placed"
        }
    }],
    appliedCoupon: {
        type: Schema.Types.ObjectId,
        ref: 'Coupon'
    },
    discount: { type: Number },

    appliedCouponDetails: { type: Object },

    discount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

const Cart = mongoose.model("Cart", cartSchema);
module.exports = Cart;