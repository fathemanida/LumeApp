const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Offer name is required'],
        trim: true
    },
    code: {
        type: String,
        required: [true, 'Offer code is required'],
        unique: true,
        trim: true,
        uppercase: true
    },
    discountType: {
        type: String,
        required: [true, 'Discount type is required'],
        enum: ['percentage', 'flat'],
        default: 'percentage'
    },
    discountValue: {
        type: Number,
        required: [true, 'Discount value is required'],
        min: [0, 'Discount value cannot be negative']
    },
    startDate: {
        type: Date,
        required: [true, 'Start date is required']
    },
    endDate: {
        type: Date,
        required: [true, 'End date is required'],
        validate: {
            validator: function(value) {
                return value > this.startDate;
            },
            message: 'End date must be after start date'
        }
    },
    applicableOn: {
        type: String,
        required: [true, 'Applicable on is required'],
        enum: ['all', 'categories', 'products'],
        default: 'all'
    },
    categories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    }],
    products: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

offerSchema.pre('save', function(next) {
    if (this.discountType === 'percentage' && this.discountValue > 100) {
        next(new Error('Percentage discount cannot be greater than 100%'));
    }
    next();
});

offerSchema.methods.isValid = function() {
    const now = new Date();
    return this.isActive && 
           now >= this.startDate && 
           now <= this.endDate;
};

offerSchema.methods.calculateDiscount = function(originalPrice) {
    if (!this.isValid()) return 0;
    
    if (this.discountType === 'percentage') {
        return (originalPrice * this.discountValue) / 100;
    } else {
        return Math.min(this.discountValue, originalPrice);
    }
};

const Offer = mongoose.model('Offer', offerSchema);

module.exports = Offer; 