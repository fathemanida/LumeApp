const User=require('../../models/userSchema');
const Order=require('../../models/orderSchema');
const Product=require('../../models/productSchema');
const Cart=require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require('dotenv').config();
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const router = require('../../routes/userRoutes');
const crypto = require('crypto');
const Coupon = require('../../models/couponSchema');
const calculateCartTotals = require('../../helpers/calculateTotal');
const Wallet = require('../../models/walletSchema');
const Razorpay = require('razorpay');
const Offer = require('../../models/offerSchema');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
  test_mode: true
});

const paymentMethod = async (req, res) => {
  try {
    console.log('Payment method called');
    if (!req.session.user) {
      console.log('No user session, redirecting to login');
      return res.redirect('/login');
    }

    const userId = req.session.user.id;
    const user = await User.findById(userId);
    
    const address = await Address.findOne({ userId});
    if (!address) {
      req.flash('error', 'Please add a default address before proceeding to payment');
      return res.redirect('/checkout');
    }
    console.log('====adrress',address);
    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate('appliedCoupon');

    if (!cart) {
      console.log('No cart found for user');
      req.flash('error', 'Your cart is empty');
      return res.redirect('/cart');
    }
    
    if (!cart.items || cart.items.length === 0) {
      console.log('Cart is empty');
      req.flash('error', 'Your cart is empty');
      return res.redirect('/cart');
    }

    const now = new Date();
    const activeOffers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });

    let subtotal = 0;
    let totalOfferDiscount = 0;
    const items = [];

    for (const item of cart.items) {
      const product = item.productId;
      if (!product || !product.isListed) continue;

      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice 
        ? product.salePrice 
        : product.regularPrice;
      
      const originalPrice = basePrice * quantity;
      subtotal += originalPrice;

      const { maxDiscount: offerDiscount } = getBestOffer(product, activeOffers, quantity);
      totalOfferDiscount += offerDiscount;
      console.log('=====payment');
      items.push({
        productId: product._id,
        name: product.productName || 'Product',
        price: basePrice,
        quantity: quantity,
        total: basePrice * quantity,
        image: product.images?.[0] || '/images/default-product.png',
        offerDiscount: offerDiscount
      });
    }

    let couponDiscount = 0;
    if (cart.appliedCoupon) {
      const coupon = await Coupon.findOne({ _id: cart.appliedCoupon._id });
      const isUsed = user.usedCoupons?.some(c => c.toString() === coupon._id.toString());
      
      if (coupon && coupon.isActive && coupon.expiry > now && !isUsed) {
        const discountableAmount = subtotal - totalOfferDiscount;
        if (coupon.discountType === 'percentage') {
          couponDiscount = (discountableAmount * coupon.discountValue) / 100;
          if (coupon.maxDiscount) {
            couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
          }
        } else {
          couponDiscount = Math.min(coupon.discountValue, discountableAmount);
        }
      }
    }

    const shipping = subtotal >= 1500 ? 0 : 40;
    const totalDiscount = totalOfferDiscount + couponDiscount;
    const finalTotal = Math.max(0, subtotal - totalDiscount + shipping);
    
    const cartData = {
      items: items,
      subtotal: subtotal,
      offerDiscount: totalOfferDiscount,
      couponDiscount: couponDiscount,
      discount: totalDiscount,
      shipping: shipping,
      totalPrice: finalTotal,
      appliedCoupon: cart.appliedCoupon
    };

    console.log('Rendering payment with cart data:', cartData);
    
    if (!user) {
      const error = new Error('User data is missing');
      console.error('Validation error:', error.message);
      req.flash('error', 'User session expired. Please login again.');
      return res.redirect('/login');
    }
    
    if (!cart || !cart.items || cart.items.length === 0) {
      const error = new Error('Cart is empty');
      console.error('Validation error:', error.message);
      req.flash('error', 'Your cart is empty');
      return res.redirect('/cart');
    }
    
    if (!address) {
      const error = new Error('Address is required');
      console.error('Validation error:', error.message);
      req.flash('error', 'Please add a shipping address before proceeding to payment');
      return res.redirect('/checkout');
    }
    
    console.log('Rendering payment page with data:', {
      user: user ? 'User exists' : 'No user',
      cartItems: cart.items.length,
      address: address ? 'Address exists' : 'No address',
      subtotal: subtotal,
      totalDiscount: totalDiscount,
      finalTotal: finalTotal
    });
    
    try {
      return res.render('payment', {
        user: user,
        cart: cartData,
        address: address,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        razorpayOrderId: null,
        amount: finalTotal * 100, 
        currency: 'INR',
        orderId: null 
      });
    } catch (renderError) {
      console.error('Render error in paymentMethod:', renderError);
      console.error('Render error details:', {
        message: renderError.message,
        stack: renderError.stack
      });
      req.flash('error', 'Failed to load payment page. Please try again.');
      return res.redirect('/cart');
    }
  } catch (error) {
    console.error('Error in paymentMethod:', error);
    req.flash('error', 'An error occurred while processing your payment');
    return res.redirect('/cart');
  }
};



const createOrder = async (req, res) => {
  let transaction;
  try {
    console.log('=== Starting createOrder ===');
    const startTime = Date.now();
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    if (!req.session.user) {
      console.error('No user session found');
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    
    const userId = req.session.user.id;
    const { addressId, paymentMethod } = req.body;
    
    console.log(`Processing order for user ${userId} with payment method: ${paymentMethod}`);

    if (!addressId) {
      console.error('No addressId provided in request');
      return res.status(400).json({ success: false, message: 'Address is required' });
    }
    
    if (!paymentMethod) {
      console.error('No paymentMethod provided in request');
      return res.status(400).json({ success: false, message: 'Payment method is required' });
    }

    console.log('Fetching cart for user...');
    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        select: 'productName salePrice regularPrice offer category quantity status images',
        populate: [
          { 
            path: 'offer',
            select: 'isActive discountType discountValue name startDate expiryDate',
            match: { isActive: true }
          },
          { 
            path: 'category', 
            select: 'name categoryOffer',
            populate: { 
              path: 'categoryOffer',
              select: 'active discountType discountValue name startDate expiryDate'
            }
          }
        ]
      })
      .populate({
        path: 'appliedCoupon',
        select: 'code discountValue discountType maxDiscount minOrderAmount validTill'
      })
      .lean()
      .maxTimeMS(10000); // 10 second timeout
      
    console.log(`Cart fetched in ${Date.now() - startTime}ms`);

    if (!cart) {
      console.error('No cart found for user');
      return res.status(400).json({ success: false, message: 'Your cart is empty' });
    }
    
    if (!cart.items || cart.items.length === 0) {
      console.error('No items in cart');
      return res.status(400).json({ success: false, message: 'Your cart is empty' });
    }
    
    console.log(`Processing ${cart.items.length} items in cart`);

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalCouponDiscount = 0;
    const now = new Date();
    
    console.log(`Processing cart items...`);
    const processStartTime = Date.now();

    cart.items.forEach(item => {
      const product = item.productId;
      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;

      const originalPrice = basePrice * quantity;

      let productOfferDiscount = 0;
      if (product.offer?.isActive && 
          (!product.offer.startDate || new Date(product.offer.startDate) <= now) &&
          (!product.offer.expiryDate || new Date(product.offer.expiryDate) >= now)) {
        if (product.offer.discountType === 'percentage') {
          productOfferDiscount = (originalPrice * product.offer.discountValue) / 100;
        } else {
          productOfferDiscount = product.offer.discountValue * quantity;
        }
      }

      let categoryOfferDiscount = 0;
      if (product.category?.categoryOffer?.active &&
          (!product.category.categoryOffer.startDate || new Date(product.category.categoryOffer.startDate) <= now) &&
          (!product.category.categoryOffer.expiryDate || new Date(product.category.categoryOffer.expiryDate) >= now)) {
        if (product.category.categoryOffer.discountType === 'percentage') {
          categoryOfferDiscount = (originalPrice * product.category.categoryOffer.discountValue) / 100;
        } else {
          categoryOfferDiscount = product.category.categoryOffer.discountValue * quantity;
        }
      }

      const offerDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);
      const priceAfterOffer = originalPrice - offerDiscount;

      item.originalPrice = originalPrice;
      item.basePrice = basePrice;
      item.priceAfterOffer = priceAfterOffer;
      item.offerDiscount = offerDiscount;
      // Determine which offer to apply (product or category)
      if (productOfferDiscount >= categoryOfferDiscount) {
        item.appliedOffer = product.offer?.isActive ? {
          offerId: product.offer._id,
          offerType: 'product',
          offerName: product.offer.name || '',
          discountType: product.offer.discountType,
          discountValue: product.offer.discountValue,
          discountAmount: productOfferDiscount
        } : null;
      } else {
        item.appliedOffer = product.category?.categoryOffer?.active ? {
          offerId: product.category.categoryOffer._id,
          offerType: 'category',
          offerName: product.category.categoryOffer.name || '',
          discountType: product.category.categoryOffer.discountType,
          discountValue: product.category.categoryOffer.discountValue,
          discountAmount: categoryOfferDiscount
        } : null;
      }

      totalPrice += originalPrice;
      totalOfferDiscount += offerDiscount;
    }
    
    console.log(`Cart items processed in ${Date.now() - processStartTime}ms`);
    
    // Validate cart totals
    if (isNaN(totalPrice) || totalPrice < 0) {
      console.error('Invalid cart total calculated:', totalPrice);
      return res.status(500).json({ success: false, message: 'Error calculating cart total' });
    }

    if (cart.appliedCoupon) {
      const priceAfterOffer = totalPrice - totalOfferDiscount;
      if (cart.appliedCoupon.discountType === 'PERCENTAGE') {
        totalCouponDiscount = (priceAfterOffer * cart.appliedCoupon.discountValue) / 100;
        if (cart.appliedCoupon.maxDiscount) {
          totalCouponDiscount = Math.min(totalCouponDiscount, cart.appliedCoupon.maxDiscount);
        }
      } else {
        totalCouponDiscount = cart.appliedCoupon.discountValue;
      }
    }

    // Calculate total price after offers
    const totalPriceAfterOffer = cart.items.reduce((sum, item) => sum + (item.priceAfterOffer || 0), 0);
    
    cart.items.forEach(item => {
      const itemCouponShare = totalCouponDiscount > 0 && totalPriceAfterOffer > 0
        ? (item.priceAfterOffer / totalPriceAfterOffer) * totalCouponDiscount
        : 0;
      item.couponPerUnit = item.quantity > 0 ? itemCouponShare / item.quantity : 0;
      item.totalCouponDiscount = itemCouponShare;
      item.finalPrice = item.priceAfterOffer - itemCouponShare;
    });

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalAmount = Math.max(0, totalPrice - totalOfferDiscount - totalCouponDiscount + shipping);
    
    console.log('Final amount:', finalAmount);
    
    // Prepare order data
    const orderData = {
      userId,
      items: cart.items.map(item => ({
        productId: item.productId._id,
        quantity: item.quantity,
        price: item.basePrice,
        totalPrice: item.finalPrice,
        status: 'Pending'
      })),
      totalAmount: finalAmount,
      shipping,
      paymentMethod,
      status: 'Pending',
      address: addressId,
      couponDiscount: totalCouponDiscount,
      offerDiscount: totalOfferDiscount,
      subtotal: totalPrice
    };
    
    // Save order to database with timeout
    console.log('Saving order to database...');
    const order = new Order(orderData);
    await order.save({ maxTimeMS: 10000 });
    console.log('Order saved:', order._id);
    
    // Update product quantities
    // Update product quantities
    const bulkOps = [];
    for (const item of cart.items) {
      if (item.productId && item.productId._id) {
        bulkOps.push({
          updateOne: {
            filter: { _id: item.productId._id },
            update: { $inc: { quantity: -item.quantity } }
          }
        });
      }
    }
    
    if (bulkOps.length > 0) {
      try {
        await Product.bulkWrite(bulkOps, { ordered: false });
      } catch (bulkWriteError) {
        console.error('Error updating product quantities:', bulkWriteError);
        // Continue with order creation even if stock update fails
      }
    }
    
    console.log(`Order created in ${Date.now() - startTime}ms`);
    
    // Clear cart
    await Cart.findOneAndUpdate(
      { userId },
      { $set: { items: [], appliedCoupon: null, updatedAt: new Date() } }
    );
    
    // Handle different payment methods
    if (paymentMethod === 'Razorpay') {
      try {
        const amountInPaise = Math.round(finalAmount * 100);
        const razorpayOrder = await razorpay.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: order._id.toString(),
          payment_capture: 1
        });
        
        order.razorpayOrderId = razorpayOrder.id;
        await order.save();
        
        return res.json({
          success: true,
          orderId: order._id,
          razorpayOrderId: razorpayOrder.id,
          amount: amountInPaise,
          currency: 'INR',
          key: process.env.RAZORPAY_KEY_ID
        });
        
      } catch (razorpayError) {
        console.error('Razorpay error:', razorpayError);
        throw new Error('Failed to create Razorpay order');
      }
    } else if (paymentMethod === 'COD' || paymentMethod === 'Wallet' || paymentMethod === 'UPI') {
      order.paymentStatus = paymentMethod === 'COD' ? 'Pending' : 'Paid';
      order.status = 'Processing';
      await order.save();
      
      return res.json({
        success: true,
        redirect: `/payment-confirmation?orderId=${order._id}`
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment method' });
    }
    
  } catch (error) {
    console.error('Error in createOrder:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const processPayment = async (req, res) => {
  try {
    console.log('====req got');
    const { method, orderId, upiId, walletId } = req.body;
    const userId = req.session.user.id;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' });
    }
    console.log('=====method,orderId,upiId,walletid', method, orderId, upiId, walletId);

    const order = await Order.findById(orderId)
      .populate('items.productId')
      .populate('address');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    console.log('Fetching address...');
    const addressId = order.address;
    const address = await Address.findById(addressId).maxTimeMS(5000);
    if (!address) {
      console.error('Address not found:', addressId);
      return res.status(400).json({ success: false, message: 'Address not found' });
    }
    console.log('Address found:', address._id);

    if (order.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this order' });
    }

    if (method === 'Razorpay') {
      
      if (!order.razorpayOrderId) {
        return res.status(400).json({ success: false, message: 'Invalid payment method for this order' });
      }

      return res.json({
        success: true,
        razorpayOrderId: order.razorpayOrderId,
        orderId: order._id,
        amount: Math.round(order.totalAmount * 100), 
        currency: 'INR',
        key: process.env.RAZORPAY_KEY_ID
      });
    } else if (method === 'COD' || method === 'Wallet' || method === 'UPI') {
      order.paymentStatus = method === 'COD' ? 'Pending' : 'Paid';
      order.status = 'Processing';
      console.log('======else if');
      if (method === 'UPI' && upiId) {
        order.paymentDetails = { upiId };
      } else if (method === 'Wallet' && walletId) {
        console.log('===wallt');
        order.paymentDetails = { walletId };
      }
      
      await order.save();

      await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [], appliedCoupon: null, updatedAt: new Date() } }
      );

      return res.json({
        success: true,
        redirect: `/payment-confirmation?orderId=${order._id}`
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment method' });
    }
  } catch (error) {
    console.error('Error in processPayment:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


const paymentConfirmation = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user.id;
    const { orderId } = req.query;

    if (!orderId) {
      console.log('❌ No order ID provided');
      return res.redirect('/orders');
    }

    console.log('🧾 Fetching order confirmation for user:', userId, 'Order ID:', orderId);

    const order = await Order.findOne({ _id: orderId, userId })
      .populate({
        path: 'items.productId',
        select: 'productName productImage regularPrice salePrice category offer',
        populate: [
          { 
            path: 'category', 
            select: 'name categoryOffer',
            populate: { 
              path: 'categoryOffer',
              select: 'name discountType discountValue active startDate expiryDate'
            } 
          },
          { 
            path: 'offer',
            select: 'name discountType discountValue isActive startDate expiryDate'
          }
        ]
      })
      .populate({
        path: 'address',
        select: 'name houseNo roadArea city state pincode phone isDefault'
      })
      .populate({
        path: 'appliedCoupon',
        select: 'code discountType discountValue maxDiscount'
      })
      .lean();

    if (!order) {
      console.log('❌ Order not found or does not belong to user.');
      return res.redirect('/orders');
    }

    console.log(`✅ Order ${order._id} found for user ${userId}`);
    
    const formattedItems = order.items.map(item => {
      const product = item.productId || {};
      const quantity = item.quantity || 1;
      
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice || 0;
      
      const originalPrice = basePrice * quantity;
      
      const offerDetails = item.appliedOffer ? {
        type: item.appliedOffer.offerType,
        name: item.appliedOffer.offerName,
        discountType: item.appliedOffer.discountType,
        discountValue: item.appliedOffer.discountValue,
        discountAmount: item.appliedOffer.discountAmount || 0
      } : null;

      const finalPricePerUnit = item.finalPrice || basePrice;
      const totalFinalPrice = finalPricePerUnit * quantity;
      
      const savings = originalPrice - totalFinalPrice;
      
      return {
        id: item._id,
        productId: product._id,
        name: product.productName || 'Product not available',
        image: product.productImage?.[0] || '/images/no-image.png',
        quantity,
        originalPrice: item.originalPrice || originalPrice,
        basePrice,
        price: finalPricePerUnit, 
        total: totalFinalPrice,   
        savings: savings > 0 ? savings : 0,
        status: item.status || 'Processing',
        appliedOffer: offerDetails,
        couponDiscount: item.couponPerUnit ? {
          perUnit: item.couponPerUnit,
          total: item.totalCouponDiscount || 0
        } : null,
        canCancel: ['Processing', 'Pending', 'Confirmed'].includes(item.status || 'Processing'),
        canReturn: item.status === 'Delivered' && 
                  (!item.returnRequested && !item.returnStatus)
      };
    });

    const subtotal = formattedItems.reduce((sum, item) => sum + (item.basePrice * item.quantity), 0);
    const totalDiscount = order.offerDiscount + order.couponDiscount;
    const shipping = order.shipping || (subtotal >= 1500 ? 0 : 40);
    const totalAmount = order.totalAmount || (subtotal - totalDiscount + shipping);

    const orderSummary = {
      orderNumber: order.orderNumber || `#${order._id.toString().slice(-6).toUpperCase()}`,
      orderDate: order.orderDate || order.createdAt,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      subtotal,
      discount: totalDiscount,
      shipping,
      total: totalAmount,
      itemsCount: formattedItems.reduce((sum, item) => sum + item.quantity, 0),
      estimatedDelivery: order.estimatedDelivery
        ? new Date(order.estimatedDelivery).toLocaleDateString()
        : 'Within 5-7 business days'
    };

    const responseData = {
      user: req.session.user,
      order: {
        ...orderSummary,
        items: formattedItems,
        address: order.address,
        canCancel: ['Pending', 'Processing', 'Confirmed'].includes(order.status),
        canTrack: ['Processing', 'Shipped', 'Out for Delivery'].includes(order.status),
        paymentDetails: order.paymentDetails || {}
      },
      showSuccess: req.query.success === 'true',
      successMessage: 'Your order has been placed successfully!',
      showError: req.query.error,
      errorMessage: req.query.error || ''
    };

    console.log(`📦 Order ${order._id} confirmation page loaded successfully`);
    
    res.render('orderConfirmation', responseData);

  } catch (error) {
    console.error('Error in paymentConfirmation:', error);
    
    res.status(500).render('error', { 
      message: 'Something went wrong while loading your order details.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      user: req.session.user || null,
      showBackButton: true,
      backUrl: '/orders'
    });
  }
};

const paymentFailure = async (req, res) => {
  try {
    const { orderId, error } = req.query;

    
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        status: 'Failed',
        paymentStatus: 'Failed',
        paymentError: error || 'Payment failed'
      });
    }

    res.render('paymentFailed', {
      user: req.session.user,
      error: error || 'Payment could not be processed',
      orderId
    });
  } catch (error) {
    console.error('Error in paymentFailure:', error);
    res.render('paymentFailed', {
      user: req.session.user,
      error: 'An unexpected error occurred'
    });
  }
};

function getBestOffer(product, offers = [], quantity = 1) {
  if (!product || !Array.isArray(offers)) {
    console.warn("Invalid input to getBestOffer:", { product, offers });
    return { maxDiscount: 0, bestOffer: null, offerType: null };
  }

  let maxDiscount = 0;
  let bestOffer = null;
  let offerType = null;
  const now = new Date();

  console.log(
    `\n=== getBestOffer for ${product.productName} (${product._id}) ===`
  );
  console.log(
    `- Category: ${product.category?.name || "None"} (${
      product.category?._id || "N/A"
    })`
  );
  console.log(
    `- Regular Price: ${product.regularPrice}, Sale Price: ${
      product.salePrice || "None"
    }`
  );
  console.log(`- Quantity: ${quantity}`);

  const sortedOffers = [...offers].sort((a, b) => {
    const aValue =
      a.discountType === "percentage"
        ? a.discountValue * 1000
        : a.discountValue;
    const bValue =
      b.discountType === "percentage"
        ? b.discountValue * 1000
        : b.discountValue;
    return bValue - aValue;
  });

  for (const offer of sortedOffers) {
    if (
      !offer.isActive ||
      now < new Date(offer.startDate) ||
      now > new Date(offer.endDate)
    ) {
      console.log(
        `\nSkipping offer ${offer.name || offer._id} - ${
          !offer.isActive ? "Inactive" : "Expired"
        }`
      );
      continue;
    }

    const price =
      product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;

    let applies = false;
    let currentOfferType = null;

    if (offer.applicableOn === "all") {
      applies = true;
      currentOfferType = "all_products";
      console.log(
        `\nOffer ${offer.name || offer._id}: Applies to all products`
      );
    } else if (offer.applicableOn === "categories" && product?.category?._id) {
      const categoryMatch =
        Array.isArray(offer.categories) &&
        offer.categories.some(
          (catId) => catId.toString() === product.category._id.toString()
        );

      if (categoryMatch) {
        applies = true;
        currentOfferType = "category";
        console.log(
          `\nOffer ${offer.name || offer._id}: Applies to category ${
            product.category.name
          }`
        );
      }
    } else if (offer.applicableOn === "products" && product?._id) {
      const productMatch =
        Array.isArray(offer.products) &&
        offer.products.some(
          (prodId) => prodId.toString() === product._id.toString()
        );

      if (productMatch) {
        applies = true;
        currentOfferType = "product";
        console.log(
          `\nOffer ${offer.name || offer._id}: Applies to this specific product`
        );
      }
    }

    if (applies) {
      let discount =
        offer.discountType === "percentage"
          ? ((price * offer.discountValue) / 100) * quantity
          : offer.discountValue * quantity;

      if (offer.discountType === "percentage" && offer.maxDiscount) {
        discount = Math.min(discount, offer.maxDiscount);
        console.log(`- Capped at max discount: ${offer.maxDiscount}`);
      }

      console.log(
        `- Calculated discount: ${discount} (${offer.discountValue}${
          offer.discountType === "percentage" ? "%" : " flat"
        })`
      );

      if (discount > maxDiscount) {
        maxDiscount = discount;
        bestOffer = offer;
        offerType = currentOfferType;
        console.log("- New best offer!");
      }
    }
  }

  console.log(`\n=== Best Offer for ${product.productName} ===`);
  console.log(`- Offer: ${bestOffer?.name || "None"}`);
  console.log(`- Type: ${offerType || "None"}`);
  console.log(`- Max Discount: ${maxDiscount}`);
  console.log("==============================\n");

  return {
    maxDiscount: Math.max(0, maxDiscount), 
    bestOffer,
    offerType,
  };
}

module.exports = {
  paymentMethod,
  createOrder,
  processPayment,
  paymentConfirmation,
  verifyPayment,
  paymentFailure
};