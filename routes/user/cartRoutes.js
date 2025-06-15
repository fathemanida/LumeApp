const express = require('express');
const router = express.Router();
const cartController = require('../../controllers/user/cartController');
const { isLogin } = require('../../middleware/auth');

// Cart routes
router.get('/', isLogin, cartController.cart);
router.post('/add-to-cart', isLogin, cartController.addToCart);
router.post('/update-quantity', isLogin, cartController.updateQuantity);
router.post('/remove-item', isLogin, cartController.removeItem);
router.post('/apply-coupon', isLogin, cartController.applyCoupon);


module.exports = router; 