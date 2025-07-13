const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    subtitle: {
        type: String,
        required: true
    },
    images: {
        type: [String],
        validate: [arr => arr.length > 0 && arr.length <= 5, 'You must provide between 1 and 5 images'],
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    link: {
        type: String,
        default: '#'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Banner', bannerSchema); 