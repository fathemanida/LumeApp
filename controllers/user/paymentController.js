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
    const now = new Date();

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
      item.appliedOffer = productOfferDiscount >= categoryOfferDiscount
        ? (product.offer?.isActive ? {
            offerId: product.offer._id,
            offerType: 'product',
            offerName: product.offer.name || '',
            discountType: product.offer.discountType,
            discountValue: product.offer.discountValue,
            discountAmount: productOfferDiscount
          } : null)
        : (product.category?.categoryOffer?.active ? {
            offerId: product.category.categoryOffer._id,
            offerType: 'category',
            offerName: product.category.categoryOffer.name || '',
            discountType: product.category.categoryOffer.discountType,
            discountValue: product.category.categoryOffer.discountValue,
            discountAmount: categoryOfferDiscount
          } : null);

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

    const totalPriceAfterOffer = cart.items.reduce((sum, item) => sum + item.priceAfterOffer, 0);
    cart.items.forEach(item => {
      const itemCouponShare = totalCouponDiscount > 0 && totalPriceAfterOffer > 0
        ? (item.priceAfterOffer / totalPriceAfterOffer) * totalCouponDiscount
        : 0;
      item.couponPerUnit = item.quantity > 0 ? itemCouponShare / item.quantity : 0;
      item.totalCouponDiscount = itemCouponShare;
      item.finalPrice = item.priceAfterOffer - itemCouponShare;
    });

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalAmount = totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;

    const itemsForOrder = cart.items.map(item => {
      const product = item.productId;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;
      
      const originalPrice = basePrice * item.quantity;
      const finalPrice = item.finalPrice || originalPrice;
      const finalPricePerUnit = finalPrice / item.quantity;
      
      return {
        productId: product._id,
        name: product.productName,
        image: product.productImage?.[0] || '/images/no-image.png',
        quantity: item.quantity,
        originalPrice: originalPrice,
        price: basePrice,
        finalPrice: finalPricePerUnit,
        appliedOffer: item.appliedOffer || null,
        couponPerUnit: item.couponPerUnit || 0,
        totalCouponDiscount: item.totalCouponDiscount || 0,
        status: 'Processing',
        createdAt: new Date(),
        updatedAt: new Date()
      };
    });

    const couponData = cart.appliedCoupon ? {
      code: cart.appliedCoupon.code,
      discount: cart.appliedCoupon.discountValue,
      type: cart.appliedCoupon.discountType,
      maxDiscount: cart.appliedCoupon.maxDiscount
    } : null;

    const orderData = {
      userId,
      status: 'Pending',
      paymentStatus: 'Pending',
      paymentMethod: paymentMethod || 'Razorpay',
      items: itemsForOrder,
      subtotal: totalPrice,
      shipping,
      offerDiscount: totalOfferDiscount,
      couponDiscount: totalCouponDiscount,
      totalAmount: finalAmount,
      address: addressId,
      appliedCoupon: cart.appliedCoupon?._id || null,
      couponApplied: !!cart.appliedCoupon,
      coupon: couponData,
      razorpayOrderId: paymentMethod === 'Razorpay' ? `order_${require('crypto').randomBytes(8).toString('hex')}` : null,
      orderId: require('crypto').randomUUID(),
      createdOn: new Date(),
      updatedAt: new Date(),
      estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) // 5 days from now
    };

    const order = new Order(orderData);

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

    if (paymentMethod === 'Razorpay') {
      const amountInPaise = Math.round(finalAmount * 100);
      const razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: order._id.toString(),
        payment_capture: 1
      });
      order.razorpayOrderId = razorpayOrder.id;
      await order.save();

      return res.status(200).json({
        success: true,
        orderId: order._id,
        razorpayOrderId: razorpayOrder.id,
        currency: razorpayOrder.currency,
        amount: razorpayOrder.amount
      });
    } else if (paymentMethod === 'COD' || paymentMethod === 'Wallet') {
      order.status = 'Processing';
      order.paymentStatus = paymentMethod === 'COD' ? 'Pending' : 'Paid';
      await order.save();

      await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [], appliedCoupon: null } }
      );

      return res.status(200).json({
        success: true,
        orderId: order._id,
        redirect: `/payment-confirmation?orderId=${order._id}`
      });
    }

  } catch (error) {
    console.error('Error in createOrder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
      .populate('appliedCoupon')
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
      status: 'Completed',
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

    if (order.appliedCoupon) {
      try {
        const { code, _id: couponId } = order.appliedCoupon;
        
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
            appliedCoupon: null,
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

const processPayment = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Please login to continue' 
      });
    }

    const userId = req.session.user.id;
    const { method, addressId, orderId } = req.body;
    const now = new Date();

    if (orderId) {
      const order = await Order.findOne({ _id: orderId, userId })
        .populate({
          path: 'items.productId',
          populate: [
            { path: 'category', populate: { path: 'categoryOffer' } },
            { path: 'offer' }
          ]
        })
        .populate('appliedCoupon')
        .populate('address');

      if (!order) {
        return res.status(404).json({ 
          success: false, 
          message: 'Order not found' 
        });
      }

      if (['Processing', 'Shipped', 'Delivered', 'Completed'].includes(order.status)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Order already paid or completed.' 
        });
      }

      if (addressId && order.address.toString() !== addressId) {
        order.address = addressId;
        order.updatedAt = now;
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
        order.paymentStatus = 'Pending';
        order.status = 'Pending';
        order.updatedAt = now;
        
        order.paymentDetails = {
          method: 'Razorpay',
          status: 'Initiated',
          amount: order.totalAmount,
          currency: 'INR',
          initiatedAt: now,
          razorpay: {
            orderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency
          }
        };

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
          wallet = new Wallet({ 
            userId, 
            balance: 0, 
            transactions: [] 
          });
          await wallet.save();
        }

        if (wallet.balance < order.totalAmount) {
          return res.status(400).json({ 
            success: false, 
            message: 'Insufficient wallet balance' 
          });
        }

        wallet.balance -= order.totalAmount;
        const transaction = {
          type: 'DEBIT',
          amount: order.totalAmount,
          description: `Payment for order #${order._id.toString().slice(-6).toUpperCase()}`,
          orderId: order._id,
          status: 'COMPLETED',
          createdAt: now,
          balanceAfter: wallet.balance
        };

        wallet.transactions.push(transaction);
        await wallet.save();

        order.paymentMethod = 'Wallet';
        order.paymentStatus = 'Paid';
        order.status = 'Processing';
        order.paymentDetails = {
          method: 'Wallet',
          status: 'Completed',
          amount: order.totalAmount,
          currency: 'INR',
          completedAt: now,
          transactionId: transaction._id
        };
        order.updatedAt = now;

        order.items = order.items.map(item => ({
          ...item.toObject(),
          status: 'Processing',
          updatedAt: now
        }));

        await order.save();

        await Cart.findOneAndUpdate(
          { userId },
          { 
            $set: { 
              items: [], 
              discount: 0, 
              appliedCoupon: null,
              updatedAt: now
            } 
          }
        );

        return res.json({
          success: true,
          orderId: order._id,
          redirect: `/payment-confirmation?orderId=${order._id}`
        });
      }

      if (method && method.toLowerCase() === 'cod') {
        if (order.totalAmount < 1000) {
          console.log('COD not allowed for amount < 1000. User:', userId);
          return res.status(400).json({ 
            success: false, 
            message: 'COD is only available for orders of ₹1000 or more.' 
          });
        }

        order.paymentMethod = 'COD';
        order.paymentStatus = 'Pending';
        order.status = 'Processing';
        order.paymentDetails = {
          method: 'COD',
          status: 'Pending',
          amount: order.totalAmount,
          currency: 'INR',
          createdAt: now
        };
        order.updatedAt = now;

        order.items = order.items.map(item => ({
          ...item.toObject(),
          status: 'Processing',
          updatedAt: now
        }));

        await order.save();

        await Cart.findOneAndUpdate(
          { userId },
          { 
            $set: { 
              items: [], 
              discount: 0, 
              appliedCoupon: null,
              updatedAt: now
            } 
          }
        );

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
    console.error('❗ Error in paymentConfirmation:', error);
    
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

module.exports = {
  paymentMethod,
  createOrder,
  processPayment,
  paymentConfirmation,
  verifyPayment,
  paymentFailure
};