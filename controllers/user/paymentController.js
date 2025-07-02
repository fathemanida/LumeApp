const User=require('../../models/userSchema');
const Order=require('../../models/orderSchema');
const Product=require('../../models/productSchema');
const Cart=require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const router = require("../../routes/userRoutes");
const { error } = require("console");
const crypto = require('crypto');
const Coupon = require('../../models/couponSchema');
const calculateCartTotals = require('../../helpers/calculateTotal');
const Wallet = require('../../models/walletSchema');

const Razorpay = require('razorpay');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
  test_mode: true
});

const createOrder = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { addressId, paymentMethod } = req.body;

    if (!addressId) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }

const cart = await Cart.findOne({ userId })
  .populate({
    path: 'items.productId',
    populate: [
      { path: 'offer' },
      { path: 'category', populate: { path: 'categoryOffer' } }
    ]
  })
  .populate('appliedCoupon');

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Your cart is empty' });
    }

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalCouponDiscount = 0;

    cart.items.forEach(item => {
      const product = item.productId;
      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;

      const originalPrice = basePrice * quantity;
      let productOfferDiscount = 0;
      if (product.offer?.isActive) {
        if (product.offer.discountType === 'percentage') {
          productOfferDiscount = (originalPrice * product.offer.discountValue) / 100;
        } else {
          productOfferDiscount = product.offer.discountValue * quantity;
        }
      }
      let categoryOfferDiscount = 0;
      if (product.category?.categoryOffer?.active) {
        if (product.category.categoryOffer.discountType === 'percentage') {
          console.log('category off');
          categoryOfferDiscount = (originalPrice * product.category.categoryOffer.discountValue) / 100;
        } else {
          categoryOfferDiscount = product.category.categoryOffer.discountValue * quantity;
        }
      }
      const offerDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);
      item.originalPrice = originalPrice;
      item.offerDiscount = offerDiscount;
      totalPrice += originalPrice;
      totalOfferDiscount += offerDiscount;
    });

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

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalAmount = totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;

    const itemsForOrder = cart.items.map(item => ({
      productId: item.productId._id,
      quantity: item.quantity,
      price: item.originalPrice - item.offerDiscount - (
        cart.appliedCoupon?.discountType === 'percentage'
          ? (item.originalPrice * cart.appliedCoupon.discountValue) / 100
          : 0
      )
    }));

    const order = new Order({
      userId,
      status: 'Pending',
      paymentMethod: 'Razorpay',
      items: itemsForOrder,
      subtotal: totalPrice,
      shipping,
      offerDiscount: totalOfferDiscount,
      couponDiscount: totalCouponDiscount,
      totalAmount: finalAmount,
      address: addressId,
      appliedCoupon: cart.appliedCoupon?._id || null
    });
console.log('final amount',finalAmount);
    if (cart.appliedCoupon) {
      try {
        await Coupon.findByIdAndUpdate(cart.appliedCoupon._id, { $addToSet: { usedBy: userId } });
      } catch (error) {
        console.error('Error marking coupon as used:', error);
        return res.status(500).json({
          success: false,
          message: 'Error processing coupon'
        });
      }
    }


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

    const amountInPaise = Math.round(finalAmount * 100);
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: order._id.toString(),
      payment_capture: 1
    });

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    res.status(200).json({
      success: true,
      orderId: order._id,
      razorpayOrderId: razorpayOrder.id,
      currency: razorpayOrder.currency,
      amount: razorpayOrder.amount
    });
  } catch (error) {
    console.error('Error in createOrder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

const paymentMethod = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/signup');
    }

    const userId = req.session.user.id;
    const orderId = req.query.orderId;
    let address, cart, cartData, processedCart;

    if (orderId) {
      const order = await Order.findOne({ _id: orderId, userId })
        .populate({
          path: 'items.productId',
          populate: [
            { path: 'offer' },
            { path: 'category', populate: { path: 'categoryOffer' } }
          ]
        })
        .populate('usedCoupon')
        .populate('address');

      if (!order) {
        return res.redirect('/orders');
      }

      address = order.address;
      cart = await Cart.findOne({ userId: order.userId })
        .populate({
          path: 'items.productId',
          populate: [
            { path: 'offer' },
            { path: 'category', populate: { path: 'categoryOffer' } }
          ]
        })
        .populate('appliedCoupon');

      if (order.usedCoupon) {
        cart.appliedCoupon = order.usedCoupon;
      }

      cartData = calculateCartTotals(cart);

      const amountInPaise = Math.round(cartData.finalPrice * 100);
      const razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: order._id.toString(),
        payment_capture: 1
      });

      order.razorpayOrderId = razorpayOrder.id;
      order.totalAmount = cartData.finalPrice;
      await order.save();
      console.log('order saved at payment ',order);

      processedCart = {
        items: cartData.items.map(item => ({
          productId: {
            _id: item.productId._id,
            productName: item.productId.productName,
            productImage: item.productId.productImage,
            regularPrice: item.productId.regularPrice,
            salePrice: item.productId.salePrice
          },
          quantity: item.quantity,
          price: item.price,
          originalPrice: item.originalPrice,
          offerDiscount: item.offerDiscount,
          couponDiscount: item.couponDiscount,
          totalPrice: item.totalPrice
        })),
        subtotal: cartData.totalPrice,
        totalOfferDiscount: cartData.totalOfferDiscount,
        totalCouponDiscount: cartData.totalCouponDiscount,
        shipping: cartData.shipping,
        discount: cartData.totalOfferDiscount + cartData.totalCouponDiscount,
        totalPrice: cartData.finalPrice
      };

      return res.render('payment', {
        user: req.session.user,
        cart: processedCart,
        address: order.address,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        orderId: orderId,
        razorpayOrderId: razorpayOrder.id,
        amount: cartData.finalPrice,
        currency: 'INR'
      });
    }

    const addressId = req.query.addressId;
    if (!addressId) {
      return res.redirect('/checkout');
    }

    address = await Address.findOne({ _id: addressId, userId });
    if (!address) {
      return res.redirect('/checkout');
    }

    cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate('appliedCoupon');

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.redirect('/cart');
    }

    cartData = calculateCartTotals(cart);

    processedCart = {
      items: cartData.items.map(item => ({
        productId: {
          _id: item.productId._id,
          productName: item.productId.productName,
          productImage: item.productId.productImage,
          regularPrice: item.productId.regularPrice,
          salePrice: item.productId.salePrice
        },
        quantity: item.quantity,
        price: item.price,
        originalPrice: item.originalPrice,
        offerDiscount: item.offerDiscount,
        couponDiscount: item.couponDiscount,
        totalPrice: item.totalPrice
      })),
      subtotal: cartData.totalPrice,
      totalOfferDiscount: cartData.totalOfferDiscount,
      totalCouponDiscount: cartData.totalCouponDiscount,
      shipping: cartData.shipping,
      discount: cartData.totalOfferDiscount + cartData.totalCouponDiscount,
      totalPrice: cartData.finalPrice
    };

    res.render('payment', {
      user: req.session.user,
      cart: processedCart,
      address: address,
      RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
      orderId: null,
      razorpayOrderId: null,
      amount: processedCart.totalPrice,
      currency: 'INR'
    });

  } catch (error) {
    console.error('Error in paymentMethod:', error);
    res.status(500).render('error', { message: 'Something went wrong' });
  }
};

module.exports = { paymentMethod };

const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      orderId,
      addressId
    } = req.body;

    console.log('Verifying payment:', {
      razorpay_payment_id,
      razorpay_order_id,
      orderId,
      addressId
    });

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment credentials',
        redirect: `/payment-failed?orderId=${orderId}&error=Missing payment credentials`
      });
    }

    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Signature verification failed',
        redirect: `/payment-failed?orderId=${orderId}&error=Payment verification failed`
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
        redirect: '/payment-failed?error=Order not found'
      });
    }

    console.log('Found order:', {
      orderId: order._id,
      razorpayOrderId: order.razorpayOrderId,
      receivedRazorpayOrderId: razorpay_order_id
    });

    if (order.razorpayOrderId !== razorpay_order_id) {
      console.error('Order ID mismatch:', {
        stored: order.razorpayOrderId,
        received: razorpay_order_id
      });
      return res.status(400).json({
        success: false,
        message: 'Order ID mismatch',
        redirect: `/payment-failed?orderId=${orderId}&error=Order ID mismatch`
      });
    }

    const cart = await Cart.findOne({ userId: order.userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate('appliedCoupon');

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty or not found',
        redirect: '/payment-failed?error=Empty cart'
      });
    }

    const cartTotals = calculateCartTotals(cart);

    order.paymentStatus = 'Paid';
    order.paymentMethod = 'Razorpay';
    order.razorpay = {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      signature: razorpay_signature
    };
    order.address = addressId;
    order.status = 'Processing';

    order.subtotal = cartTotals.totalPrice;
    order.totalOfferDiscount = cartTotals.totalOfferDiscount;
    order.totalCouponDiscount = cartTotals.totalCouponDiscount;
    order.shipping = cartTotals.shipping;
    order.totalAmount = cartTotals.finalPrice;

    await order.save();

    console.log('Order updated successfully:', order._id);

    if (order.usedCoupon || order.appliedCoupon) {
      const couponId = order.usedCoupon || order.appliedCoupon;
      try {
        await Coupon.findByIdAndUpdate(couponId, {
          $addToSet: { usedBy: order.userId }
        });
      } catch (error) {
        console.error('Error marking coupon as used:', error);
      }
    }

    if (req.session.user) {
      await Cart.findOneAndUpdate(
        { userId: req.session.user.id },
        { $set: { items: [], discount: 0, appliedCoupon: null } }
      );
      console.log('Cart cleared for user:', req.session.user.id);
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      orderId: order._id,
      redirect: `/payment-confirmation?orderId=${order._id}`
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      redirect: `/payment-failed?error=${encodeURIComponent(error.message)}`
    });
  }
};

const processPayment = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ success: false, message: 'Please login to continue' });
    }

    const userId = req.session.user.id;
    const { method, addressId } = req.body;

    const cartData = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'category', populate: { path: 'categoryOffer' } },
          { path: 'offer' }
        ]
      })
      .populate('appliedCoupon');

    if (!cartData || !cartData.items || cartData.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalCouponDiscount = 0;

    cartData.items.forEach(item => {
      const product = item.productId;
      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;
      const originalPrice = basePrice * quantity;
      item.price = basePrice;
      item.originalPrice = originalPrice;
      totalPrice += originalPrice;

      let productOfferDiscount = 0;
      if (product.offer && product.offer.isActive) {
        if (product.offer.discountType === 'percentage') {
          productOfferDiscount = (originalPrice * product.offer.discountValue) / 100;
        } else {
          productOfferDiscount = product.offer.discountValue * quantity;
        }
      }
      let categoryOfferDiscount = 0;
      if (product.category && product.category.categoryOffer && product.category.categoryOffer.active) {
        if (product.category.categoryOffer.discountType === 'percentage') {
          categoryOfferDiscount = (originalPrice * product.category.categoryOffer.discountValue) / 100;
        } else {
          categoryOfferDiscount = product.category.categoryOffer.discountValue * quantity;
        }
      }
      const offerDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);
      item.offerDiscount = offerDiscount;
      totalOfferDiscount += offerDiscount;
    });

    if (cartData.appliedCoupon) {
      const priceAfterOffer = totalPrice - totalOfferDiscount;
      if (cartData.appliedCoupon.discountType === 'percentage') {
        totalCouponDiscount = (priceAfterOffer * cartData.appliedCoupon.discountValue) / 100;
        if (cartData.appliedCoupon.maxDiscount) {
          totalCouponDiscount = Math.min(totalCouponDiscount, cartData.appliedCoupon.maxDiscount);
        }
      } else {
        totalCouponDiscount = cartData.appliedCoupon.discountValue;
      }
    }

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalAmount = totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;

    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);

    console.log('processPayment called. Method:', method, 'User:', userId);

    if (method && method.toLowerCase() === 'razorpay') {
      console.log('Creating Razorpay order for user:', userId);
      const order = new Order({
        userId,
        items: cartData.items.map(item => ({
          productId: item.productId._id,
          quantity: item.quantity,
          price: item.totalPrice
        })),
        address: addressId,
        subtotal: totalPrice,
        totalAmount: finalAmount,
        couponDiscount: totalCouponDiscount,
        offerDiscount: totalOfferDiscount,
        shipping,
        paymentMethod: 'Razorpay',
        status: 'Pending',
        estimatedDelivery
      });
      await order.save();
      const amountInPaise = Math.round(finalAmount * 100);
      const razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: order._id.toString(),
        payment_capture: 1
      });
      order.razorpayOrderId = razorpayOrder.id;
      await order.save();
      console.log('Razorpay order created and saved. Order ID:', order._id);
      return res.json({
        success: true,
        orderId: order._id,
        razorpayOrderId: razorpayOrder.id,
        currency: razorpayOrder.currency,
        amount: razorpayOrder.amount,
        redirect: null 
      });
    }

    if (method && method.toLowerCase() === 'wallet') {
      console.log('Creating Wallet order for user:', userId);
      let wallet = await Wallet.findOne({ userId });
      if (!wallet) {
        wallet = new Wallet({ userId, balance: 0, transactions: [] });
        await wallet.save();
      }
      if (wallet.balance < finalAmount) {
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }
      wallet.balance -= finalAmount;
      wallet.transactions.push({
        type: 'DEBIT',
        amount: finalAmount,
        description: `Order payment for order placed on ${new Date().toLocaleString()}`,
        orderId: null,
        status: 'COMPLETED',
        createdAt: new Date()
      });
      await wallet.save();
      const order = new Order({
        userId,
        items: cartData.items.map(item => ({
          productId: item.productId._id,
          quantity: item.quantity,
          price: item.totalPrice
        })),
        address: addressId,
        subtotal: totalPrice,
        totalAmount: finalAmount,
        couponDiscount: totalCouponDiscount,
        offerDiscount: totalOfferDiscount,
        shipping,
        paymentMethod: 'Wallet',
        status: 'Pending',
        estimatedDelivery
      });
      await order.save();
      wallet.transactions[wallet.transactions.length - 1].orderId = order._id;
      await wallet.save();
      await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [], discount: 0 } }
      );
      console.log('Wallet order created and saved. Order ID:', order._id);
      return res.json({
        success: true,
        orderId: order._id,
        redirect: `/payment-confirmation?orderId=${order._id}`
      });
    }

    if (method && method.toLowerCase() === 'cod') {
      if (finalAmount < 1000) {
        console.log('COD not allowed for amount < 1000. User:', userId);
        return res.status(400).json({ success: false, message: 'Cash on Delivery is only available for orders of ₹1000 or more.' });
      }
      console.log('Creating COD order for user:', userId);
      const order = new Order({
        userId,
        items: cartData.items.map(item => ({
          productId: item.productId._id,
          quantity: item.quantity,
          price: item.totalPrice
        })),
        address: addressId,
        subtotal: totalPrice,
        totalAmount: finalAmount,
        couponDiscount: totalCouponDiscount,
        offerDiscount: totalOfferDiscount,
        shipping,
        paymentMethod: 'COD',
        status: 'Pending',
        estimatedDelivery
      });
      await order.save();
      await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [], discount: 0 } }
      );
      console.log('COD order created and saved. Order ID:', order._id);
      return res.json({
        success: true,
        orderId: order._id,
        redirect: `/payment-confirmation?orderId=${order._id}`
      });
    }

  } catch (error) {
    console.error('Error in processPayment:', error);
    res.status(500).json({
      success: false,
      message: 'Payment processing failed. Please try again.'
    });
  }
};

const paymentConfirmation = async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');

    const userId = req.session.user.id;
    const orderId = req.query.orderId;

    const order = await Order.findOne({ _id: orderId, userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate({
        path: 'address',
        select: 'name houseNo roadArea city state pincode phone'
      })
      .lean();

    if (!order) return res.redirect('/orders');

    // Use stored values from order schema
    let subtotal = 0;
    let formattedItems = order.items.map(item => {
      const product = item.productId;
      const quantity = item.quantity;
      let basePrice = 0;
      let finalPrice = 0;
      if (product) {
        basePrice = product.salePrice && product.salePrice < product.regularPrice
          ? product.salePrice
          : product.regularPrice;
        const originalPrice = basePrice * quantity;
        subtotal += originalPrice;
        finalPrice = item.price ? item.price * quantity : originalPrice;
      }
      return {
        name: product?.productName || 'Product not available',
        price: basePrice,
        quantity: quantity,
        total: finalPrice,
        discount: 0, // If you store per-item discount, use it here
        image: product?.productImage?.[0] || '/images/no-image.png',
        productId: product?._id || null
      };
    });
    const offerDiscount = typeof order.offerDiscount === 'number' ? order.offerDiscount : 0;
    const couponDiscount = typeof order.couponDiscount === 'number' ? order.couponDiscount : 0;
    const shipping = typeof order.shipping === 'number' ? order.shipping : (subtotal >= 1500 ? 0 : 40);
    const totalAmount = typeof order.totalAmount === 'number' ? order.totalAmount : (subtotal - offerDiscount - couponDiscount + shipping);

    const formattedOrder = {
      orderNumber: order._id.toString().slice(-6).toUpperCase(),
      totalAmount: totalAmount,
      subtotal: subtotal,
      discount: offerDiscount + couponDiscount,
      shipping: shipping,
      paymentMethod: order.paymentMethod,
      address: order.address,
      items: formattedItems
    };

    res.render('orderConfirmation', {
      order: formattedOrder,
      user: req.session.user
    });

  } catch (error) {
    console.error('Error in paymentConfirmation:', error);
    res.status(500).render('error', { message: 'Something went wrong' });
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

module.exports = {
  paymentMethod,
  createOrder,
  processPayment,
  paymentConfirmation,
  verifyPayment,
  paymentFailure
};