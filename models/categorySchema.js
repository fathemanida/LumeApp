const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    image: {
        type: String,
        required: true
    },
    isListed: {
        type: Boolean,
        default: true
    },
    categoryOffer: {
        active: {
            type: Boolean,
            default: false
        },
       discountType: { type: String, enum: ['percentage', 'flat'] },

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
    createdOn: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Category', categorySchema); 