const Order = require('../../models/orderSchema');
const User = require('../../models/userSchema');
const mongoose = require('mongoose');
const walletController = require('./walletController');
const Wallet = require('../../models/walletSchema');
const Product = require('../../models/productSchema');

const getOrderDetails = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).render('admin/error', {
                message: 'Invalid order ID',
                layout: 'admin/layout',
                admin: true
            });
        }

        const order = await Order.findById(orderId)
            .populate({
                path: 'items.productId',
                model: 'Product',
                select: 'productName productImage regularPrice salePrice'
            })
            .populate('address')
            .populate({
                path: 'userId',
                model: 'User',
                select: 'name email phone'
            })
            .populate('payment.paymentMethod')
            .lean();

        if (!order) {
            return res.status(404).render('admin/error', {
                message: 'Order not found',
                layout: 'admin/layout',
                admin: true
            });
        }

        const formattedOrder = {
            ...order,
            orderNumber: order._id.toString().slice(-6).toUpperCase(),
            createdOn: new Date(order.createdOn).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        };

        res.render('admin/order-details', {
            order: formattedOrder,
            layout: 'admin/layout',
            admin: true,
            title: 'Order Details'
        });

    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('admin/error', {
            message: 'Error fetching order details',
            layout: 'admin/layout',
            admin: true
        });
    }
};

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

const getOrderAddress = async (addressField) => {
    try {
        if (addressField && typeof addressField === 'object' && addressField.name) {
            return {
                fullName: addressField.name || 'N/A',
                phone: addressField.phone || 'N/A',
                addressLine1: `${addressField.houseNo || ''} ${addressField.roadArea || ''}`.trim() || 'Address not provided',
                addressLine2: addressField.landMark || '',
                city: addressField.city || 'N/A',
                state: addressField.state || 'N/A',
                pincode: addressField.pincode || 'N/A'
            };
        }
        
        if (addressField && typeof addressField === 'string') {
            const Address = require('../../models/addressSchema');
            const address = await Address.findById(addressField).lean();
            
            if (address) {
                return {
                    fullName: address.name || 'N/A',
                    phone: address.phone || 'N/A',
                    addressLine1: `${address.houseNo || ''} ${address.roadArea || ''}`.trim() || 'Address not provided',
                    addressLine2: address.landMark || '',
                    city: address.city || 'N/A',
                    state: address.state || 'N/A',
                    pincode: address.pincode || 'N/A'
                };
            }
        }
        
        return {
            fullName: 'Address not available',
            phone: 'N/A',
            addressLine1: 'Address not provided',
            addressLine2: '',
            city: 'N/A',
            state: 'N/A',
            pincode: 'N/A'
        };
    } catch (error) {
        console.error('Error fetching address:', error);
        return {
            fullName: 'Error loading address',
            phone: 'N/A',
            addressLine1: 'Could not load address',
            addressLine2: '',
            city: 'N/A',
            state: 'N/A',
            pincode: 'N/A'
        };
    }
};







const updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: 'Invalid order ID' });
        }

        const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        order.status = status;
        order.updatedAt = new Date();
        
        if (status === 'Cancelled') {
            order.items.forEach(item => {
                item.status = 'Cancelled';
            });
        }

        await order.save();

        res.json({ 
            success: true, 
            message: `Order status updated to ${status}`,
            order
        });

    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating order status',
            error: error.message 
        });
    }
};

const updateOrderItemStatus = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const { status } = req.body;

        if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ success: false, message: 'Invalid order or item ID' });
        }

        const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Order item not found' });
        }

        order.items[itemIndex].status = status;
        order.updatedAt = new Date();

        updateOrderStatusBasedOnItems(order);

        await order.save();

        res.json({ 
            success: true, 
            message: `Order item status updated to ${status}`,
            order
        });

    } catch (error) {
        console.error('Error updating order item status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating order item status',
            error: error.message 
        });
    }
};

const handleOrderReturn = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { action } = req.body; 

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (action === 'approve') {
            order.items.forEach(item => {
                if (item.returnStatus === 'Requested') {
                    item.returnStatus = 'Approved';
                    item.status = 'Returned';
                    item.isReturned = true;
                }
            });
            order.status = 'Returned';
            
            if (order.payment.status === 'Paid') {
                const refundAmount = order.totalAmount;
                console.log(`Processing refund of ${refundAmount} for order ${orderId}`);
                
                await walletController.addToWallet({
                    userId: order.userId,
                    amount: refundAmount,
                    type: 'refund',
                    description: `Refund for order #${order.orderNumber}`,
                    orderId: order._id
                });
            }
        } else {
            order.items.forEach(item => {
                if (item.returnStatus === 'Requested') {
                    item.returnStatus = 'Rejected';
                }
            });
            updateOrderStatusBasedOnItems(order);
        }

        order.updatedAt = new Date();
        await order.save();

        res.json({ 
            success: true, 
            message: `Return request ${action}ed successfully`,
            order
        });

    } catch (error) {
        console.error('Error handling order return:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error handling order return',
            error: error.message 
        });
    }
};

const handleOrderItemReturn = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const { action } = req.body; 

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Order item not found' });
        }

        const item = order.items[itemIndex];
        
        if (action === 'approve') {
            item.returnStatus = 'Approved';
            item.status = 'Returned';
            item.isReturned = true;
            
            if (order.payment.status === 'Paid') {
                const refundAmount = item.finalPrice * item.quantity;
                console.log(`Processing refund of ${refundAmount} for item ${itemId} in order ${orderId}`);
                
                await walletController.addToWallet({
                    userId: order.userId,
                    amount: refundAmount,
                    type: 'refund',
                    description: `Refund for item in order #${order.orderNumber}`,
                    orderId: order._id,
                    itemId: item._id
                });
            }
        } else {
            item.returnStatus = 'Rejected';
        }

        updateOrderStatusBasedOnItems(order);
        order.updatedAt = new Date();
        await order.save();

        res.json({ 
            success: true, 
            message: `Return request for item ${action}ed successfully`,
            order
        });

    } catch (error) {
        console.error('Error handling item return:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error handling item return',
            error: error.message 
        });
    }
};

const updateOrderStatusBasedOnItems = (order) => {
    const itemStatuses = [...new Set(order.items.map(item => item.status))];
    const returnStatuses = [...new Set(order.items.map(item => item.returnStatus).filter(Boolean))];

    if (itemStatuses.length === 1) {
        order.status = itemStatuses[0];
    } else if (itemStatuses.includes('Cancelled') && itemStatuses.length === 2) {
        order.status = 'Partially Cancelled';
    } else if (returnStatuses.includes('Requested')) {
        order.status = 'Return Requested';
    } else if (returnStatuses.includes('Approved')) {
        order.status = itemStatuses.every(s => s === 'Returned') ? 'Returned' : 'Partially Returned';
    } else {
        order.status = 'Processing';
    }
};

module.exports = {
    getOrders,
    getOrderDetails,
    updateOrderStatus,
    updateOrderItemStatus,
    handleOrderReturn,
    handleOrderItemReturn
};