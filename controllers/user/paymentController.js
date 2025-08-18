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
const Wallet = require('../../models/walletSchema');
const Razorpay = require('razorpay');
const Offer = require('../../models/offerSchema');
const MESSAGES = require('../../constants/message');


const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
  test_mode: true
});
const paymentMethod = async (req, res) => {
  try {
    console.log('payment method called');
    
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user.id;
    const user = await User.findById(userId);
    const address = await Address.findOne({ userId });

    if (!address) {
      req.flash('error', 'Please add a default address before proceeding to payment');
      return res.redirect('/checkout');
    }

    const orderId = req.method === 'POST' ? req.body.orderId : req.query.orderId;
    console.log('🧾 orderId:', orderId);

    let order;

    if (orderId) {
      order = await Order.findById(orderId).populate('items.productId couponApplied');

      if (!order) {
        req.flash('error', 'Order not found');
        return res.redirect('/orders');
      }

      const items = order.items.map(item => ({
        productId: item.productId._id,
        name: item.productId.productName,
        originalPrice: item.originalPrice,
        quantity: item.quantity,
        finalPrice: item.finalPrice,
        offerDiscount: item.offerDiscount || 0
      }));
console.log('===order',items);
      const cartData = {
        items,
        subtotal: order.subtotal,
        offerDiscount: order.offerDiscount || 0,
        couponDiscount: order.couponDiscount || 0,
        discount: order.offerDiscount+order.couponDiscount,
        shipping: order.shipping,
        totalPrice: order.totalAmount,
        couponApplied: order.couponApplied,
        
      };
console.log('====cart data',cartData);
      return res.render('payment', {
        user,
        cart: cartData,
        address,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        razorpayOrderId: null,
        amount: order.finalPrice * 100,
        currency: 'INR',
        orderId: order._id
      });
    }

    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate('couponApplied');

    if (!cart || cart.items.length === 0) {
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

      items.push({
        productId: product._id,
        name: product.productName || 'Product',
        price: basePrice,
        quantity,
        total: basePrice * quantity,
        image: product.images?.[0] || '/images/default-product.png',
        offerDiscount
      });
    }

    let couponDiscount = 0;
    if (cart.couponApplied) {
      const coupon = await Coupon.findById(cart.couponApplied._id);
      const isUsed = user.usedCoupons?.some(c => c.code === coupon.code);
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
      items,
      subtotal,
      offerDiscount: totalOfferDiscount,
      couponDiscount,
      discount: totalDiscount,
      shipping,
      totalPrice: finalTotal,
      couponApplied: cart.couponApplied
    };

    return res.render('payment', {
      user,
      cart: cartData,
      address,
      RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
      razorpayOrderId: null,
      amount: finalTotal * 100,
      currency: 'INR',
      orderId: null
    });

  } catch (error) {
    console.error(' Error in paymentMethod:', error);
    req.flash('error', 'Something went wrong. Please try again');
    return res.redirect('/cart');
  }
};





const createOrder = async (req, res) => {
  try {
    console.log("=== Starting createAndProcessOrder ===");
    const { addressId, paymentMethod: rawMethod, orderId, upiId, walletId } = req.body;

    if (!req.session.user) {
      return res.status(401).json({ success: false, message: "User not logged in" });
    }
    const userId = req.session.user.id;

    let method = (rawMethod || "").trim().toLowerCase();
    const methodMap = {
      cod: "COD",
      razorpay: "Razorpay",
      wallet: "Wallet",
      upi: "UPI",
    };
    if (!(method in methodMap)) {
      return res.status(400).json({ success: false, message: "Invalid payment method" });
    }
    method = methodMap[method];

    if (!addressId || !method) {
      return res.status(400).json({ success: false, message: "Address and payment method required" });
    }

    // ⚡ Re-try order (if orderId passed)
    let order = null;
    if (orderId) {
      order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found for retry" });
      }
      order.paymentMethod = method;
      order.status = "Pending";
      order.paymentStatus = method === "COD" ? "Pending" : "Paid";
      order.updatedAt = new Date();
      await order.save();
    }

    // ⚡ If new order (not retry)
    if (!order) {
      const cart = await Cart.findOne({ userId })
        .populate({
          path: "items.productId",
          select: "productName salePrice regularPrice offer category quantity status images",
          populate: [
            { path: "offer", select: "isActive discountType discountValue startDate expiryDate", match: { isActive: true } },
            { path: "category", select: "name categoryOffer", populate: { path: "categoryOffer", select: "active discountType discountValue startDate expiryDate" } },
          ],
        })
        .populate("couponApplied")
        .lean();

      if (!cart || !cart.items?.length) {
        return res.status(400).json({ success: false, message: "Your cart is empty" });
      }

      const now = new Date();
      let totalPrice = 0, totalOfferDiscount = 0, totalCouponDiscount = 0;

      const processedItems = cart.items.map((item) => {
        const product = item.productId;
        const quantity = item.quantity;

        const basePrice = product.salePrice && product.salePrice < product.regularPrice ? product.salePrice : product.regularPrice;
        const originalPrice = basePrice * quantity;

        let productOfferDiscount = 0;
        if (product.offer?.isActive &&
            (!product.offer.startDate || new Date(product.offer.startDate) <= now) &&
            (!product.offer.expiryDate || new Date(product.offer.expiryDate) >= now)) {
          productOfferDiscount = product.offer.discountType === "percentage"
            ? (originalPrice * product.offer.discountValue) / 100
            : product.offer.discountValue * quantity;
        }

        let categoryOfferDiscount = 0;
        if (product.category?.categoryOffer?.active &&
            (!product.category.categoryOffer.startDate || new Date(product.category.categoryOffer.startDate) <= now) &&
            (!product.category.categoryOffer.expiryDate || new Date(product.category.categoryOffer.expiryDate) >= now)) {
          categoryOfferDiscount = product.category.categoryOffer.discountType === "percentage"
            ? (originalPrice * product.category.categoryOffer.discountValue) / 100
            : product.category.categoryOffer.discountValue * quantity;
        }

        const offerDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);
        const finalPrice = originalPrice - offerDiscount;

        totalPrice += originalPrice;
        totalOfferDiscount += offerDiscount;

        return { productId: product._id, quantity, price: basePrice, originalPrice, finalPrice, status: "Active" };
      });

      const priceAfterOffer = totalPrice - totalOfferDiscount;

      if (cart.couponApplied) {
        totalCouponDiscount = cart.couponApplied.discountType === "PERCENTAGE"
          ? (priceAfterOffer * cart.couponApplied.discountValue) / 100
          : cart.couponApplied.discountValue;

        if (cart.couponApplied.maxDiscount) {
          totalCouponDiscount = Math.min(totalCouponDiscount, cart.couponApplied.maxDiscount);
        }
      }

      const shipping = totalPrice >= 1500 ? 0 : 40;
      const finalAmount = Math.max(0, priceAfterOffer - totalCouponDiscount + shipping);

      // ⚡ Check wallet balance BEFORE creating order
      if (method === "Wallet") {
        if (!walletId) {
          return res.status(400).json({ success: false, message: "Wallet ID required" });
        }
        const wallet = await Wallet.findOne({ userId });
        if (!wallet || wallet.balance < finalAmount) {
          return res.status(400).json({ success: false, message: "Insufficient wallet balance" });
        }
      }

      // ✅ Create Order (only if valid method)
      order = new Order({
        userId,
        items: processedItems,
        totalAmount: finalAmount,
        shipping,
        paymentMethod: method,
        status: method === "COD" ? "Pending" : "Processing",
        paymentStatus: method === "COD" ? "Pending" : "Paid",
        address: addressId,
        couponDiscount: totalCouponDiscount,
        offerDiscount: totalOfferDiscount,
        subtotal: totalPrice,
      });

      await order.save();

      // ⚡ Reduce stock
      const bulkOps = cart.items.map((item) => ({
        updateOne: { filter: { _id: item.productId._id }, update: { $inc: { quantity: -item.quantity } } },
      }));
      if (bulkOps.length > 0) {
        try {
          await Product.bulkWrite(bulkOps, { ordered: false });
        } catch (err) {
          console.error("Error updating product quantities:", err);
        }
      }

      // ⚡ Coupon tracking
      if (cart.couponApplied) {
        await Coupon.findByIdAndUpdate(cart.couponApplied._id, {
          $push: { usedBy: { userId, orderId: order._id, usedAt: new Date() } },
        });
        await User.findByIdAndUpdate(userId, {
          $push: { usedCoupons: { couponId: cart.couponApplied._id, orderId: order._id, usedAt: new Date() } },
        });
      }

      // ⚡ Clear cart
      await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [], couponApplied: null, updatedAt: new Date() } }
      );
    }

    // ⚡ Handle Razorpay (after order creation)
    if (method === "Razorpay") {
      try {
        const amountInPaise = Math.round(order.totalAmount * 100);
        const razorpayOrder = await razorpay.orders.create({
          amount: amountInPaise,
          currency: "INR",
          receipt: order._id.toString(),
          payment_capture: 1,
        });

        order.razorpayOrderId = razorpayOrder.id;
        await order.save();

        return res.json({
          success: true,
          orderId: order._id,
          razorpayOrderId: razorpayOrder.id,
          amount: amountInPaise,
          currency: "INR",
          key: process.env.RAZORPAY_KEY_ID,
        });
      } catch (err) {
        console.error("Razorpay error:", err);
        return res.status(500).json({ success: false, message: "Failed to create Razorpay order" });
      }
    }

    // ⚡ Handle Wallet deduction (after order creation)
    if (method === "Wallet") {
      const wallet = await Wallet.findOne({ userId });
      wallet.balance -= order.totalAmount;
      wallet.transactions.push({
        amount: order.totalAmount,
        type: "DEBIT",
        description: `Payment for Order #${order._id}`,
        orderId: order._id,
        status: "COMPLETED",
      });
      await wallet.save();

      order.paymentStatus = "Paid";
      order.paymentDetails = {
        walletId,
        transactionId: `WALLET-${Date.now()}`,
        amount: order.totalAmount,
      };
      order.status = "Processing";
      await order.save();
    }

    // ⚡ COD flow
    if (method === "COD") {
      order.paymentStatus = "Pending";
      order.paymentDetails = { method: "Cash on Delivery" };
      await order.save();
    }

    return res.json({
      success: true,
      orderId: order._id.toString(),
      paymentMethod: method,
      amount: order.totalAmount,
      redirect: `/payment-confirmation?orderId=${order._id}`,
    });

  } catch (err) {
    console.error("Error in createAndProcessOrder:", err);
    return res.status(500).json({
      success: false,
      message: "Error creating order",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
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
      console.log(' No order ID provided');
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
        path: 'usedCoupon',
        select: 'code discountType discountValue maxDiscount',
        options: { strictPopulate: false }
      })
      .lean();

    if (!order) {
      console.log('Order not found or does not belong to user.');
      return res.redirect('/orders');
    }

    console.log(`Order ${order._id} found for user ${userId}`);
    
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

    const plainOrder = order.toObject ? order.toObject() : { ...order };
    
    const responseData = {
      user: req.session.user,
      order: {
        ...plainOrder,
        ...orderSummary,
        items: formattedItems,
        address: plainOrder.address || {},
        canCancel: ['Pending', 'Processing', 'Confirmed'].includes(plainOrder.status || ''),
        canTrack: ['Processing', 'Shipped', 'Out for Delivery'].includes(plainOrder.status || ''),
        paymentDetails: plainOrder.paymentDetails || {},
        totalAmount: plainOrder.totalAmount || totalAmount || 0,
        subtotal: subtotal || 0,
        discount: totalDiscount || 0,
        shipping: shipping || 0,
        paymentMethod: plainOrder.paymentMethod || 'Credit Card',
        orderNumber: plainOrder.orderNumber || `ORD-${Date.now()}`
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
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      console.error('Signature verification failed:', {
        generated: generated_signature,
        received: razorpay_signature
      });
      return res.status(400).json({
        success: false,
        message: 'Signature verification failed',
        redirect: `/payment-failed?orderId=${orderId}&error=Payment verification failed`
      });
    }

    const order = await Order.findById(orderId)
      .populate('couponApplied')
      .populate('userId');

    if (!order) {
      console.error('Order not found:', orderId);
      return res.status(404).json({
        success: false,
        message: 'Order not found',
        redirect: '/payment-failed?error=Order not found'
      });
    }

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

    order.paymentStatus = 'Paid';
    order.status = 'Processing';
    order.paymentDetails = {
      razorpay: {
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        signature: razorpay_signature,
        verifiedAt: new Date()
      },
      method: 'Razorpay',
      status: 'COMPLTED',
      amount: order.totalAmount,
      currency: 'INR',
      paidAt: new Date()
    };

    if (addressId) {
      order.address = addressId;
    }

    order.items = order.items.map(item => ({
      ...item.toObject(),
      status: 'Processing',
      updatedAt: new Date()
    }));

    await order.save();
    console.log('Order updated successfully:', order._id);

    if (order.couponApplied) {
      try {
        const { code, _id: couponId } = order.couponApplied;

        await User.findByIdAndUpdate(
          order.userId,
          {
            $addToSet: {
              usedCoupons: {
                code,
                usedOn: new Date(),
                orderId: order._id
              }
            }
          }
        );

        await Coupon.findByIdAndUpdate(
          couponId,
          {
            $inc: { usageCount: 1 },
            $addToSet: { usedBy: order.userId },
            lastUsedAt: new Date()
          }
        );
      } catch (error) {
        console.error('Error updating coupon usage:', error);
      }
    }

    if (req.session.user) {
      await Cart.findOneAndUpdate(
        { userId: req.session.user.id },
        {
          $set: {
            items: [],
            discount: 0,
            couponApplied: null,
            updatedAt: new Date()
          }
        }
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
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      redirect: `/payment-failed?orderId=${orderId}&error=Payment processing failed`
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
     
    } else if (offer.applicableOn === "categories" && product?.category?._id) {
      const categoryMatch =
        Array.isArray(offer.categories) &&
        offer.categories.some(
          (catId) => catId.toString() === product.category._id.toString()
        );

      if (categoryMatch) {
        applies = true;
        currentOfferType = "category";
       
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


  return {
    maxDiscount: Math.max(0, maxDiscount), 
    bestOffer,
    offerType,
  };
}

module.exports = {
  paymentMethod,
  createOrder,
  paymentConfirmation,
  verifyPayment,
  paymentFailure
};