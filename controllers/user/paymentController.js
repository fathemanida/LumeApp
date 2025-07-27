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
          categoryOfferDiscount = (originalPrice * product.category.categoryOffer.discountValue) / 100;
        } else {
          categoryOfferDiscount = product.category.categoryOffer.discountValue * quantity;
        }
      }

      const offerDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);

      item.originalPrice = originalPrice;
      item.offerDiscount = offerDiscount;
      item.appliedOffer = product.offer?.isActive
        ? {
            offerId: product.offer._id,
            offerType: 'product',
            offerName: product.offer.name || '',
            discountType: product.offer.discountType,
            discountValue: product.offer.discountValue,
            discountAmount: productOfferDiscount
          }
        : product.category?.categoryOffer?.active
        ? {
            offerId: product.category.categoryOffer._id,
            offerType: 'category',
            offerName: product.category.categoryOffer.name || '',
            discountType: product.category.categoryOffer.discountType,
            discountValue: product.category.categoryOffer.discountValue,
            discountAmount: categoryOfferDiscount
          }
        : null;

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
    
cart.items.forEach(item => {
  item.priceAfterOffer = item.originalPrice - item.offerDiscount;
});

const totalPriceAfterOffer = cart.items.reduce((sum, item) => sum + item.priceAfterOffer, 0);

cart.items.forEach(item => {
  const itemCouponShare = totalCouponDiscount > 0
    ? (item.priceAfterOffer / totalPriceAfterOffer) * totalCouponDiscount
    : 0;

  item.couponPerUnit = itemCouponShare / item.quantity;
  item.totalCouponDiscount = itemCouponShare;
});



    const itemsForOrder = cart.items.map(item => {
      const quantity = item.quantity;
      const originalPrice = item.originalPrice;
      const offerDiscount = item.offerDiscount || 0;

      const price = originalPrice - offerDiscount; 
      const finalPrice = price; 
      return {
        productId: item.productId._id,
        quantity: quantity,
        originalPrice: originalPrice,
        price: price / quantity,
        finalPrice: finalPrice,
        appliedOffer: item.appliedOffer || null,
        couponPerUnit: 0,
        totalCouponDiscount: 0,
        status: 'Processing'
      };
    });

    const order = new Order({
      userId,
      status: 'Pending',
      paymentMethod: paymentMethod || 'Razorpay',
      items: itemsForOrder,
      subtotal: totalPrice,
      shipping,
      offerDiscount: totalOfferDiscount,
      couponDiscount: totalCouponDiscount,
      totalAmount: finalAmount,
      address: addressId,
      appliedCoupon: cart.appliedCoupon?._id || null,
      coupon: cart.appliedCoupon
        ? {
            code: cart.appliedCoupon.code,
            discount: cart.appliedCoupon.discountValue,
            type: cart.appliedCoupon.discountType
          }
        : null
    });

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
      processedCart = {
        items: order.items.map(item => ({
          productId: {
            _id: item.productId._id,
            productName: item.productId.productName,
            productImage: item.productId.productImage,
            regularPrice: item.productId.regularPrice,
            salePrice: item.productId.salePrice
          },
          quantity: item.quantity,
          price: item.price, 
        })),
        subtotal: order.subtotal,
        offerDiscount: order.offerDiscount,
        couponDiscount: order.couponDiscount,
        shipping: order.shipping,
        discount: (order.offerDiscount || 0) + (order.couponDiscount || 0),
        totalPrice: order.totalAmount
      };

      return res.render('payment', {
        user: req.session.user,
        cart: processedCart,
        address: order.address,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        orderId: orderId,
        razorpayOrderId: order.razorpayOrderId,
        amount: order.totalAmount,
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

    order.paymentStatus = 'Paid';
    order.paymentMethod = 'Razorpay';
    order.razorpay = {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      signature: razorpay_signature
    };
    order.address = addressId;
    order.status = 'Processing';
    await order.save();

    console.log('Order updated successfully:', order._id);

    if (order.coupon || order.usedCoupon || order.appliedCoupon) {
      let couponCode = null;
      let couponId = null;
      if (order.coupon && order.coupon.code) {
        couponCode = order.coupon.code;
      } else if (order.usedCoupon && order.usedCoupon.code) {
        couponCode = order.usedCoupon.code;
        couponId = order.usedCoupon._id;
      } else if (order.appliedCoupon && order.appliedCoupon.code) {
        couponCode = order.appliedCoupon.code;
        couponId = order.appliedCoupon._id;
      }
      if (!couponId && couponCode) {
        const couponDoc = await Coupon.findOne({ code: couponCode });
        if (couponDoc) couponId = couponDoc._id;
      }
      try {
        if (couponCode) {
          await User.findByIdAndUpdate(order.userId, {
            $addToSet: { usedCoupons: { code: couponCode, usedOn: new Date() } }
          });
        }
        if (couponId) {
          await Coupon.findByIdAndUpdate(couponId, {
            $addToSet: { usedBy: order.userId }
          });
        }
      } catch (error) {
        console.error('Error marking coupon as used for user/coupon:', error);
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
    const { method, addressId, orderId } = req.body;

    if (orderId) {
      const order = await Order.findOne({ _id: orderId, userId })
        .populate({
          path: 'items.productId',
          populate: [
            { path: 'category', populate: { path: 'categoryOffer' } },
            { path: 'offer' }
          ]
        })
        .populate('usedCoupon')
        .populate('address');

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      if (order.status === 'Processing' || order.status === 'Delivered') {
        return res.status(400).json({ success: false, message: 'Order already paid or completed.' });
      }

      if (addressId && order.address.toString() !== addressId) {
        order.address = addressId;
        await order.save();
      }

      if (method && method.toLowerCase() === 'razorpay') {
        const amountInPaise = Math.round(order.totalAmount * 100);
        const razorpayOrder = await razorpay.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: order._id.toString(),
          payment_capture: 1
        });
        order.razorpayOrderId = razorpayOrder.id;
        order.paymentMethod = 'Razorpay';
        order.status = 'Pending';
        await order.save();
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
        let wallet = await Wallet.findOne({ userId });
        if (!wallet) {
          wallet = new Wallet({ userId, balance: 0, transactions: [] });
          await wallet.save();
        }
        if (wallet.balance < order.totalAmount) {
          return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
        }
        wallet.balance -= order.totalAmount;
        wallet.transactions.push({
          type: 'DEBIT',
          amount: order.totalAmount,
          description: `Order payment retry for order placed on ${order.createdOn.toLocaleString()}`,
          orderId: order._id,
          status: 'COMPLETED',
          createdAt: new Date()
        });
        await wallet.save();
        order.paymentMethod = 'Wallet';
        order.status = 'Processing';
        await order.save();
        return res.json({
          success: true,
          orderId: order._id,
          redirect: `/payment-confirmation?orderId=${order._id}`
        });
      }

      if (method && method.toLowerCase() === 'cod') {
        if (order.totalAmount < 1000) {
          console.log('COD not allowed for amount < 1000. User:', userId);
          return res.status(400).json({ success: false, message: 'COD is only available for orders of ₹1000 or more.' });
        }
        order.paymentMethod = 'COD';
        order.status = 'Processing';
        await order.save();
        return res.json({
          success: true,
          orderId: order._id,
          redirect: `/payment-confirmation?orderId=${order._id}`
        });
      }
    }

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
          console.log('else case worked');
        }
      }
      const offerDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);
      item.offerDiscount = offerDiscount;
      totalOfferDiscount += offerDiscount;
    });

    if (cartData.appliedCoupon) {
      console.log('if working');
      const priceAfterOffer = totalPrice - totalOfferDiscount;
      if (cartData.appliedCoupon.discountType === 'PERCENTAGE') {
        console.log('if insode if is working');
        totalCouponDiscount = (priceAfterOffer * cartData.appliedCoupon.discountValue) / 100;
        console.log('if','dis',totalCouponDiscount,'aftr off',priceAfterOffer,'appliedcoup',cartData.appliedCoupon.discountValue);
        if (cartData.appliedCoupon.maxDiscount) {
          totalCouponDiscount = Math.min(totalCouponDiscount, cartData.appliedCoupon.maxDiscount);
          console.log('else');
        }
      } else {
        totalCouponDiscount = cartData.appliedCoupon.discountValue;
      }
    }
    console.log(totalCouponDiscount,'coupon');

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
        return res.status(400).json({ success: false, message: 'COD is only available for orders of ₹1000 or more.' });
      }
      console.log('Creating COD order for user:', userId);
      const order = new Order({
        userId,
      items: cartData.items.map(item => {
  const basePrice = item.productId.salePrice && item.productId.salePrice < item.productId.regularPrice
    ? item.productId.salePrice
    : item.productId.regularPrice;
  const originalPrice = basePrice * item.quantity;

  const appliedOffer = item.productId.offer && item.productId.offer.isActive
    ? {
        offerId: item.productId.offer._id,
        offerType: 'product',
        offerName: item.productId.offer.name,
        discountType: item.productId.offer.discountType,
        discountValue: item.productId.offer.discountValue,
        discountAmount: item.offerDiscount || 0
      }
    : item.productId.category?.categoryOffer?.active
      ? {
          offerId: item.productId.category.categoryOffer._id,
          offerType: 'category',
          offerName: item.productId.category.categoryOffer.name,
          discountType: item.productId.category.categoryOffer.discountType,
          discountValue: item.productId.category.categoryOffer.discountValue,
          discountAmount: item.offerDiscount || 0
        }
      : null;

  const priceAfterOffer = originalPrice - (item.offerDiscount || 0);
  const couponPerUnit = cartData.appliedCoupon
    ? +(totalCouponDiscount / cartData.items.reduce((acc, i) => acc + i.quantity, 0)).toFixed(2)
    : 0;
  const totalCouponDiscountItem = couponPerUnit * item.quantity;

  const finalPrice = priceAfterOffer - totalCouponDiscountItem;

  return {
    productId: item.productId._id,
    quantity: item.quantity,
    originalPrice,
    price: basePrice,
    appliedOffer,
    couponPerUnit,
    totalCouponDiscount: totalCouponDiscountItem,
    finalPrice,
    status: 'Active'
  };
})
,
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

    console.log('🧾 Fetching order for user:', userId, 'Order ID:', orderId);

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

    if (!order) {
      console.log('❌ Order not found or does not belong to user.');
      return res.redirect('/orders');
    }

    console.log('✅ Order fetched successfully');
    console.log('📦 Raw Order Items:', order.items.length);

    let subtotal = 0;
    const formattedItems = order.items.map(item => {
      const product = item.productId;
      const quantity = item.quantity;
      let basePrice = 0;
      let originalPrice = 0;
      let itemTotal = 0;

      if (product) {
        basePrice = product.salePrice && product.salePrice < product.regularPrice
          ? product.salePrice
          : product.regularPrice;

        originalPrice = basePrice * quantity;
        subtotal += originalPrice;

        itemTotal = item.finalPrice ?? item.price * quantity ?? originalPrice;
      }

      console.log(`🧮 Item: ${product?.productName || 'Unknown'}, Quantity: ${quantity}, Base: ${basePrice}, Final: ${itemTotal}, Coupon/Unit: ${item.couponPerUnit}`);

      return {
        name: product?.productName || 'Product not available',
        image: product?.productImage?.[0] || '/images/no-image.png',
        productId: product?._id || null,
        quantity: quantity,
        price: basePrice,
        total: itemTotal,
        appliedOffer: item.appliedOffer || null,
        couponPerUnit: item.couponPerUnit || 0,
        totalCouponDiscount: item.totalCouponDiscount || 0,
        finalPrice: item.finalPrice || itemTotal,
        status: item.status || 'Active'
      };
    });

    const offerDiscount = typeof order.offerDiscount === 'number' ? order.offerDiscount : 0;
    const couponDiscount = typeof order.couponDiscount === 'number' ? order.couponDiscount : 0;
    const shipping = typeof order.shipping === 'number' ? order.shipping : (subtotal >= 1500 ? 0 : 40);
    const totalAmount = order.finalPrice || (subtotal - offerDiscount - couponDiscount + shipping);

    console.log('🧾 Subtotal:', subtotal);
    console.log('🏷️ Offer Discount:', offerDiscount);
    console.log('🏷️ Coupon Discount:', couponDiscount);
    console.log('🚚 Shipping:', shipping);
    console.log('💰 Final Total:', totalAmount);

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
    console.error('❗ Error in paymentConfirmation:', error);
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