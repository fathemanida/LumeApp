const User = require("../../models/userSchema.js");
const Address = require("../../models/addressSchema.js");
const Cart=require("../../models/cartSchema.js")
const Product=require("../../models/productSchema.js")
const Order=require("../../models/orderSchema.js")
const Coupon = require("../../models/couponSchema.js");
const Wallet = require("../../models/walletSchema.js");
const razorpay = require('../../config/razorpay');
const walletController = require('../../controllers/user/walletController.js');
const { processRefund, calculateRefundAmount } = require('../../services/refundService');
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const router = require("../../routes/userRoutes.js");
const { addRefund } = require('./walletController');

const PDFDocument = require('pdfkit');

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






const orderDetails = async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/login');
        }

        const orderId = req.params.orderId;
        const userId = req.session.user.id;

        const order = await Order.findOne({ _id: orderId, userId })
            .populate({
                path: 'items.productId',
                populate: [
                    { path: 'offer' },
                    { path: 'category', populate: { path: 'categoryOffer' } }
                ]
            })
            .populate('usedCoupon')
            .populate('address')
            .lean();

        if (!order) {
            return res.status(404).render('error', {
                message: 'Order not found',
                error: { status: 404 }
            });
        }

        const formattedItems = order.items.map(item => {
            const product = item.productId;
            const quantity = item.quantity;
            const originalPrice = item.originalPrice || (item.price * quantity);
            const finalPrice = item.finalPrice || item.price * quantity;
            
            return {
                ...item,
                originalPrice,
                finalPrice,
                total: finalPrice,
                productName: product?.productName || 'Product not available',
                image: product?.images?.[0] || '/images/no-image.png'
            };
        });

        const subtotal = formattedItems.reduce((sum, item) => sum + item.originalPrice, 0);
        const totalDiscount = order.offerDiscount + (order.couponDiscount || 0);
        const totalAmount = order.totalAmount || (subtotal - totalDiscount + (order.shipping || 0));

        const formattedOrder = {
            ...order,
            items: formattedItems,
            subtotal,
            totalDiscount,
            totalAmount,
            orderDate: order.createdOn ? new Date(order.createdOn).toLocaleString() : 'N/A',
            paymentStatus: order.paymentStatus || (order.paymentMethod === 'COD' ? 'Pending' : 'Paid')
        };

        res.render('user/order-details', {
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

const orders = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 6;
    const skip = (page - 1) * limit;
    const searchQuery = req.query.search || '';

    let query = { userId };

    if (searchQuery) {
      query.$or = [
        { orderId: { $regex: searchQuery, $options: 'i' } },
        { status: { $regex: searchQuery, $options: 'i' } },
        { 'items.productId.productName': { $regex: searchQuery, $options: 'i' } }
      ];
    }

    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / limit);

    const orders = await Order.find(query)
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate('usedCoupon')
      .populate('address')
      .sort({ createdOn: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedOrders = orders.map(order => {
      let subtotal = 0;
      let formattedItems = order.items.map(item => {
        const product = item.productId;
        const quantity = item.quantity;
        
        const originalPrice = item.originalPrice || (item.price * quantity);
        const offerDiscount = item.appliedOffer ? item.appliedOffer.discountAmount : 0;
        const couponDiscount = item.totalCouponDiscount || 0;
        const finalPrice = item.finalPrice || (originalPrice - offerDiscount - couponDiscount);
        const basePrice = item.price || (product?.salePrice && product.salePrice < product.regularPrice ? product.salePrice : product.regularPrice);
        
        subtotal += originalPrice;
        
        return {
          name: product?.productName || 'Product not available',
          price: basePrice,
          quantity: quantity,
          originalPrice: originalPrice,
          offerDiscount: offerDiscount,
          couponDiscount: couponDiscount,
          total: finalPrice,
          discount: offerDiscount + couponDiscount,
          image: product?.productImage?.[0] || '/images/no-image.png',
          productId: product?._id || null,
          status: item.status || 'Active'
        };
      });
      
      const offerDiscount = typeof order.offerDiscount === 'number' ? order.offerDiscount : 0;
      const couponDiscount = typeof order.couponDiscount === 'number' ? order.couponDiscount : 0;
      const shipping = typeof order.shipping === 'number' ? order.shipping : 0;
      const totalAmount = typeof order.totalAmount === 'number' ? order.totalAmount : (subtotal - offerDiscount - couponDiscount + shipping);
      return {
        _id: order._id,
        orderNumber: order._id.toString().slice(-6).toUpperCase(),
        status: order.status || 'Pending',
        date: order.createdOn ? new Date(order.createdOn).toLocaleString('en-IN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : 'Date not available',
        paymentMethod: order.paymentMethod || 'COD',
        subtotal: subtotal,
        offerDiscount,
        couponDiscount,
        shipping,
        totalAmount,
        items: formattedItems,
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
    });

    res.render('orders', {
      orders: formattedOrders,
      currentPage: page,
      totalPages,
      totalOrders,
      searchQuery,
      user: req.session.user
    });

  } catch (error) {
    console.error('Error in orders:', error);
    res.status(500).render('error', {
      message: 'Error loading orders',
      error: { status: 500 }
    });
  }
};









const cancelOrder = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const userId = req.session.user.id;
        const { reason, notes } = req.body;

        const order = await Order.findOne({ _id: orderId, userId });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
if (!['Processing', 'Active', 'Pending'].includes(order.status)) {
    return res.status(400).json({ 
        success: false, 
        message: `Cannot cancel item with status: ${order.status}` 
    });
}


        let refundAmount = 0;
       if (order.paymentMethod !== 'COD' && 
    (order.paymentMethod === 'Wallet' || order.paymentMethod === 'Razorpay')) {
            refundAmount = (item.finalPrice || item.price) * item.quantity;
        }

        if (refundAmount > 0) {
            await processRefund({
                userId,
                orderId: order._id,
                amount: refundAmount,
                reason: `Order cancellation: ${reason}`,
                notes: notes,
                type: 'CANCEL'
            });
        } else {
            order.status = 'Cancelled';
            order.cancelledAt = new Date();
            order.cancellationReason = reason;
            order.cancellationNotes = notes;
            order.items.forEach(item => {
                item.status = 'Cancelled';
            });
            await order.save();
        }

        res.json({ 
            success: true, 
            message: 'Order cancelled successfully',
            refundProcessed: refundAmount > 0,
            refundAmount
        });

    } catch (error) {
        console.error('Error in cancelOrder:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to cancel order',
            error: error.message
        });
    }
};

const cancelOrderItem = async (req, res) => {
    try {
        console.log('==items cancelling');
        const { orderId, itemId } = req.params;
        const userId = req.session.user.id;
        const { reason, notes } = req.body;

        const order = await Order.findOne({ _id: orderId, userId });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const item = order.items.id(itemId);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found in order' });
        }

        if (!['Processing', 'Active', 'Pending'].includes(item.status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot cancel item with status: ${item.status}` 
            });
        }

        let refundAmount = 0;

        if (
            order.paymentMethod !== 'COD' && 
            (order.paymentMethod === 'Wallet' || order.paymentMethod === 'Razorpay')
        ) {
            refundAmount = (item.finalPrice || item.price) * item.quantity;

            if (order.couponDiscount && order.couponDiscount > 0) {
               const totalItemsCount = order.items.length;
const couponPerItem = order.couponDiscount / totalItemsCount;
const itemCouponDiscount = couponPerItem;

                console.log('=== Adjusted for coupon discount:', itemCouponDiscount, 'Final refund:', refundAmount);
            }

            if (refundAmount > 0) {
                await processRefund({
                    userId,
                    orderId: order._id,
                    itemId: item._id.toString(),
                    amount: refundAmount,
                    reason: `Item cancellation: ${reason}`,
                    notes: notes,
                    type: 'CANCEL'
                });
            }
        }

        item.status = 'Cancelled';
        item.cancelledAt = new Date();
        item.cancellationReason = reason;

        const remainingItems = order.items.filter(i => i.status.toLowerCase() === 'active');
        if (remainingItems.length === 0) {
            order.status = 'Cancelled';
        } else if (remainingItems.length < order.items.length) {
            order.status = 'Partially Cancelled';
        }

        await order.save();

        res.json({ 
            success: true, 
            message: 'Item cancelled successfully',
            refundProcessed: refundAmount > 0,
            refundAmount
        });

    } catch (error) {
        console.error('Error in cancelOrderItem:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to cancel item',
            error: error.message
        });
    }
};


const returnOrder = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const userId = req.session.user.id;
        const { reason, notes } = req.body;

        if (!reason || reason.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Return reason is required' 
            });
        }

        const order = await Order.findOne({ _id: orderId, userId });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.status.toLowerCase() !== 'delivered') {
            return res.status(400).json({ 
                success: false, 
                message: 'Only delivered orders can be returned' 
            });
        }

        let refundAmount = 0;
        if (order.paymentMethod.toLowerCase() !== 'cod' && order.paymentStatus === 'Paid') {
            refundAmount = order.items.reduce((total, item) => {
                if (item.status.toLowerCase() !== 'cancelled') {
                    return total + (item.price * item.quantity);
                }
                return total;
            }, 0);
        }

        order.status = 'Return Requested';
        
        order.returnRequest = {
            requestedAt: new Date(),
            reason: reason,
            notes: notes || '',
            status: 'Pending',
            refundAmount: refundAmount
        };

        order.items.forEach(item => {
            if (item.status.toLowerCase() !== 'cancelled') {
                item.status = 'Return Requested';
                item.returnRequest = {
                    requestedAt: new Date(),
                    reason: reason,
                    notes: notes || '',
                    status: 'Pending',
                    refundAmount: item.price * item.quantity
                };
            }
        });

        order.updatedAt = new Date();
        await order.save();

        res.json({ 
            success: true, 
            message: 'Return request submitted successfully',
            refundAmount: refundAmount,
            orderStatus: order.status
        });

    } catch (error) {
        console.error('Error in returnOrder:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process return request',
            error: error.message
        });
    }
};

const returnOrderItem = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const userId = req.session.user.id;
        const { reason, notes } = req.body;

        const order = await Order.findOne({ _id: orderId, userId });
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }

        const item = order.items.id(itemId);
        if (!item) {
            return res.status(404).json({ 
                success: false, 
                message: 'Item not found in order' 
            });
        }

        if (item.status !== 'Delivered') {
            return res.status(400).json({ 
                success: false, 
                message: 'Only delivered items can be returned' 
            });
        }

        let refundAmount = 0;
        if (order.paymentMethod.toLowerCase() !== 'cod' && order.paymentStatus === 'Paid') {
            refundAmount = (item.finalPrice || item.price) * item.quantity;
        }

        item.status = 'Return Requested';
        item.returnRequest = {
            requestedAt: new Date(),
            reason: reason,
            notes: notes,
            status: 'Pending',
            refundAmount: refundAmount
        };

        const hasOtherItems = order.items.some(i => 
            i._id.toString() !== itemId && 
            i.status !== 'Return Requested' && 
            i.status !== 'Returned' &&
            i.status !== 'Cancelled'
        );

        if (hasOtherItems) {
            order.status = 'Partially Returned';
        } else {
            order.status = 'Return Requested';
        }

        await order.save();
        console.log('Order updated with return status:', { 
            orderId, 
            newStatus: order.status,
            itemId,
            itemStatus: item.status 
        });

        if (refundAmount > 0) {
            try {
                console.log('Processing refund for item:', { itemId, refundAmount });
                
                let wallet = await Wallet.findOne({ userId });
                if (!wallet) {
                    console.log('Creating new wallet for user:', userId);
                    wallet = new Wallet({ 
                        userId, 
                        balance: 0,
                        transactions: []
                    });
                }

                const transaction = {
                    type: 'CREDIT',
                    amount: refundAmount,
                    description: `Refund for item return: ${item.productName || 'Product'} (${item.quantity} x ₹${item.finalPrice || item.price})`,
                    orderId: order._id.toString(),
                    itemId: item._id.toString(),
                    status: 'COMPLETED',
                    date: new Date()
                };

                wallet.balance += refundAmount;
                wallet.transactions.push(transaction);
                await wallet.save();
                console.log('Wallet updated with refund:', { 
                    userId, 
                    newBalance: wallet.balance,
                    refundAmount 
                });

                await User.findByIdAndUpdate(
                    userId, 
                    { $set: { wallet: wallet._id } }, 
                    { upsert: true }
                );

                console.log(`Refund of ₹${refundAmount} processed successfully for returned item ${itemId} in order ${orderId}`);
            } catch (walletError) {
                console.error('Error processing wallet refund:', {
                    error: walletError.message,
                    stack: walletError.stack,
                    orderId,
                    itemId,
                    userId,
                    refundAmount
                });
            }
        }

        try {
            console.log('Updating product inventory for item:', { 
                itemId, 
                productId: item.productId,
                quantity: item.quantity 
            });
            
            const product = await Product.findById(item.productId);
            if (!product) {
                console.error('Product not found during return:', item.productId);
                throw new Error(`Product ${item.productId} not found`);
            }
            
            const currentQuantity = product.quantity || 0;
            const newQuantity = currentQuantity + item.quantity;
            
            product.quantity = newQuantity;
            product.status = newQuantity > 0 ? 'Available' : 'Out of Stock';
            
            await product.save();
            
            console.log('Product inventory updated successfully:', {
                productId: product._id,
                oldQuantity: currentQuantity,
                newQuantity: newQuantity,
                newStatus: product.status
            });
            
        } catch (productError) {
            console.error('Error updating product inventory during return:', {
                error: productError.message,
                stack: productError.stack,
                orderId,
                itemId,
                productId: item.productId,
                quantity: item.quantity
            });
        }

        const response = { 
            success: true, 
            message: 'Return request submitted successfully',
            refundProcessed: refundAmount > 0,
            refundAmount
        };
        
        console.log('Return process completed successfully:', response);
        res.json(response);

    } catch (error) {
        console.error('Error in returnOrderItem:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process return request',
            error: error.message
        });
    }
};

const returnRequest = async (req, res) => {
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

        const orderItems = order.items.map(
          item => item.productId.toString()
        );
        const invalidItems = items.filter(itemId =>
           !orderItems.includes(itemId)
          );
        
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
                const orderItem = order.items.find(item => item.productId.toString() === itemId);
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

const downloadInvoice = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const userId = req.session.user.id;

    const order = await Order.findOne({ _id: orderId, userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate('address')
      .populate('userId')
      .populate('usedCoupon');

    if (!order) {
      return res.status(404).send('Order not found');
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.registerFont('Aboreto', 'public/fonts/Aboreto-Regular.ttf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.orderId}.pdf`);
    doc.pipe(res);

    let subtotal = 0;
    let offerDiscountTotal = 0;
    let couponDiscount = 0;

    order.items.forEach(item => {
      const product = item.productId;
      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice ? product.salePrice : product.regularPrice;
      const originalPrice = basePrice * quantity;
      subtotal += originalPrice;

      let productOfferDiscount = 0;
      if (product.offer?.isActive) {
        productOfferDiscount = product.offer.discountType === 'percentage'
          ? (originalPrice * product.offer.discountValue) / 100
          : product.offer.discountValue * quantity;
      }
      let categoryOfferDiscount = 0;
      if (product.category?.categoryOffer?.active) {
        categoryOfferDiscount = product.category.categoryOffer.discountType === 'percentage'
          ? (originalPrice * product.category.categoryOffer.discountValue) / 100
          : product.category.categoryOffer.discountValue * quantity;
      }
      const bestOfferDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);
      offerDiscountTotal += bestOfferDiscount;

      item._productName = product.productName;
      item._finalUnitPrice = (originalPrice - bestOfferDiscount) / quantity;
      item._total = originalPrice - bestOfferDiscount;
    });

    const offerDiscount = typeof order.offerDiscount === 'number' ? order.offerDiscount : offerDiscountTotal;
    couponDiscount = typeof order.couponDiscount === 'number' ? order.couponDiscount : 0;
    const shipping = typeof order.shipping === 'number' ? order.shipping : 0;
    const finalAmount = typeof order.totalAmount === 'number' ? order.totalAmount : (subtotal - offerDiscount - couponDiscount + shipping);

    const pageTop = 40;
    const pageBottom = doc.page.height - 40;
    const col1 = 45;
    const col2 = 280;
    const col3 = 350;
    const col4 = 420;
    const col5 = 490;

    doc.font('Helvetica-Bold').fontSize(24).fillColor('#333').text('INVOICE', pageTop, pageTop);
    doc.font('Aboreto').fontSize(20).fillColor('#c5a267').text('LEMO', pageTop, pageTop, { align: 'right' });
    doc.moveDown(1.5);
    const headerY = doc.y;
    doc.font('Helvetica').fontSize(11).fillColor('#555');
    doc.text(`Invoice #: ${order.orderId}`, col1, headerY);
    doc.text(`Date: ${order.createdOn.toLocaleDateString()}`, col1, headerY, { align: 'right' });
    doc.moveDown(2);

    const addressY = doc.y;
    doc.font('Helvetica-Bold').fillColor('#333').text('Bill To & Ship To:', col1, addressY);
    doc.font('Helvetica').fillColor('#555')
      .text(`${order.address.name}`, col1, doc.y)
      .text(`${order.address.houseNo}, ${order.address.roadArea}`)
      .text(`${order.address.city}, ${order.address.state} - ${order.address.pincode}`)
      .text(`${order.address.phone}`);

    doc.moveDown(3);
    const tableTop = doc.y;
    doc.rect(col1 - 5, tableTop, 515, 25).fill('#f2f2f2');
    doc.font('Helvetica-Bold').fillColor('#555').fontSize(11);
    doc.text('Product', col1, tableTop + 7);
    doc.text('Quantity', col2, tableTop + 7, { width: 60, align: 'right' });
    doc.text('Unit Price', col3, tableTop + 7, { width: 60, align: 'right' });
    doc.text('Total', col4, tableTop + 7, { width: 70, align: 'right' });

    let y = tableTop + 35;
    doc.font('Helvetica').fontSize(11).fillColor('#333');
    order.items.forEach(item => {
      doc.text(item._productName, col1, y, { width: 230 });
      doc.text(item.quantity.toString(), col2, y, { width: 60, align: 'right' });
      doc.text(`Rs.${item._finalUnitPrice.toFixed(2)}`, col3, y, { width: 60, align: 'right' });
      doc.text(`Rs.${item._total.toFixed(2)}`, col4, y, { width: 70, align: 'right' });
      y += 25;
      doc.moveTo(col1 - 5, y - 5).lineTo(col1 - 5 + 515, y - 5).lineWidth(0.5).strokeColor('#e0e0e0').stroke();
    });

    doc.font('Helvetica').fontSize(11).fillColor('#555');
    const summaryY = y + 10;
    const lineGap = 10;
    doc.text('Subtotal:', col4 - 70, summaryY, { width: 80, align: 'left' });
    doc.text(`Rs.${subtotal.toFixed(2)}`, col5 - 50, summaryY, { width: 60, align: 'right' });
    doc.text('Offer Discount:', col4 - 70, summaryY + 20, { width: 80, align: 'left' });
    doc.text(`-Rs.${offerDiscount.toFixed(2)}`, col5 - 50, summaryY + 20, { width: 60, align: 'right' });
    doc.text('Coupon Discount:', col4 - 70, summaryY + 40, { width: 80, align: 'left' });
    doc.text(`-Rs.${couponDiscount.toFixed(2)}`, col5 - 50, summaryY + 40, { width: 60, align: 'right' });
    doc.text('Shipping:', col4 - 70, summaryY + 60 + lineGap, { width: 80, align: 'left' });
    doc.text(`Rs.${shipping.toFixed(2)}`, col5 - 50, summaryY + 60 + lineGap, { width: 60, align: 'right' });

    doc.moveTo(col4 - 75, summaryY + 80 + lineGap).lineTo(col5 + 10, summaryY + 80 + lineGap).lineWidth(1).strokeColor('#555').stroke();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#333');
    doc.text('Total:', col4 - 70, summaryY + 85 + lineGap, { width: 80, align: 'left' });
    doc.fillColor('#c5a267').text(`Rs.${finalAmount.toFixed(2)}`, col5 - 50, summaryY + 85 + lineGap, { width: 65, align: 'right' });

    doc.font('Helvetica').fontSize(10).fillColor('#888').text('Thank you for shopping with us!', col1, pageBottom - 20, { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).send('Error generating invoice');
  }
};




// const cancelOrder = async (req, res) => {
//   try {
//     const { orderId } = req.params;
//     const userId = req.session.user.id;
//     const reason = req.body.reason || 'Customer request';

//     const order = await Order.findOne({ _id: orderId, userId })
//       .populate('items.productId')
//       .populate('address');
      
//     if (!order) {
//       return res.status(404).json({ success: false, message: 'Order not found' });
//     }

//     if (!['Pending', 'Processing'].includes(order.status)) {
//       return res.status(400).json({ 
//         success: false, 
//         message: `Cannot cancel order with status: ${order.status}` 
//       });
//     }

//     if (order.paymentMethod !== 'COD' && order.paymentStatus === 'Paid') {
//       try {
//         const refundAmount = order.items.reduce((total, item) => {
//           return total + ((item.finalPrice !== undefined ? item.finalPrice : item.price) * item.quantity);
//         }, 0);

//         if (refundAmount > 0) {
//           let wallet = await Wallet.findOne({ userId });
//           if (!wallet) {
//             wallet = new Wallet({ 
//               userId, 
//               balance: 0, 
//               transactions: [] 
//             });
//           }

//           const transaction = {
//             type: 'CREDIT',
//             amount: refundAmount,
//             description: `Refund for cancelled order: ${order._id}`,
//             orderId: order._id,
//             status: 'COMPLETED',
//             createdAt: new Date(),
//             refundBreakdown: {
//               refundAmount,
//               orderTotal: order.totalAmount,
//               refundReason: reason,
//               cancelledAt: new Date()
//             }
//           };

//           wallet.balance = Number((wallet.balance + refundAmount).toFixed(2));
//           wallet.transactions.push(transaction);
//           await wallet.save();
//         }
//       } catch (error) {
//         console.error('Error processing refund for cancelled order:', error);
//         return res.status(500).json({ 
//           success: false, 
//           message: 'Error processing refund. Please contact support.' 
//         });
//       }
//     }

//     order.status = 'Cancelled';
//     order.cancelledAt = new Date();
//     order.cancellationReason = reason;
    
//     for (const item of order.items) {
//       if (item.status === 'Active') {
//         item.status = 'Cancelled';
//         item.updatedAt = new Date();
        
//         if (item.productId) {
//           await Product.findByIdAndUpdate(item.productId._id, {
//             $inc: { quantity: item.quantity }
//           });
//         }
//       }
//     }

//     await order.save();
    
//     res.status(200).json({ 
//       success: true, 
//       message: 'Order cancelled successfully',
//       orderId: order._id
//     });

//   } catch (error) {
//     console.error('Error in cancelOrder:', error);
//     res.status(500).json({ 
//       success: false, 
//       message: 'Internal server error' 
//     });
//   }
// };

// const cancelOrderItem = async (req, res) => {
//   try {
//     const { orderId, itemId } = req.params;
//     const userId = req.session?.user?.id;
//     const reason = req.body?.reason || 'Customer request';

//     // Input validation
//     if (!userId) {
//       return res.status(401).json({ success: false, message: 'User not authenticated' });
//     }

//     if (!orderId || !itemId) {
//       return res.status(400).json({ success: false, message: 'Missing orderId or itemId' });
//     }

//     // Find and validate order
//     const order = await Order.findOne({ _id: orderId, userId })
//       .populate('items.productId')
//       .populate('address');
      
//     if (!order) {
//       return res.status(404).json({ success: false, message: 'Order not found' });
//     }

//     // Find the item to cancel
//     const item = order.items.find(i => i._id.toString() === itemId);
    
//     if (!item) {
//       return res.status(404).json({ 
//         success: false, 
//         message: 'Item not found in this order' 
//       });
//     }

//     // Check if item is already cancelled
//     if (item.status !== 'Active') {
//       return res.status(400).json({ 
//         success: false, 
//         message: `Item is already ${item.status.toLowerCase()}` 
//       });
//     }

//     // Check if order status allows cancellation
//     if (!['Pending', 'Processing'].includes(order.status)) {
//       return res.status(400).json({ 
//         success: false, 
//         message: `Cannot cancel item for order with status: ${order.status}` 
//       });
//     }

//     // Calculate refund amount (use finalPrice if available, otherwise use price)
//     const refundAmount = (item.finalPrice !== undefined ? item.finalPrice : item.price) * item.quantity;
    
//     // Process refund if payment was made
//     if (order.paymentMethod !== 'COD' && order.paymentStatus === 'Paid' && refundAmount > 0) {
//       try {
//         // Find or create wallet
//         let wallet = await Wallet.findOne({ userId });
//         if (!wallet) {
//           wallet = new Wallet({ 
//             userId, 
//             balance: 0, 
//             transactions: [] 
//           });
//         }

//         // Create transaction record
//         const transaction = {
//           type: 'CREDIT',
//           amount: refundAmount,
//           description: `Refund for cancelled item: ${item.productId?.productName || 'Unknown Product'} (Qty: ${item.quantity})`,
//           orderId: order._id,
//           itemId: item._id,
//           status: 'COMPLETED',
//           createdAt: new Date(),
//           refundBreakdown: {
//             refundAmount: refundAmount,
//             originalPrice: item.price,
//             finalPrice: item.finalPrice !== undefined ? item.finalPrice : item.price,
//             quantity: item.quantity,
//             refundReason: reason,
//             cancelledAt: new Date(),
//             appliedDiscount: item.appliedOffer ? {
//               type: item.appliedOffer.discountType,
//               value: item.appliedOffer.discountValue,
//               amount: item.appliedOffer.discountAmount
//             } : null
//           }
//         };

//         // Save wallet with new transaction
//         wallet.balance = Number((wallet.balance + refundAmount).toFixed(2));
//         wallet.transactions.push(transaction);
//         await wallet.save();

//         console.log(`Refund of ${refundAmount} processed for item ${itemId}`);
//       } catch (error) {
//         console.error('Error processing refund:', error);
//         return res.status(500).json({ 
//           success: false, 
//           message: 'Error processing refund. Please contact support.' 
//         });
//       }
//     }

//     // Update item status
//     item.status = 'Cancelled';
//     item.cancelledAt = new Date();
//     item.cancellationReason = reason;
//     item.updatedAt = new Date();
    
//     // Restore product stock
//     if (item.productId?._id) {
//       await Product.findByIdAndUpdate(item.productId._id, {
//         $inc: { quantity: item.quantity }
//       });
//     }

//     // Check if all items are cancelled
//     const activeItems = order.items.filter(i => i.status === 'Active');
    
//     // Update order status based on remaining items
//     if (activeItems.length === 0) {
//       order.status = 'Cancelled';
//       order.cancelledAt = new Date();
//       order.cancellationReason = 'All items cancelled';
//     } else if (activeItems.length < order.items.length) {
//       order.status = 'Partially Cancelled';
//     }

//     order.updatedAt = new Date();
//     await order.save();

//     // Send success response
//     res.status(200).json({ 
//       success: true, 
//       message: 'Item cancelled successfully',
//       orderId: order._id,
//       itemId: item._id,
//       refundAmount: refundAmount,
//       orderStatus: order.status
//     });
//   } catch (error) {
//     console.error('Error in cancelOrderItem:', {
//       error: error.message,
//       stack: error.stack,
//       params: req.params,
//       body: req.body,
//       userId: req.session?.user?.id
//     });
    
//     res.status(500).json({ 
//       success: false, 
//       message: 'Internal server error',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined
//     });
//   }
// };

module.exports = { 
  orders, 
  orderDetails, 
  cancelOrder, 
  cancelOrderItem, 
  returnOrder, 
  returnOrderItem, 
  returnRequest, 
  downloadInvoice 
};