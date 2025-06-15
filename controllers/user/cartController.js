const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Cart = require('../../models/cartSchema');
const Product = require('../../models/productSchema');
const Coupon = require("../../models/couponSchema");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const router = require("../../routes/userRoutes");
const { error } = require("console");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/uploads/user");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed!"));
  },
}).single("profileImage");

const addToCart = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Please login to add items to cart'
      });
    }
    const user=req.session.user

    const { productId, quantity = 1, size } = req.body;
    const userId = user.id

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const price = product.salePrice < product.regularPrice ? product.salePrice : product.regularPrice;
    const totalPrice = price * quantity;

    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = new Cart({
        userId,
        items: []
      });
    }

    const existingItem = cart.items.find(item => 
      item.productId.toString() === productId && item.size === (size || 'default')
    );

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.price = price;
      existingItem.totalPrice = existingItem.quantity * price;
    } else {
      cart.items.push({
        productId,
        quantity,
        price,
        totalPrice,
        size: size || 'default'
      });
    }

    await cart.save();
    res.json({
      success: true,
      message: 'Product added to cart successfully'
    });
  } catch (error) {
    console.error('Error in addToCart:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding to cart'
    });
  }
};

const cart = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user.id;

    const cart = await Cart.findOne({ userId })
      .populate('items.productId')
      .populate('appliedCoupon');
      

    const coupons = await Coupon.find({
      isActive: true,
      expiryDate: { $gt: new Date() }
    }).select('code discountType discountValue maxDiscount minOrderAmount expiryDate');

    if (!cart || cart.items.length === 0) {
      return res.render('user/cart', {
        user: req.session.user,
        items: [],
        totalPrice: 0,
        discount: 0,
        shipping: 0,
        finalPrice: 0,
        coupons: coupons,
        appliedCoupon: null
      });
    }

    const totalPrice = cart.items.reduce((total, item) => {
      const price = item.productId.salePrice < item.productId.regularPrice ? 
        item.productId.salePrice : item.productId.regularPrice;
      return total + (price * item.quantity);
    }, 0);

    const shipping = totalPrice > 1500 ? 0 : 40;
    const discount = cart.discount || 0;
    const finalPrice = totalPrice + shipping - discount;

    res.render('cart', {
      user: req.session.user,
      items: cart.items,
      totalPrice,
      discount,
      shipping,
      finalPrice,
      coupons,
      appliedCoupon: cart.appliedCoupon
    });
  } catch (error) {
    console.error('Error in cart:', error);
    res.status(500).send('Error loading cart');
  }
};


const updateQuantity = async (req, res) => {
  try {
    console.log('fdsfsgdsgdsgds');
    const { itemId, action } = req.body;
    const userId = req.session.user.id;

    if (!itemId || !action) {
      return res.status(400).json({ 
        success: false, 
        message: 'Item ID and action are required' 
      });
    }

    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        select: 'productName regularPrice salePrice stock'
      });

    if (!cart) {
      return res.status(404).json({ 
        success: false, 
        message: 'Cart not found' 
      });
    }

    const cartItem = cart.items.find(item => item._id.toString() === itemId);
    if (!cartItem) {
      return res.status(404).json({ 
        success: false, 
        message: 'Item not found in cart' 
      });
    }

    if (!cartItem.productId) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    const product = cartItem.productId;
    const MAX_LIMIT = 6;

    const currentQuantity = cartItem.quantity;
    const maxAllowed = Math.min(product.quantity,MAX_LIMIT );
    let newQuantity = currentQuantity;
if (product.quantity === 0) {
  return res.status(400).json({ 
    success: false, 
    message: 'Product out of stock' 
  });
}

    if (action === 'increase') {
        if (currentQuantity >=product.quantity) {
        return res.status(400).json({ 
          success: false, 
          message: 
                        `Only ${product.quantity} items available in stock` 

        });
      }
      if (currentQuantity >MAX_LIMIT) {
        return res.status(400).json({ 
          success: false, 
          message: 
            'Maximum quantity limit of 6 items reached'
        });
      }
    


      newQuantity = currentQuantity + 1;
    } else if (action === 'decrease') {
      if (currentQuantity <= 1) {
        return res.status(400).json({ 
          success: false, 
          message: 'Minimum quantity is 1' 
        });
      }
      newQuantity = currentQuantity - 1;
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid action' 
      });
    }

    cartItem.quantity = newQuantity;
    cartItem.totalPrice = newQuantity * (product.salePrice < product.regularPrice ? 
      product.salePrice : product.regularPrice);

    await cart.save();

    const totalPrice = cart.items.reduce((total, item) => {
      const price = item.productId.salePrice < item.productId.regularPrice ? 
        item.productId.salePrice : item.productId.regularPrice;
      return total + (price * item.quantity);
    }, 0);

    const shipping = totalPrice > 1500 ? 0 : 40;
    const discount = cart.discount || 0;
    const finalPrice = totalPrice + shipping - discount;

    res.json({
      success: true,
      quantity: newQuantity,
      totalPrice: cartItem.totalPrice,
      stock: product.stock,
      maxQuantity: maxAllowed,
      cartTotal: totalPrice,
      discount: discount,
      shipping: shipping,
      finalPrice: finalPrice
    });
  } catch (error) {
    console.error('Error in updateQuantity:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating quantity' 
    });
  }
};

const removeItem = async (req, res) => {
  try {
    console.log('hjfhfidho');
    const { itemId } = req.body;
    const userId = req.session.user.id;

    if (!itemId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Item ID is required' 
      });
    }

    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        select: 'productName regularPrice salePrice stock'
      });

    if (!cart) {
      return res.status(404).json({ 
        success: false, 
        message: 'Cart not found' 
      });
    }

    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        message: 'Item not found in cart' 
      });
    }

    cart.items.splice(itemIndex, 1);
    await cart.save();

    const totalPrice = cart.items.reduce((total, item) => {
      if (!item.productId) {
        return total;
      }
      const price = item.productId.salePrice <= item.productId.regularPrice ? 
        item.productId.salePrice : item.productId.regularPrice;
      return total + (price * item.quantity);
    }, 0);

    const shipping = totalPrice > 1500 ? 0 : 40;
    const discount = cart.discount || 0;
    const finalPrice = totalPrice + shipping - discount;

    res.json({
      success: true,
      message: 'Item removed successfully',
      totals: {
        subtotal: totalPrice,
        shipping: shipping,
        discount: discount,
        finalPrice: finalPrice
      }
    });
  } catch (error) {
    console.error('Error removing item:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error removing item from cart',
      error: error.message 
    });
  }
};

const getCheckout = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const cart = await Cart.findOne({ userId })
      .populate('items.productId')
      .populate('appliedCoupon');

    if (!cart || cart.items.length === 0) {
      return res.redirect('/cart');
    }

    let totalPrice = 0;
    cart.items.forEach(item => {
      totalPrice += item.totalPrice;
    });

    const shipping = totalPrice >= 1500 ? 0 : 40;

    let discount = 0;
    let finalPrice = totalPrice + shipping;

    if (cart.appliedCoupon) {
      if (cart.appliedCoupon.discountType === 'percentage') {
        discount = (totalPrice * cart.appliedCoupon.discountValue) / 100;
        if (cart.appliedCoupon.maxDiscount) {
          discount = Math.min(discount, cart.appliedCoupon.maxDiscount);
        }
      } else {
        discount = cart.appliedCoupon.discountValue;
      }
      finalPrice = totalPrice - discount + shipping;
    }

    res.render('checkout', {
      user: req.session.user,
      cart,
      totalPrice,
      shipping,
      discount,
      finalPrice,
      appliedCoupon: cart.appliedCoupon
    });
  } catch (error) {
    console.error('Error in getCheckout:', error);
    res.status(500).render('error', { 
      message: 'An error occurred while processing your checkout',
      error: error
    });
  }
};
const applyCoupon = async (req, res) => {
  try {
    console.log('efef coipom');
    const { code } = req.body;
    const userId = req.session.user.id;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Coupon code is required' });
    }

    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        select: 'productName regularPrice salePrice'
      });

    if (!cart) {
      return res.status(404).json({ success: false, message: 'Cart not found' });
    }

    if (cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const totalPrice = cart.items.reduce((total, item) => {
      if (!item.productId) {
        console.error('Product not found for item:', item);
        return total;
      }
      const price = item.productId.salePrice <= item.productId.regularPrice ? 
        item.productId.salePrice : item.productId.regularPrice;
      return total + (price * item.quantity);
    }, 0);

    console.log('Total price calculated:', totalPrice);

    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
      expiryDate: { $gt: new Date() }
    });

    if (!coupon) {
      return res.status(400).json({ success: false, message: 'Invalid or expired coupon code' });
    }

    console.log('Coupon found:', coupon);

    if (coupon.minOrderAmount && totalPrice < coupon.minOrderAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon` 
      });
    }

    let discount = 0;
    if (coupon.discountType === 'percentage') {
      discount = (totalPrice * coupon.discountValue) / 100;
      if (coupon.maxDiscount) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      discount = coupon.discountValue;
    }

    console.log('Discount calculated:', discount);

    cart.appliedCoupon = coupon._id;
    cart.discount = discount;
    
    try {
      await cart.save();
      console.log('Cart updated successfully');
    } catch (saveError) {
      console.error('Error saving cart:', saveError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error saving cart with coupon' 
      });
    }

    const shipping = totalPrice > 1500 ? 0 : 40;
    const finalPrice = totalPrice + shipping - discount;

    res.json({ 
      success: true, 
      message: 'Coupon applied successfully',
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        maxDiscount: coupon.maxDiscount
      },
      totals: {
        subtotal: totalPrice,
        discount: discount,
        shipping: shipping,
        finalPrice: finalPrice
      }
    });
  } catch (error) {
    console.error('Error applying coupon:', error);
    res.status(500).json({ 
      success: false, 
      message: 'An error occurred while applying the coupon',
      error: error.message 
    });
  }
};

const removeCoupon = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        select: 'productName regularPrice salePrice stock'
      });

    if (!cart) {
      return res.status(404).json({ 
        success: false, 
        message: 'Cart not found' 
      });
    }

    const totalPrice = cart.items.reduce((total, item) => {
      if (!item.productId) {
        return total;
      }
      const price = item.productId.salePrice <= item.productId.regularPrice ? 
        item.productId.salePrice : item.productId.regularPrice;
      return total + (price * item.quantity);
    }, 0);

    cart.appliedCoupon = null;
    cart.discount = 0;
    await cart.save();

    const shipping = totalPrice > 1500 ? 0 : 40;
    const finalPrice = totalPrice + shipping;

    res.json({
      success: true,
      message: 'Coupon removed successfully',
      totals: {
        subtotal: totalPrice,
        shipping: shipping,
        discount: 0,
        finalPrice: finalPrice
      }
    });
  } catch (error) {
    console.error('Error removing coupon:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error removing coupon',
      error: error.message 
    });
  }
};

module.exports = {
  addToCart,
  cart,
  updateQuantity,
  removeItem,
  getCheckout,
  applyCoupon,
  removeCoupon
};
