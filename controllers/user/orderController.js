const User = require("../../models/userSchema.js");
const Address = require("../../models/addressSchema.js");
const Cart=require("../../models/cartSchema.js")
const Product=require("../../models/productSchema.js")
const Order=require("../../models/orderSchema.js")
const razorpay = require('../../config/razorpay');
const walletController=require('../../controllers/user/walletController.js')
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const router = require("../../routes/userRoutes.js");
const { addRefund } = require('./walletController');
const Wallet = require("../../models/walletSchema.js");
const calculateCartTotals = require('../../helpers/calculateTotal');

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
        let basePrice = 0;
        let finalPrice = 0;
        let discount = 0;
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
          discount: 0,
          image: product?.productImage?.[0] || '/images/no-image.png',
          productId: product?._id || null
        };
      });
      const offerDiscount = typeof order.offerDiscount === 'number' ? order.offerDiscount : 0;
      const couponDiscount = typeof order.couponDiscount === 'number' ? order.couponDiscount : 0;
      const shipping = typeof order.shipping === 'number' ? order.shipping : (subtotal >= 1500 ? 0 : 40);
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
        ],
        select: 'productName productImage regularPrice salePrice quantity offer category'
      })
      .populate('address')
      .populate('usedCoupon')
      .lean();

    if (!order) {
      return res.status(404).render('error', {
        message: 'Order not found',
        error: { status: 404 }
      });
    }

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
        discount: 0, 
        image: product?.productImage?.[0] || '/images/no-image.png',
        productId: product?._id || null
      };
    });
    const offerDiscount = typeof order.offerDiscount === 'number' ? order.offerDiscount : 0;
    const couponDiscount = typeof order.couponDiscount === 'number' ? order.couponDiscount : 0;
    const shipping = typeof order.shipping === 'number' ? order.shipping : (subtotal >= 1500 ? 0 : 40);
    const totalAmount = typeof order.totalAmount === 'number' ? order.totalAmount : (subtotal - offerDiscount - couponDiscount + shipping);

    const formattedOrder = {
      _id: order._id,
      orderNumber: order._id.toString().slice(-6).toUpperCase(),
      status: order.status || 'Pending',
      date: order.createdOn,
      paymentMethod: order.paymentMethod || 'COD',
      subtotal: subtotal,
      shipping: shipping,
      offerDiscount: offerDiscount,
      couponDiscount: couponDiscount,
      totalAmount: totalAmount,
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
        const userId = req.session.user.id;

        const order = await Order.findOne({ _id: orderId, userId }).populate('items.productId');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        
        if (order.status === 'Delivered') {
            return res.status(400).json({ success: false, message: 'Cannot cancel a delivered order.' });
        }
        
        if (order.status === 'Shipped') {
          return res.status(400).json({success:false,message:'Cannot cancel, order has already been shipped.'})
        }

        if (order.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Order is already cancelled' });
        }

        if (order.paymentMethod !== 'COD' && order.totalAmount > 0) {
            let wallet = await Wallet.findOne({ userId });
            if (!wallet) {
                wallet = new Wallet({ userId, balance: 0, transactions: [] });
            }

            wallet.balance += order.totalAmount;
            wallet.transactions.push({
                type: 'CREDIT',
                amount: order.totalAmount,
                description: `Refund for cancelled order #${order.orderId}`,
                orderId: order._id,
            });
            await wallet.save();
        }

        for (const item of order.items) {
            const product = item.productId;
            if (product) {
                const newStock = product.quantity + item.quantity;
                await Product.findByIdAndUpdate(product._id, {
                    quantity: newStock,
                    status: newStock > 0 ? 'Available' : 'Out of Stock'
                });
            }
        }

        order.status = 'Cancelled';
        await order.save();

        return res.status(200).json({ success: true, message: 'Order cancelled successfully' });

    } catch (err) {
        console.error('Error in cancelOrder:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
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

        await walletController.addRefund(req, res);

        order.status = 'RETURNED';
        await order.save();

        res.json({ success: true, message: 'Order returned successfully' });
    } catch (error) {
        console.error('Error in returnOrder:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
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


const cancelOrderItem = async (req, res) => {
  try {
    const { orderId, itemId } = req.params;
    const userId = req.session.user.id;
    const reason = req.body.reason || '';

    const order = await Order.findOne({ _id: orderId, userId }).populate('items.productId');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const item = order.items.find(i => i.productId && i.productId._id.toString() === itemId && i.status !== 'Cancelled');
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found or already cancelled' });
    }

    if (['Delivered', 'Cancelled', 'Returned'].includes(order.status)) {
      return res.status(400).json({ success: false, message: 'Cannot cancel item at this stage.' });
    }

    item.status = 'Cancelled';
    if (item.productId) {
      await Product.findByIdAndUpdate(item.productId._id, {
        $inc: { quantity: item.quantity }
      });
    }

    if (order.paymentMethod !== 'COD' && item.price > 0) {
      let wallet = await Wallet.findOne({ userId });
      if (!wallet) {
        wallet = new Wallet({ userId, balance: 0, transactions: [] });
      }
      // Calculate offer price for the item
      const product = item.productId;
      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice ? product.salePrice : product.regularPrice;
      const originalPrice = basePrice * quantity;
      let productOfferDiscount = 0;
      if (product.offer && product.offer.isActive) {
        productOfferDiscount = product.offer.discountType === 'percentage'
          ? (originalPrice * product.offer.discountValue) / 100
          : product.offer.discountValue * quantity;
      }
      let categoryOfferDiscount = 0;
      if (product.category && product.category.categoryOffer && product.category.categoryOffer.active) {
        categoryOfferDiscount = product.category.categoryOffer.discountType === 'percentage'
          ? (originalPrice * product.category.categoryOffer.discountValue) / 100
          : product.category.categoryOffer.discountValue * quantity;
      }
      const bestOfferDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);
      const offerPrice = originalPrice - bestOfferDiscount;
      // Proportional coupon refund logic
      // Calculate total offer price for all non-cancelled items
      const totalOrderOfferPrice = order.items.reduce((sum, i) => {
        if (i.status !== 'Cancelled') {
          const prod = i.productId;
          const qty = i.quantity;
          const base = prod.salePrice && prod.salePrice < prod.regularPrice ? prod.salePrice : prod.regularPrice;
          const orig = base * qty;
          let prodOffer = 0;
          if (prod.offer && prod.offer.isActive) {
            prodOffer = prod.offer.discountType === 'percentage'
              ? (orig * prod.offer.discountValue) / 100
              : prod.offer.discountValue * qty;
          }
          let catOffer = 0;
          if (prod.category && prod.category.categoryOffer && prod.category.categoryOffer.active) {
            catOffer = prod.category.categoryOffer.discountType === 'percentage'
              ? (orig * prod.category.categoryOffer.discountValue) / 100
              : prod.category.categoryOffer.discountValue * qty;
          }
          const best = Math.max(prodOffer, catOffer);
          return sum + (orig - best);
        }
        return sum;
      }, 0);
      const couponDiscount = order.couponDiscount || 0;
      let proportionalCoupon = 0;
      if (couponDiscount > 0 && totalOrderOfferPrice > 0) {
        proportionalCoupon = (offerPrice / totalOrderOfferPrice) * couponDiscount;
      }
      const refundAmount = offerPrice - proportionalCoupon;
      wallet.balance += refundAmount;
      wallet.transactions.push({
        type: 'CREDIT',
        amount: refundAmount,
        description: `Refund for cancelled item in order #${order.orderId}`,
        orderId: order._id,
        itemId: itemId
      });
      await wallet.save();
    }

    if (order.items.every(i => i.status === 'Cancelled')) {
      order.status = 'Cancelled';
    }

    await order.save();
    return res.status(200).json({ success: true, message: 'Item cancelled successfully' });
  } catch (err) {
    console.error('Error in cancelOrderItem:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  orders,
  orderDetails,
  cancelOrder,
  returnOrder,
  returnRequest,
  downloadInvoice,
  cancelOrderItem,
};