const User = require("../../models/userSchema.js");
const Address = require("../../models/addressSchema.js");
const Cart=require("../../models/cartSchema.js")
const Product=require("../../models/productSchema.js")
const Order=require("../../models/orderSchema.js")
const razorpay = require('../../config/razorpay');
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const router = require("../../routes/userRoutes.js");
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





const orders = async (req, res) => {
    try {
        if (!req.session.user) {
            console.log('No user session found');
            return res.redirect('/login');
        }

        const userId = req.session.user.id;
        console.log('Fetching orders for user:', userId);

        const page = parseInt(req.query.page) || 1;
        const limit = 6;
        const skip = (page - 1) * limit;
        const searchQuery = req.query.search || '';

        let query = { userId: userId };
        console.log('Query:', query);
        
        if (searchQuery) {
            query.$or = [
                { orderId: { $regex: searchQuery, $options: 'i' } },
                { status: { $regex: searchQuery, $options: 'i' } },
                { 'orderItems.productId.productName': { $regex: searchQuery, $options: 'i' } }
            ];
        }

        const totalOrders = await Order.countDocuments(query);
        console.log('Total orders found:', totalOrders);

        const totalPages = Math.ceil(totalOrders / limit);

        const orders = await Order.find(query)
            .sort({ createdOn: -1 })
            .skip(skip)
            .limit(limit)
            .populate({
                path: 'orderItems.productId',
                model: 'Product',
                select: 'productName productImage regularPrice salePrice'
            })
            .lean();


        const formattedOrders = orders.map(order => ({
            _id: order._id,
            orderNumber: order.orderId || order._id.toString().slice(-6).toUpperCase(),
            createdOn: order.createdOn,
            totalAmount: order.totalPrice,
            status: order.status || 'Pending',
            items: order.orderItems.map(item => ({
                name: item.productId?.productName || 'Product deleted',
                quantity: item.quantity,
                price: item.price,
                image: item.productId?.productImage?.[0] 
                    ? `/uploads/product/${item.productId.productImage[0]}` 
                    : '/images/placeholder.png'
            })),
            returnRequest: order.returnRequest
        }));

       

        res.render('orders', {
            orders: formattedOrders,
            currentPage: page,
            totalPages,
            totalOrders,
            searchQuery,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error in orders', error);
       
    }
};
// const razorpayPayment=async (req,res) => 
//   {
  
//   const { amount } = req.body;

//   const options = {
//     amount: amount * 100, 
//     currency: 'INR',
//     receipt: 'order_rcptid_11',
//     payment_capture: 1
//   };

//   try {
//     const response = await razorpay.orders.create(options);
//     res.status(200).json(response);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Order creation failed' });
//   }


// }







const orderDetails = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const orderId = req.params.orderId;
    const userId = req.session.user.id;

    const order = await Order.findOne({ _id: orderId, userId: userId })
      .populate({
        path: 'orderItems.productId',
        model: 'Product',
        select: 'productName productImage regularPrice salePrice quantity'
      })
      .populate({
        path: 'address',
        select: 'name houseNo roadArea city state pincode phone'
      });

    if (!order) {
      return res.status(404).render('error', {
        message: 'Order not found',
        error: { status: 404 }
      });
    }


    const itemsTotal = order.orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

const totalPrice = order.totalPrice || itemsTotal;
console.log('itemsTotal',itemsTotal,"totlPrice:",totalPrice);

const shipping = totalPrice > 3000 ? 0 : 50;
const taxRate = totalPrice > 3000 ? 0.04 : 0.02;
const subtotal = parseFloat((totalPrice - taxRate - shipping).toFixed(2));

const formattedOrder = {
      _id: order._id,
      orderNumber: order._id.toString().slice(-6).toUpperCase(),
      status: order.status || 'Pending',
      date: order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) : 'Date not available',
      paymentMethod: order.paymentMethod || 'COD',

      itemsTotal: itemsTotal,
  subtotal: subtotal,
  shipping: shipping,
  tax: taxRate,
  discount: order.discount || 0,
  total: totalPrice,
      items: order.orderItems.map(item => ({
        name: item.productId ? item.productId.productName : 'Product not available',
        price: item.price,
        quantity: item.quantity,
        total: item.price * item.quantity,
        image: item.productId ? `/Uploads/product/${item.productId.productImage[0]}` : '/images/no-image.png',
        productId: item.productId ? item.productId._id : null
      })),

      address: order.address ? {
        name: order.address.name,
        houseNo: order.address.houseNo,
        roadArea: order.address.roadArea,
        city: order.address.city,
        state: order.address.state,
        pincode: order.address.pincode,
        phone: order.address.phone
      } : null
    };


    res.render('orderDetails', {
      order: formattedOrder,
      user: req.session.user
    });

  } catch (error) {
    console.error('Error in orderDetails:', error);
    res.status(500).render('error', {
      message: 'Error loading order details',
      error: { status: 500 }
    });
  }
};



const cancelOrder = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const order = await Order.findOne({ _id: orderId, userId: req.session.user_id });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.status === 'DELIVERED') {
            return res.status(400).json({ success: false, message: 'Cannot cancel delivered order' });
        }

        if (order.status === 'CANCELLED') {
            return res.status(400).json({ success: false, message: 'Order is already cancelled' });
        }

        // Add refund to wallet
        const walletController = require('./walletController');
        await walletController.addRefund(req, res);

        // Update order status
        order.status = 'CANCELLED';
        await order.save();

        res.json({ success: true, message: 'Order cancelled successfully' });
    } catch (error) {
        console.error('Error in cancelOrder:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

const returnOrder = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const order = await Order.findOne({ _id: orderId, userId: req.session.user_id });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.status !== 'DELIVERED') {
            return res.status(400).json({ success: false, message: 'Only delivered orders can be returned' });
        }

        if (order.status === 'RETURNED') {
            return res.status(400).json({ success: false, message: 'Order is already returned' });
        }

        // Add refund to wallet
        const walletController = require('./walletController');
        await walletController.addRefund(req, res);

        // Update order status
        order.status = 'RETURNED';
        await order.save();

        res.json({ success: true, message: 'Order returned successfully' });
    } catch (error) {
        console.error('Error in returnOrder:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

const submitReturnRequest = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const userId = req.session.user.id;
        const { reason, description, items } = req.body;

        const order = await Order.findOne({ _id: orderId, userId });
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

       

        if (order.status !== 'Delivered') {
            return res.status(400).json({
                success: false,
                message: 'Return requests can only be submitted for delivered orders'
            });
        }

        if (order.returnRequest) {
            console.log('Return request already exists:', {
                status: order.returnRequest.status,
                requestedAt: order.returnRequest.requestedAt
            });
            return res.status(400).json({
                success: false,
                message: 'A return request already exists for this order'
            });
        }

        const orderItems = order.orderItems.map(item => item.productId.toString());
        const invalidItems = items.filter(itemId => !orderItems.includes(itemId));
        
        if (invalidItems.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid items selected for return'
            });
        }

        const returnRequest = {
            requestedAt: new Date(),
            reason,
            description,
            items: items.map(itemId => {
                const orderItem = order.orderItems.find(item => item.productId.toString() === itemId);
                return {
                    productId: itemId,
                    quantity: orderItem.quantity
                };
            }),
            status: 'Pending'
        };

        order.status = 'Return Requested';
        order.returnRequest = returnRequest;

       

        await order.save();


        res.json({
            success: true,
            message: 'Return request submitted successfully'
        });

    } catch (error) {
        console.error('Error in submitReturnRequest:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit return request'
        });
    }
};

module.exports = {
  orders,
  orderDetails,
  cancelOrder,
  returnOrder,
  submitReturnRequest,

};