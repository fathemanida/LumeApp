const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Cart=require("../../models/cartSchema")
const Product=require("../../models/productSchema")
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const router = require("../../routes/userRoutes");

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
        message: 'Please login to add items to cart',
        requiresLogin: true
      });
    }

    const { productId, quantity = 1, size } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (!product.isListed || product.quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Product is not available'
      });
    }

    if (quantity > product.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.quantity} items available`
      });
    }

    const price = product.salePrice < product.regularPrice 
      ? product.salePrice 
      : product.regularPrice;

    let cart = await Cart.findOne({ userId: req.session.user._id });
    if (!cart) {
      cart = new Cart({
        userId: req.session.user._id,
        items: []
      });
    }

    const existingItemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId && item.size === (size || 'default')
    );

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity += quantity;
      cart.items[existingItemIndex].totalPrice = cart.items[existingItemIndex].quantity * price;
    } else {
      cart.items.push({
        productId,
        quantity,
        price,
        totalPrice: price * quantity,
        size: size || 'default',
        status: 'Placed'
      });
    }

    cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    await cart.save();

    return res.status(200).json({
      success: true,
      message: 'Item added to cart successfully',
      cartCount: cart.totalItems
    });

  } catch (error) {
    console.error('Error in addToCart:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add item to cart'
    });
  }
};

const cart = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/signup');
    }

    const userId = req.session.user._id;
    let cart = await Cart.findOne({ userId }).populate({
      path: 'items.productId',
      select: 'productName productImage regularPrice salePrice'
    });

    if (!cart || cart.items.length === 0) {
      return res.render('user/cart', {
        items: [],
        totalPrice: 0,
        discount: 0,
        finalPrice: 0,
        cartCount: 0,
        user: req.session.user
      });
    }

    let totalPrice = 0;
    let discount = 0;
    const items = cart.items.map((item) => {
      const regularPrice = item.productId.regularPrice;
      const salePrice = item.productId.salePrice;
      const price = salePrice < regularPrice ? salePrice : regularPrice;
      const subtotal = price * item.quantity;
      const itemDiscount = (regularPrice - price) * item.quantity;
      
      totalPrice += subtotal;
      discount += itemDiscount;
      
      return {
        ...item.toObject(),
        subtotal,
        price,
        regularPrice,
        salePrice
      };
    });

    const finalPrice = totalPrice - discount;

    res.render('user/cart', {
      items,
      totalPrice,
      discount,
      finalPrice,
      cartCount: items.length,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error in cart:', error);
    res.render('user/page404');
  }
};

const updateQuantity = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Please login to update cart',
        requiresLogin: true
      });
    }

    const { itemId } = req.params;
    const { action } = req.body;

    if (!itemId || !action) {
      return res.status(400).json({
        success: false,
        message: 'Item ID and action are required'
      });
    }

    const cart = await Cart.findOne({ userId: req.session.user._id })
      .populate({
        path: 'items.productId',
        select: 'regularPrice salePrice quantity'
      });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    const item = cart.items.find(item => item._id.toString() === itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    let newQuantity = item.quantity;
    if (action === 'increase') {
      newQuantity += 1;
    } else if (action === 'decrease') {
      newQuantity = Math.max(1, newQuantity - 1);
    }

    if (newQuantity > item.productId.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${item.productId.quantity} items available`
      });
    }

    const price = item.productId.salePrice < item.productId.regularPrice 
      ? item.productId.salePrice 
      : item.productId.regularPrice;

    item.quantity = newQuantity;
    item.price = price;
    item.totalPrice = price * newQuantity;

    cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    await cart.save();

    const totalPrice = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);
    const discount = cart.items.reduce((sum, item) => {
      const regularTotal = item.productId.regularPrice * item.quantity;
      const saleTotal = item.productId.salePrice * item.quantity;
      return sum + (regularTotal - saleTotal);
    }, 0);

    return res.status(200).json({
      success: true,
      message: 'Cart updated successfully',
      cartCount: cart.totalItems,
      quantity: newQuantity,
      price: price.toFixed(2),
      itemTotal: item.totalPrice.toFixed(2),
      totalPrice: totalPrice.toFixed(2),
      discount: discount.toFixed(2),
      finalPrice: (totalPrice - discount).toFixed(2)
    });

  } catch (error) {
    console.error('Error in updateQuantity:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update cart'
    });
  }
};

const removeItem = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Please login to remove items',
        requiresLogin: true
      });
    }

    const { itemId } = req.params;
    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: 'Item ID is required'
      });
    }

    const cart = await Cart.findOne({ userId: req.session.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items = cart.items.filter(item => item._id.toString() !== itemId);
    
    cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    await cart.save();

    return res.status(200).json({
      success: true,
      message: 'Item removed successfully',
      cartCount: cart.totalItems
    });

  } catch (error) {
    console.error('Error in removeItem:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove item'
    });
  }
};

module.exports = { 
  addToCart,
  cart,
  updateQuantity,
  removeItem
};
