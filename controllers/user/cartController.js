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
const mongoose = require('mongoose');
const Order = require("../../models/orderSchema");
const Offer = require("../../models/offerSchema"); 
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
    const userId = req.session.user.id;
    const { productId, selectedSize, quantity } = req.body; 

    const product = await Product.findById(productId)
      .populate({
        path: 'category',
        populate: { path: 'categoryOffer' }
      });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const productStock = product.quantity || product.productStock || 0;
    const maxAllowed = Math.min(productStock, 6);
    
    if (productStock === 0) {
      return res.status(400).json({ success: false, message: 'Product is out of stock' });
    }
    
    if (quantity > maxAllowed) {
      if (productStock <= 6) {
        return res.status(400).json({ 
          success: false, 
          message: `Only ${productStock} items available in stock` 
        });
      } else {
        return res.status(400).json({ 
          success: false, 
          message: 'Maximum 6 items allowed per product' 
        });
      }
    }

    const basePrice = product.salePrice && product.salePrice < product.regularPrice ? 
      product.salePrice : product.regularPrice;

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ['all', 'categories', 'products'] }
    });

    const { maxDiscount } = getBestOffer(product, offers, quantity);
    let effectivePrice = basePrice - (maxDiscount / quantity);
    if (effectivePrice < 0) effectivePrice = 0;
    const totalPrice = effectivePrice * quantity;

    const cart = await Cart.findOne({ userId });

    if (cart) {
    const existingItem = cart.items.find(item => 
        item.productId.equals(productId) && item.size === selectedSize
    );

    if (existingItem) {
        const newTotalQuantity = existingItem.quantity + Number(quantity);
        if (newTotalQuantity > maxAllowed) {
          if (productStock <= 6) {
            return res.status(400).json({ 
              success: false, 
              message: `Cannot add more items. Only ${productStock} items available in stock` 
            });
          } else {
            return res.status(400).json({ 
              success: false, 
              message: `Cannot add more items. Maximum 6 items allowed per product` 
            });
          }
        }
        existingItem.quantity = newTotalQuantity;
        existingItem.price = effectivePrice;
        existingItem.totalPrice = existingItem.quantity * effectivePrice;
    } else {
      cart.items.push({
        productId,
          size: selectedSize,
        quantity,
          price: effectivePrice,
          totalPrice
      });
    }

    await cart.save();
    } else {
      const newCart = new Cart({
        userId,
        items: [{
          productId,
          size: selectedSize,
          quantity,
          price: effectivePrice,
          totalPrice
        }]
      });

      await newCart.save();
    }

    return res.status(200).json({ success: true, message: 'Product added to cart' });

  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ success: false, message: 'Error adding to cart' });
  }
};


const cart = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user.id;
    
    console.log('\n=== Cart Route Debug ===');
    console.log('User ID:', userId);
    
    // Fetch cart with detailed population
    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { 
            path: 'category', 
            populate: { 
              path: 'categoryOffer',
              match: { 
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
              }
            }
          }
        ]
      })
      .populate('appliedCoupon');

    console.log('\n=== Cart Items ===');
    if (cart && cart.items && cart.items.length > 0) {
      console.log(`Found ${cart.items.length} items in cart`);
      cart.items.forEach((item, index) => {
        console.log(`\n[Item ${index + 1}] ${item.productId?.productName || 'Unknown Product'}`);
        console.log('- Product ID:', item.productId?._id || 'None');
        console.log('- Category:', item.productId?.category?.name || 'None', 
                   `(ID: ${item.productId?.category?._id || 'None'})`);
        console.log('- Category Offer:', item.productId?.category?.categoryOffer?.name || 'None');
        console.log('- Quantity:', item.quantity);
        console.log('- Price:', item.price);
        console.log('- Original Price:', item.originalPrice || 'Not set');
        console.log('- Offer Discount:', item.offerDiscount || 0);
      });
    } else {
      console.log('Cart is empty or not found');
    }

    // Fetch all active coupons
    const coupons = await Coupon.find({
      isActive: true,
      expiryDate: { $gt: new Date() }
    }).select('code discountType discountValue maxDiscount minOrderAmount expiryDate usedBy');

    console.log('\n=== Available Coupons ===');
    console.log(`Found ${coupons.length} active coupons`);
    coupons.forEach((coupon, index) => {
      console.log(`[${index + 1}] ${coupon.code}: ${coupon.discountValue}${coupon.discountType === 'PERCENTAGE' ? '%' : ' flat'}`);
    });

    // Fetch all active offers
    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ['all', 'categories', 'products'] }
    }).populate('categories', 'name')
      .populate('products', 'productName');

    console.log('\n=== Available Offers ===');
    console.log(`Found ${offers.length} active offers`);
    offers.forEach((offer, index) => {
      console.log(`\n[Offer ${index + 1}] ${offer.name || 'Unnamed Offer'}`);
      console.log('- Type:', offer.applicableOn);
      console.log(`- Discount: ${offer.discountValue}${offer.discountType === 'percentage' ? '%' : ' flat'}`);
      if (offer.maxDiscount) console.log('- Max Discount:', offer.maxDiscount);
      if (offer.applicableOn === 'categories') {
        console.log('- Categories:', offer.categories?.map(c => c.name).join(', ') || 'None');
      } else if (offer.applicableOn === 'products') {
        console.log('- Products:', offer.products?.map(p => p.productName).join(', ') || 'None');
      }
    });

    if (!cart || cart.items.length === 0) {
      console.log('\n=== Rendering Empty Cart ===');
      return res.render('cart', {
        user: req.session.user,
        items: [],
        totalPrice: 0,
        totalOfferDiscount: 0,
        totalCouponDiscount: 0,
        shipping: 0,
        finalPrice: 0,
        coupons,
        appliedCoupon: null,
        discount: 0
      });
    }

    // Calculate prices and apply offers
    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalCouponDiscount = 0;

    console.log('\n=== Calculating Prices and Applying Offers ===');
    
    // First pass: Calculate base prices and original totals
    cart.items.forEach(item => {
      const product = item.productId;
      if (!product) {
        console.warn('Skipping item with missing product data');
        return;
      }
      
      const basePrice = product.salePrice && product.salePrice < product.regularPrice ? 
        product.salePrice : product.regularPrice;
      const originalPrice = basePrice * item.quantity;
      
      console.log(`\n[${product.productName}]`);
      console.log('- Base Price:', basePrice);
      console.log('- Quantity:', item.quantity);
      console.log('- Original Price:', originalPrice);
      
      item.price = basePrice;
      item.originalPrice = originalPrice;
      totalPrice += originalPrice;
    });

    // Second pass: Apply best offers
    cart.items.forEach(item => {
      const product = item.productId;
      if (!product) return;
      
      console.log(`\n=== Applying Offers to ${product.productName} ===`);
      
      const { maxDiscount, bestOffer, offerType } = getBestOffer(product, offers, item.quantity);
      
      item.offerDiscount = maxDiscount;
      item.appliedOffer = bestOffer;
      item.offerType = offerType;
      totalOfferDiscount += maxDiscount;
      
      console.log(`- Applied Offer: ${bestOffer?.name || 'None'}`);
      console.log(`- Offer Type: ${offerType || 'None'}`);
      console.log(`- Offer Discount: ${maxDiscount}`);
    });

    // Apply coupon discount if any
    if (cart.appliedCoupon) {
      console.log('\n=== Applying Coupon ===');
      console.log('- Coupon Code:', cart.appliedCoupon.code);
      console.log('- Discount Type:', cart.appliedCoupon.discountType);
      console.log('- Discount Value:', cart.appliedCoupon.discountValue);
      
      const priceAfterOffer = totalPrice - totalOfferDiscount;
      
      if (cart.appliedCoupon.discountType === 'PERCENTAGE') {
        totalCouponDiscount = (priceAfterOffer * cart.appliedCoupon.discountValue) / 100;
        if (cart.appliedCoupon.maxDiscount) {
          totalCouponDiscount = Math.min(totalCouponDiscount, cart.appliedCoupon.maxDiscount);
          console.log('- Capped at max discount:', cart.appliedCoupon.maxDiscount);
        }
        console.log(`- Applied ${cart.appliedCoupon.discountValue}% discount: ${totalCouponDiscount}`);
      } else {
        totalCouponDiscount = cart.appliedCoupon.discountValue;
        console.log(`- Applied flat discount: ${totalCouponDiscount}`);
      }
    }

    // Calculate shipping
    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalPrice = Math.max(0, totalPrice - totalOfferDiscount - totalCouponDiscount + shipping);
    
    console.log('\n=== Final Cart Summary ===');
    console.log('- Subtotal:', totalPrice);
    console.log('- Total Offer Discount:', totalOfferDiscount);
    console.log('- Total Coupon Discount:', totalCouponDiscount);
    console.log('- Shipping:', shipping);
    console.log('- Final Price:', finalPrice);
    console.log('==========================\n');

    // Calculate item-level coupon discounts
    cart.items.forEach(item => {
      let itemCouponDiscount = 0;
      if (cart.appliedCoupon?.discountType === 'PERCENTAGE') {
        const itemPriceAfterOffer = item.originalPrice - (item.offerDiscount || 0);
        itemCouponDiscount = (itemPriceAfterOffer * cart.appliedCoupon.discountValue) / 100;
        
        // Distribute max discount proportionally if applicable
        if (cart.appliedCoupon.maxDiscount) {
          const itemProportion = itemPriceAfterOffer / (totalPrice - totalOfferDiscount);
          const maxItemDiscount = cart.appliedCoupon.maxDiscount * itemProportion;
          itemCouponDiscount = Math.min(itemCouponDiscount, maxItemDiscount);
        }
      }
      
      item.couponDiscount = itemCouponDiscount;
      item.totalPrice = item.originalPrice - (item.offerDiscount || 0) - itemCouponDiscount;
    });

    res.render('cart', {
      user: req.session.user,
      items: cart.items,
      totalPrice,
      totalOfferDiscount,
      totalCouponDiscount,
      shipping,
      finalPrice,
      coupons,
      appliedCoupon: cart.appliedCoupon,
      discount: totalCouponDiscount
    });

  } catch (error) {
    console.error('\n=== Error in cart route ===');
    console.error(error);
    console.error('==========================\n');
    res.status(500).send('Error loading cart');
  }
};


const updateQuantity = async (req, res) => {
  try {
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
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
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
    const currentQuantity = cartItem.quantity;
    let newQuantity = currentQuantity;
    const productStock = product.quantity || product.productStock || 0;
    const maxAllowed = Math.min(productStock, 6);
    
    if (action === 'increase') {
      if (currentQuantity >= maxAllowed) {
        if (productStock <= 6) {
          return res.status(400).json({ 
            success: false, 
            message: `Only ${productStock} items available in stock` 
          });
        } else {
          return res.status(400).json({ 
            success: false, 
            message: 'Maximum quantity limit reached (6 items per product)' 
          });
        }
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

    const basePrice = product.salePrice && product.salePrice < product.regularPrice ? 
      product.salePrice : product.regularPrice;
    let offerDiscount = 0;
    let largestDiscount = 0;

    if (product.offer && product.offer.isActive) {
      if (product.offer.discountType === 'percentage') {
        const discount = (basePrice * product.offer.discountValue) / 100;
        if (discount > largestDiscount) {
          largestDiscount = discount;
          offerDiscount = discount;
        }
      } else {
        if (product.offer.discountValue > largestDiscount) {
          largestDiscount = product.offer.discountValue;
          offerDiscount = product.offer.discountValue;
        }
      }
    }

    if (product.category && product.category.categoryOffer && 
        product.category.categoryOffer.isActive) {
      if (product.category.categoryOffer.discountType === 'percentage') {
        const discount = (basePrice * product.category.categoryOffer.discountValue) / 100;
        if (discount > largestDiscount) {
          largestDiscount = discount;
          offerDiscount = discount;
        }
      } else {
        if (product.category.categoryOffer.discountValue > largestDiscount) {
          largestDiscount = product.category.categoryOffer.discountValue;
          offerDiscount = product.category.categoryOffer.discountValue;
        }
      }
    }

    const effectivePrice = Math.max(basePrice - offerDiscount, 0);
    cartItem.quantity = newQuantity;
    cartItem.price = effectivePrice;
    cartItem.totalPrice = newQuantity * effectivePrice;

    await cart.save();

    const totalPrice = cart.items.reduce((total, item) => {
      const itemBasePrice = item.productId.salePrice && item.productId.salePrice < item.productId.regularPrice ? 
        item.productId.salePrice : item.productId.regularPrice;
      let itemOfferDiscount = 0;
      let itemLargestDiscount = 0;

      if (item.productId.offer && item.productId.offer.isActive) {
        if (item.productId.offer.discountType === 'percentage') {
          const discount = (itemBasePrice * item.productId.offer.discountValue) / 100;
          if (discount > itemLargestDiscount) {
            itemLargestDiscount = discount;
            itemOfferDiscount = discount;
          }
        } else {
          if (item.productId.offer.discountValue > itemLargestDiscount) {
            itemLargestDiscount = item.productId.offer.discountValue;
            itemOfferDiscount = item.productId.offer.discountValue;
          }
        }
      }

      if (item.productId.category && item.productId.category.categoryOffer && 
          item.productId.category.categoryOffer.isActive) {
        if (item.productId.category.categoryOffer.discountType === 'percentage') {
          const discount = (itemBasePrice * item.productId.category.categoryOffer.discountValue) / 100;
          if (discount > itemLargestDiscount) {
            itemLargestDiscount = discount;
            itemOfferDiscount = discount;
          }
        } else {
          if (item.productId.category.categoryOffer.discountValue > itemLargestDiscount) {
            itemLargestDiscount = item.productId.category.categoryOffer.discountValue;
            itemOfferDiscount = item.productId.category.categoryOffer.discountValue;
          }
        }
      }

      const itemEffectivePrice = Math.max(itemBasePrice - itemOfferDiscount, 0);
      return total + (itemEffectivePrice * item.quantity);
    }, 0);

    const shipping = totalPrice > 1500 ? 0 : 40;
    const discount = cart.discount || 0;
    const finalPrice = totalPrice - discount + shipping;

    res.json({
      success: true,
      quantity: newQuantity,
      totalPrice: cartItem.totalPrice,
      stock: productStock,
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
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user.id;

    const addresses = await Address.find({ userId: userId });

    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate('appliedCoupon');

    const coupons = await Coupon.find({
      isActive: true,
      expiryDate: { $gt: new Date() }
    }).select('code discountType discountValue maxDiscount minOrderAmount expiryDate usedBy');

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ['all', 'categories', 'products'] }
    });

    if (!cart || cart.items.length === 0) {
      return res.render('checkout', {
        user: req.session.user,
        items: [],
        totalPrice: 0,
        totalOfferDiscount: 0,
        totalCouponDiscount: 0,
        shipping: 0,
        finalPrice: 0,
        addresses: [], 
        appliedCoupon: null,
        coupons: []
      });
    }

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalCouponDiscount = 0;

    cart.items.forEach(item => {
      const product = item.productId;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice ? 
        product.salePrice : product.regularPrice;
      const originalPrice = basePrice * item.quantity;
      totalPrice += originalPrice;

      item.price = basePrice;
      item.originalPrice = originalPrice;
    });

    cart.items.forEach(item => {
      const product = item.productId;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice ? 
        product.salePrice : product.regularPrice;
      const { maxDiscount, bestOffer } = getBestOffer(product, offers, item.quantity);
      item.offerDiscount = maxDiscount;
      item.appliedOffer = bestOffer;
      totalOfferDiscount += maxDiscount;
    });

    if (cart.appliedCoupon) {
      const coupon = cart.appliedCoupon;
      const priceAfterOffer = totalPrice - totalOfferDiscount;
      if (coupon.discountType === 'PERCENTAGE') {
        totalCouponDiscount = (priceAfterOffer * coupon.discountValue) / 100;
        if (coupon.maxDiscount) {
          totalCouponDiscount = Math.min(totalCouponDiscount, coupon.maxDiscount);
        }
      } else {
        totalCouponDiscount = coupon.discountValue;
      }
    }

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalPrice = totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;

    cart.items.forEach(item => {
      let itemCouponDiscount = 0;
      if (cart.appliedCoupon && cart.appliedCoupon.discountType === 'PERCENTAGE') {
        itemCouponDiscount = ((item.originalPrice - item.offerDiscount) * (cart.appliedCoupon.discountValue / 100));
      } else if (cart.appliedCoupon) {
        itemCouponDiscount = 0;
      }
      item.couponDiscount = itemCouponDiscount;
      item.totalPrice = item.originalPrice - item.offerDiscount - itemCouponDiscount;
    });

    res.render('checkout', {
      user: req.session.user,
      items: cart.items,
      totalPrice,
      totalOfferDiscount,
      totalCouponDiscount,
      shipping,
      finalPrice,
      addresses,
      appliedCoupon: cart.appliedCoupon,
      coupons
    });
  } catch (error) {
    console.error('Error in getCheckout:', error);
    req.flash('error', 'Error loading checkout page');
    res.redirect('/home');
  }
};

const applyCoupon = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.session.user.id;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Coupon code is required' });
    }

    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty or not found' });
    }

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });

    let totalPrice = 0;
    let totalOfferDiscount = 0;

    cart.items.forEach(item => {
      const product = item.productId;
      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;
      const itemTotal = basePrice * quantity;
      totalPrice += itemTotal;
      const { maxDiscount } = getBestOffer(product, offers, quantity);
      totalOfferDiscount += maxDiscount;
    });

    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
      expiryDate: { $gt: new Date() }
    });

    if (!coupon) {
      return res.status(400).json({ success: false, message: 'Invalid or expired coupon code' });
    }

    const alreadyUsed = await User.findOne({
      _id: userId,
      usedCoupons: coupon._id
    });

    if (alreadyUsed) {
      return res.status(400).json({ success: false, message: 'Coupon already used' });
    }

    if (coupon.minOrderAmount && totalPrice < coupon.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon`
      });
    }

    let totalAfterOff = totalPrice - totalOfferDiscount;

    let couponDiscount = 0;
    if (coupon.discountType === 'PERCENTAGE') {
      couponDiscount = (totalAfterOff * coupon.discountValue) / 100;
      if (coupon.maxDiscount) {
        couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
      }
    } else {
      couponDiscount = coupon.discountValue;
    }

    cart.appliedCoupon = coupon._id;
    cart.appliedCouponDetails = coupon;
    cart.discount = couponDiscount;
    await cart.save();

    await Coupon.findByIdAndUpdate(coupon._id, { $addToSet: { usedBy: userId } });

await User.findByIdAndUpdate(userId, {
  $addToSet: {
    usedCoupons: {
      code: coupon.code.toUpperCase(),
      usedOn: new Date()
    }
  }
});

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalPrice = totalPrice - totalOfferDiscount - couponDiscount + shipping;

    return res.json({
      success: true,
      message: 'Coupon applied successfully',
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: couponDiscount,
        maxDiscount: coupon.maxDiscount
      },
      totals: {
        subtotal: totalPrice,
        offerDiscount: totalOfferDiscount,
        couponDiscount,
        shipping,
        finalPrice
      }
    });

  } catch (error) {
    console.error('Error in applyCoupon:', error);
    return res.status(500).json({
      success: false,
      message: 'Error applying coupon'
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
      })
      .populate('appliedCoupon'); 

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
      const price = item.productId.salePrice <= item.productId.regularPrice
        ? item.productId.salePrice
        : item.productId.regularPrice;
      return total + (price * item.quantity);
    }, 0);

    const couponId = cart.appliedCoupon?._id;
    const couponCode = cart.appliedCoupon?.code;

    cart.appliedCoupon = null;
    cart.appliedCouponDetails = null;
    cart.discount = 0;
    await cart.save();

    if (couponId) {
      await Coupon.findByIdAndUpdate(couponId, { $pull: { usedBy: userId } });
    }

    if (couponCode) {
      await User.findByIdAndUpdate(userId, {
        $pull: { usedCoupons: { code: couponCode.toUpperCase() } }
      });
    }

    const shipping = totalPrice >= 1500 ? 0 : 40;
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


const placeOrder = async (req, res) => {
  console.log('sdffhgvmbgfgsdfadgfdhgmhvfgdsdggfh');
  try {
    const userId = req.session.user.id;
    const { addressId, paymentMethod } = req.body;

    if (!addressId || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Address and payment method are required' });
    }

    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalQuantities = 0;
    const processedItems = [];

    for (const item of cart.items) {
      const product = item.productId;
      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;
      const originalPrice = basePrice * quantity;
      totalPrice += originalPrice;
      totalQuantities += quantity;

      const { maxDiscount, bestOffer, offerType } = getBestOffer(product, offers, quantity);
      totalOfferDiscount += maxDiscount;

      processedItems.push({
        productId: product._id,
        quantity: quantity,
        originalPrice: originalPrice,
        price: basePrice,
        appliedOffer: bestOffer ? {
          offerId: bestOffer._id,
          offerType: offerType,
          offerName: bestOffer.offerName,
          discountType: bestOffer.discountType,
          discountValue: bestOffer.discountValue,
          discountAmount: maxDiscount
        } : null
      });
    }

    const shipping = totalPrice >= 1500 ? 0 : 40;
    let couponDiscount = 0;
    let usedCoupon = null;
    if (cart.appliedCoupon) {
      const coupon = await Coupon.findById(cart.appliedCoupon);
      if (coupon) {
        if (coupon.usedBy && coupon.usedBy.includes(userId)) {
          return res.status(400).json({ 
            success: false, 
            message: 'You have already used this coupon in a previous order' 
          });
        }
        const priceAfterOffer = totalPrice - totalOfferDiscount;
        if (coupon.discountType === 'PERCENTAGE') {
          couponDiscount = (priceAfterOffer * coupon.discountValue) / 100;
          if (coupon.maxDiscount) {
            couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
          }
        } else {
          couponDiscount = coupon.discountValue;
        }
        try {
          usedCoupon = coupon._id;
        } catch (error) {
          console.error('Error updating coupon usedBy:', error);
          return res.status(500).json({
            success: false,
            message: 'Error processing coupon'
          });
        }
      }
    }

    const finalPrice = totalPrice - totalOfferDiscount - couponDiscount + shipping;

    const couponPerUnit = totalQuantities > 0 ? couponDiscount / totalQuantities : 0;

    const finalItems = processedItems.map(item => ({
      ...item,
      couponPerUnit: couponPerUnit,
      totalCouponDiscount: couponPerUnit * item.quantity,
      finalPrice: item.originalPrice - (item.appliedOffer ? item.appliedOffer.discountAmount : 0) - (couponPerUnit * item.quantity)
    }));

    const order = new Order({
      userId,
      items: finalItems,
      totalAmount: finalPrice,
      shippingAddress: addressId,
      paymentMethod,
      status: 'Pending',
      usedCoupon: usedCoupon,
      couponDiscount: couponDiscount,
      couponDistribution: {
        totalQuantities: totalQuantities,
        couponPerUnit: couponPerUnit
      },
      offerDiscount: totalOfferDiscount,
      subtotal: totalPrice,
      shipping: shipping,
      couponApplied: !!usedCoupon
    });

    await order.save();

    for (const item of cart.items) {
      const product = item.productId;
      if (product) {
        const newStock = (product.quantity || 0) - item.quantity;
        await Product.findByIdAndUpdate(product._id, {
          quantity: newStock < 0 ? 0 : newStock,
          status: newStock > 0 ? 'Available' : 'Out of Stock'
        });
      }
    }

    if (usedCoupon) {
      try {
        await Coupon.findByIdAndUpdate(usedCoupon, { $addToSet: { usedBy: userId } });
      } catch (error) {
        console.error('Error marking coupon as used:', error);
       
      }
    }

    cart.items = [];
    cart.appliedCoupon = null;
    cart.discount = 0;
    await cart.save();

    res.json({ 
      success: true, 
      message: 'Order placed successfully',
      orderId: order._id
    });

  } catch (error) {
    console.error('Error in placeOrder:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error placing order' 
    });
  }
};

/**
 * Finds the best applicable offer for a product
 * @param {Object} product - The product to find offers for
 * @param {Array} offers - Array of offer objects
 * @param {number} [quantity=1] - Quantity of the product
 * @returns {Object} Object containing maxDiscount, bestOffer, and offerType
 */
function getBestOffer(product, offers = [], quantity = 1) {
    // Input validation
    if (!product || !Array.isArray(offers)) {
        console.warn('Invalid input to getBestOffer:', { product, offers });
        return { maxDiscount: 0, bestOffer: null, offerType: null };
    }

    let maxDiscount = 0;
    let bestOffer = null;
    let offerType = null;
    const now = new Date();

    console.log(`\n=== getBestOffer for ${product.productName} (${product._id}) ===`);
    console.log(`- Category: ${product.category?.name || 'None'} (${product.category?._id || 'N/A'})`);
    console.log(`- Regular Price: ${product.regularPrice}, Sale Price: ${product.salePrice || 'None'}`);
    console.log(`- Quantity: ${quantity}`);

    // Sort offers by discount value (highest first)
    const sortedOffers = [...offers].sort((a, b) => {
        const aValue = a.discountType === 'percentage' ? a.discountValue * 1000 : a.discountValue;
        const bValue = b.discountType === 'percentage' ? b.discountValue * 1000 : b.discountValue;
        return bValue - aValue;
    });

    for (const offer of sortedOffers) {
        // Skip if offer is not active or expired
        if (!offer.isActive || now < new Date(offer.startDate) || now > new Date(offer.endDate)) {
            console.log(`\nSkipping offer ${offer.name || offer._id} - ${!offer.isActive ? 'Inactive' : 'Expired'}`);
            continue;
        }

        const price = (product.salePrice && product.salePrice < product.regularPrice)
            ? product.salePrice
            : product.regularPrice;

        let applies = false;
        let currentOfferType = null;

        // Check offer applicability
        if (offer.applicableOn === 'all') {
            applies = true;
            currentOfferType = 'all_products';
            console.log(`\nOffer ${offer.name || offer._id}: Applies to all products`);
        } 
        else if (offer.applicableOn === 'categories' && product?.category?._id) {
            const categoryMatch = Array.isArray(offer.categories) && 
                offer.categories.some(catId => 
                    catId.toString() === product.category._id.toString()
                );
            
            if (categoryMatch) {
                applies = true;
                currentOfferType = 'category';
                console.log(`\nOffer ${offer.name || offer._id}: Applies to category ${product.category.name}`);
            }
        }
        else if (offer.applicableOn === 'products' && product?._id) {
            const productMatch = Array.isArray(offer.products) && 
                offer.products.some(prodId => 
                    prodId.toString() === product._id.toString()
                );
            
            if (productMatch) {
                applies = true;
                currentOfferType = 'product';
                console.log(`\nOffer ${offer.name || offer._id}: Applies to this specific product`);
            }
        }

        if (applies) {
            // Calculate discount
            let discount = offer.discountType === 'percentage'
                ? (price * offer.discountValue / 100) * quantity
                : offer.discountValue * quantity;

            // Apply max discount cap if it exists
            if (offer.discountType === 'percentage' && offer.maxDiscount) {
                discount = Math.min(discount, offer.maxDiscount);
                console.log(`- Capped at max discount: ${offer.maxDiscount}`);
            }

            console.log(`- Calculated discount: ${discount} (${offer.discountValue}${offer.discountType === 'percentage' ? '%' : ' flat'})`);

            if (discount > maxDiscount) {
                maxDiscount = discount;
                bestOffer = offer;
                offerType = currentOfferType;
                console.log('- New best offer!');
            }
        }
    }

    console.log(`\n=== Best Offer for ${product.productName} ===`);
    console.log(`- Offer: ${bestOffer?.name || 'None'}`);
    console.log(`- Type: ${offerType || 'None'}`);
    console.log(`- Max Discount: ${maxDiscount}`);
    console.log('==============================\n');

    return { 
        maxDiscount: Math.max(0, maxDiscount), // Ensure non-negative
        bestOffer,
        offerType
    };
}

module.exports = {
  addToCart,
  cart,
  updateQuantity,
  removeItem,
  getCheckout,
  applyCoupon,
  removeCoupon,
  placeOrder
};
