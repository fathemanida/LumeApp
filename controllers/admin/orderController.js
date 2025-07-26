const Order = require('../../models/orderSchema');
const User = require('../../models/userSchema');
const mongoose = require('mongoose');
const walletController = require('./walletController');
const Wallet = require('../../models/walletSchema');
const Product = require('../../models/productSchema');

const getOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10; 
        const skip = (page - 1) * limit;
        const search = req.query.search || '';

        let searchQuery = {};
        if (search) {
            searchQuery = {
                $or: [
                    { orderNumber: { $regex: search, $options: 'i' } },
                    { 'userId.name': { $regex: search, $options: 'i' } },
                    { 'userId.email': { $regex: search, $options: 'i' } },
                    { 'items.productId.productName': { $regex: search, $options: 'i' } }
                ]
            };
        }

        const totalOrders = await Order.countDocuments(searchQuery);
        const totalPages = Math.ceil(totalOrders / limit);

        const orders = await Order.find(searchQuery)
            .populate({
                path: 'items.productId',
                model: 'Product',
                select: 'productName productImage regularPrice salePrice quantity'
            })
            .populate('address')
            .populate({
                path: 'userId',
                model: 'User',
                select: 'name email'
            })
            .sort({ createdOn: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const formattedOrders = orders.map(order => {
            return {
                ...order,
                orderNumber: order._id.toString().slice(-6).toUpperCase(),
                totalAmount: order.totalAmount || 0,
                status: order.status || 'Pending',
                paymentMethod: order.paymentMethod || 'COD',
                userId: order.userId ? {
                    name: order.userId.name || 'Unknown User',
                    email: order.userId.email || 'No email'
                } : {
                    name: 'User not found',
                    email: 'No email'
                }
            };
        });

        res.render('admin/orders', { 
            orders: formattedOrders,
            currentPage: page,
            totalPages,
            search
        });
    } catch (error) {
        console.error('Error in getOrders:', error);
        res.status(500).render('error', { message: 'Error loading orders' });
    }
};

const getOrderDetails = async (req, res) => {
    try {
        const orderId = req.params.orderId;

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).render('error', {
                message: 'Invalid order ID format',
                error: { status: 400 }
            });
        }

        const order = await Order.findById(orderId)
            .populate({
                path: 'items.productId',
                model: 'Product',
                select: 'productName productImage regularPrice salePrice quantity'
            })
            .populate('address')
            .populate({
                path: 'userId',
                model: 'User',
                select: 'username email name'
            })
            .lean();

        if (!order) {
            return res.status(404).render('error', {
                message: 'Order not found',
                error: { status: 404 }
            });
        }

        
        let userData = null;
        if (order.userId && order.userId._id) {
            const user = await User.findById(order.userId._id)
                .select('username email name')
                .lean();
            
            if (user) {
                userData = {
                    name: user.name || user.username || 'Unknown User',
                    email: user.email || 'No email'
                };
            }
        }
        let subtotal=0
        basePrice = order.items[0].productId.salePrice && order.items[0].productId.salePrice < order.items[0].productId.regularPrice
          ? order.items[0].productId.salePrice
          : order.items[0].productId.regularPrice;
        const originalPrice = basePrice * order.items[0].quantity;
      const totalAmount = order.totalAmount || originalPrice;
const shipping = totalAmount > 1500 ? 0 : 40;
        subtotal += originalPrice;

        if (order.returnRequest && order.returnRequest.items && order.returnRequest.items.length > 0) {
            for (const item of order.returnRequest.items) {
                if (item.productId) {
                    const product = await Product.findById(item.productId).select('productName');
                    if (product) {
                        item.productId = {
                            _id: product._id,
                            productName: product.productName
                        };
                    }
                }
            }
        }
        const formattedOrder = {
            ...order,
            orderNumber: order._id.toString().slice(-6).toUpperCase(),
            date: new Date(order.createdOn).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            items: order.items.map(item => ({
                name: item.productId?.productName || 'Product not found',
                image: Array.isArray(item.productId?.productImage) && item.productId.productImage.length
                    ? `/uploads/product/${item.productId.productImage[0]}`
                    : '/images/default-product.jpg',
                price: item.price || 0,
                quantity: item.quantity || 0,
                total: (item.price || 0) * (item.quantity || 0)
            })),
            totalAmount: order.totalAmount || 0,
            shipping: order.shipping || 0,
            discount: order.discount || 0,
            status: order.status || 'Pending',
            paymentMethod: order.paymentMethod || 'COD',
            subtotal:subtotal,
            address: order.address || null,
            userId: userData || {
                name: 'User not found',
                email: 'No email'
            }
        };

        res.render('admin/orderDetails', { order: formattedOrder });
    } catch (error) {
        console.error('Error in getOrderDetails:', error);
        res.status(500).render('error', {
            message: 'Error loading order details',
            error: { status: 500 }
        });
    }
};

const updateOrderStatus = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { status } = req.body;

        const order = await Order.findById(orderId).populate('items.productId');
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        const previousStatus = order.status;

        if (status === 'Cancelled' && previousStatus !== 'Cancelled') {
            if (order.paymentMethod !== 'COD' && order.totalAmount > 0) {
                let wallet = await Wallet.findOne({ userId: order.userId });
                if (!wallet) {
                    wallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
                }
                wallet.balance += order.totalAmount;
                wallet.transactions.push({
                    type: 'CREDITSS',
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
        } else if (status === 'Returned' && previousStatus !== 'Returned') {
            if (order.totalAmount > 0) {
                 let wallet = await Wallet.findOne({ userId: order.userId });
                 if (!wallet) {
                    wallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
                 }
                 wallet.balance += order.totalAmount;
                 wallet.transactions.push({
                    type: 'CREDIT',
                    amount: order.totalAmount,
                    description: `Refund for returned order #${order.orderId}`,
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
        }

        order.status = status;
        await order.save();

        res.json({
            success: true,
            message: 'Order status updated successfully'
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update order status'
        });
    }
};

const handleReturnRequest = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const { action, reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order ID'
            });
        }

        const order = await Order.findById(orderId).populate('items.productId');

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        if (!order.returnRequest || order.returnRequest.status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'No pending return request found for this order'
            });
        }

        if (action === 'accept') {
            try {
                const fakeReq = { params: { orderId }, body: { status: 'Returned' } };
                const fakeRes = {
                    json: (data) => {
                        if (!data.success) {
                            throw new Error(data.message || 'Failed to update order status.');
                        }
                    },
                    status: (code) => ({
                        json: (data) => {
                            throw new Error(data.message || `Request failed with status code ${code}`);
                        }
                    })
                };
                await updateOrderStatus(fakeReq, fakeRes);
                
                order.returnRequest.status = 'Accepted';
                order.returnRequest.respondedAt = new Date();
                await order.save();

                return res.json({
                    success: true,
                    message: 'Return request accepted and refund processed successfully'
                });
            } catch (error) {
                console.error('Error processing return refund:', error);
                return res.status(500).json({
                    success: false,
                    message: error.message || 'Error processing return refund'
                });
            }
        } else if (action === 'reject') {
            if (!reason) {
                return res.status(400).json({
                    success: false,
                    message: 'Rejection reason is required'
                });
            }

            order.status = 'Return Rejected';
            order.returnRequest.status = 'Rejected';
            order.returnRequest.adminResponse = reason;
            order.returnRequest.respondedAt = new Date();
            await order.save();

            return res.json({
                success: true,
                message: 'Return request rejected successfully'
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid action specified'
            });
        }

    } catch (error) {
        console.error('Error handling return request:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing return request'
        });
    }
};

module.exports = {
    getOrders,
    getOrderDetails,
    updateOrderStatus,
    handleReturnRequest
};