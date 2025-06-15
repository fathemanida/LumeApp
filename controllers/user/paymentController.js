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

const Razorpay = require('razorpay');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
  test_mode: true
});

const createOrder = async (req, res) => {
  try {
    const { amount, addressId } = req.body;
    console.log('Create Order Request:', { amount, addressId, userId: req.session.user.id });

    if (!amount) {
      return res.status(400).json({ success: false, message: 'Amount is required' });
    }

    if (!addressId) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }

    const address = await Address.findOne({ _id: addressId, userId: req.session.user.id });
    if (!address) {
      return res.status(400).json({ success: false, message: 'Invalid address' });
    }

    // Get cart data to include items in order
    const cartData = await Cart.findOne({ userId: req.session.user.id })
      .populate({
        path: 'items.productId',
        select: 'productName productImage regularPrice salePrice quantity'
      });

    if (!cartData || !cartData.items || cartData.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const totalItemPrice = cartData.items.reduce((sum, item) => sum + item.totalPrice, 0);
    const shipping = totalItemPrice > 3000 ? 0 : 40;
    const taxRate = totalItemPrice > 3000 ? 0.04 : 0.02;
    const tax = totalItemPrice * taxRate;
    const discount = cartData.discount || 0;
    const total = totalItemPrice + shipping + tax - discount;

    const order = new Order({
      userId: req.session.user.id,
      status: 'Pending',
      paymentMethod: 'Razorpay',
      orderItems: cartData.items.map(item => ({
        productId: item.productId._id,
        quantity: item.quantity,
        price: item.totalPrice
      })),
      totalPrice: totalItemPrice,
      finalAmount: total,
      shipping,
      tax,
      discount,
      address: addressId
    });

    console.log('Creating order:', order);

    await order.save();
    console.log('Order saved:', order._id);

    const amountInPaise = Math.round(total * 100);
    console.log('Amount in paise:', amountInPaise);

    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: order._id.toString(),
      payment_capture: 1 
    };

    console.log('Creating Razorpay order with options:', options);

    const razorpayOrder = await razorpay.orders.create(options);
    console.log('Razorpay order created:', razorpayOrder.id);

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();
    console.log('Order updated with Razorpay ID');

    return res.status(200).json({
      success: true,
      orderId: order._id,
      razorpayOrderId: razorpayOrder.id,
      currency: razorpayOrder.currency,
      amount: razorpayOrder.amount
    });

  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Something went wrong',
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
    const addressId = req.query.addressId;

    console.log('Payment Method - User ID:', userId);
    console.log('Payment Method - Address ID:', addressId);

    if (!addressId) {
      console.log('No address ID provided');
      return res.redirect('/checkout');
    }

    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) {
      console.log('Address not found or does not belong to user');
      return res.redirect('/checkout');
    }

    console.log('Finding cart for user:', userId);
    const cartData = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        select: 'productName productImage regularPrice salePrice quantity'
      });

    console.log('Cart Data:', JSON.stringify(cartData, null, 2));

    if (!cartData) {
      console.log('No cart found for user');
      return res.redirect('/cart');
    }

    if (!cartData.items || cartData.items.length === 0) {
      console.log('Cart is empty');
      return res.redirect('/cart');
    }

    const itemList = cartData.items.map(item => ({
      productId: {
        _id: item.productId._id,
        productName: item.productId.productName,
        productImage: item.productId.productImage,
        regularPrice: item.productId.regularPrice,
        salePrice: item.productId.salePrice
      },
      quantity: item.quantity,
      totalPrice: item.totalPrice
    }));

    const totalItemPrice = cartData.items.reduce((total, item) => total + item.totalPrice, 0);
    const shipping = 40;
    const taxRate = totalItemPrice > 3000 ? 0.04 : 0.02;
    const tax = totalItemPrice * taxRate;
    const discount = cartData.discount || 0;
    const totalPrice = totalItemPrice + tax + shipping - discount;
    const subtotal = totalPrice - (tax + shipping);

    const processedCart = {
      items: itemList,
      subtotal,
      shipping,
      tax,
      discount,
      totalPrice
    };

    console.log('Processed Cart:', JSON.stringify(processedCart, null, 2));

    res.render('payment', {
      user: req.session.user,
      cart: processedCart,
      address: address,
      RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error('Error in paymentMethod:', error);
    res.status(500).render('error', { message: 'Something went wrong' });
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
      });
    }

    // Find order by our MongoDB order ID
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    console.log('Found order:', {
      orderId: order._id,
      razorpayOrderId: order.razorpayOrderId,
      receivedRazorpayOrderId: razorpay_order_id
    });

    // Verify that the Razorpay order ID matches
    if (order.razorpayOrderId !== razorpay_order_id) {
      console.error('Order ID mismatch:', {
        stored: order.razorpayOrderId,
        received: razorpay_order_id
      });
      return res.status(400).json({
        success: false,
        message: 'Order ID mismatch',
      });
    }

    order.paymentStatus = 'Paid';
    order.paymentMethod = 'Razorpay';
    order.razorpay = {
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      signature: razorpay_signature,
    };
    order.addressId = addressId;
    order.status = 'Processing';
    await order.save();

    console.log('Order updated successfully:', order._id);

    if (req.session.user) {
      await Cart.findOneAndUpdate(
        { userId: req.session.user.id },
        { $set: { items: [], discount: 0 } }
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

    const cartData = await Cart.findOne({ userId }).populate({
      path: 'items.productId',
      select: 'productName productImage regularPrice salePrice quantity'
    });

    if (!cartData || !cartData.items || cartData.items.length === 0) {
      console.log('Cart is empty or not found');
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const userAddress = await Address.findOne({ _id: addressId, userId });

    if (!userAddress) {
      return res.status(400).json({ 
        success: false, 
        message: 'No address found. Please add an address in checkout.',
        redirect: '/checkout'
      });
    }

    const totalItemPrice = cartData.items.reduce((sum, item) => sum + item.totalPrice, 0);
    const shipping = totalItemPrice > 3000 ? 0 : 40;
    const taxRate = totalItemPrice > 3000 ? 0.04 : 0.02;
    const tax = totalItemPrice * taxRate;
    const discount = cartData.discount || 0;
    const total = totalItemPrice + shipping + tax - discount;

    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);

    const order = new Order({
      userId,
      orderItems: cartData.items.map(item => ({
        productId: item.productId._id,
        quantity: item.quantity,
        price: item.totalPrice
      })),
      address: userAddress._id,
      totalPrice: totalItemPrice,
      finalAmount: total,
      discount,
      shipping,
      tax,
      paymentMethod: method.toUpperCase(),
      status: 'Pending',
      estimatedDelivery
    });

    console.log('Creating order:', order);

    await order.save();

    await Cart.findOneAndUpdate(
      { userId },
      { $set: { items: [], discount: 0 } }
    );

    console.log('Order created successfully:', order._id);

    res.json({ 
      success: true, 
      orderId: order._id,
      redirect: `/payment-confirmation?orderId=${order._id}`
    });

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
    const orderId = req.query.orderId;
    
    console.log('Payment Confirmation - Order ID:', orderId);
    console.log('Payment Confirmation - User ID:', userId);

    const order = await Order.findOne({ 
      _id: orderId,
      userId 
    })
      .populate({
        path: 'orderItems.productId',
        model: 'Product',
        select: 'productName productImage regularPrice salePrice quantity'
      })
      .populate({
        path: 'address',
        select: 'name houseNo roadArea city state pincode phone'
      })
      .lean();

    if (!order) {
      console.log('Order not found');
      return res.redirect('/orders');
    }

    console.log('Order found:', order);

    const formattedOrder = {
      orderNumber: order._id.toString().slice(-6).toUpperCase(),
      totalAmount: order.totalPrice,
      paymentMethod: order.paymentMethod,
      address: order.address,
      items: order.orderItems.map(item => ({
        name: item.productId.productName,
        quantity: item.quantity,
        price: item.price
      }))
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

module.exports = {
  paymentMethod,
  createOrder,
  processPayment,
  paymentConfirmation,
  verifyPayment
};