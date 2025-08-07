const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema');
const User = require('../../models/userSchema');
const { calculateRefund, formatRefundDescription } = require('../../helpers/refundHelpers');


 
const processRefund = async (req, res) => {
    try {
        const { orderId, itemId, reason } = req.body;
        const userId = req.session.user.id;

        const order = await Order.findOne({ _id: orderId, userId });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (itemId) {
            const item = order.items.id(itemId);
            if (!item) {
                return res.status(404).json({ success: false, message: 'Item not found in order' });
            }
            
            return processItemRefund(req, res, order, item);
        }

        return processFullOrderRefund(req, res, order);

    } catch (error) {
        console.error('Error processing refund:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to process refund',
            error: error.message 
        });
    }
};


async function processItemRefund(req, res, order, item) {
    try {
        if (item.status !== 'delivered' && item.status !== 'shipped') {
            return res.status(400).json({ 
                success: false, 
                message: `Item is ${item.status} and cannot be refunded` 
            });
        }

        const refundAmount = item.price * item.quantity;
        
        item.status = 'refunded';
        item.refundedAt = new Date();
        item.refundReason = req.body.reason || 'Refund requested';

        const allItemsRefunded = order.items.every(i => 
            i.status === 'refunded' || i.status === 'cancelled'
        );

        if (allItemsRefunded) {
            order.status = 'refunded';
        } else {
            order.status = 'partially_refunded';
        }

        await order.save();

        await processRefundPayment(req.user._id, order, refundAmount, 'item_refund');

        return res.json({ 
            success: true, 
            message: 'Refund processed successfully',
            refundAmount
        });

    } catch (error) {
        console.error('Error in processItemRefund:', error);
        throw error;
    }
}


async function processFullOrderRefund(req, res, order) {
    try {
        if (order.status === 'cancelled' || order.status === 'refunded') {
            return res.status(400).json({ 
                success: false, 
                message: `Order is already ${order.status}` 
            });
        }

        const { amount: refundAmount } = calculateRefund(order, 'refund');
        
        order.status = 'refunded';
        order.refundedAt = new Date();
        order.refundReason = req.body.reason || 'Order refunded';
        
        order.items.forEach(item => {
            item.status = 'refunded';
        });

        await order.save();

        await processRefundPayment(req.user._id, order, refundAmount, 'order_refund');

        return res.json({ 
            success: true, 
            message: 'Order refund processed successfully',
            refundAmount
        });

    } catch (error) {
        console.error('Error in processFullOrderRefund:', error);
        throw error;
    }
}


async function processRefundPayment(userId, order, amount, type) {

    console.log(`Processing ${type} of $${amount} for order ${order._id}`);
  
    const wallet = await Wallet.findOneAndUpdate(
        { userId },
        { 
            $inc: { balance: amount },
            $push: {
                transactions: {
                    type: 'credit',
                    amount,
                    description: `Refund for ${type}: Order #${order.orderId}`,
                    orderId: order._id,
                    status: 'completed',
                    createdAt: new Date()
                }
            }
        },
        { new: true, upsert: true }
    );
    
    return wallet;
}

const getRefundStatus = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const userId = req.session.user.id;

        const order = await Order.findOne({ _id: orderId, userId });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (itemId) {
            const item = order.items.id(itemId);
            if (!item) {
                return res.status(404).json({ success: false, message: 'Item not found in order' });
            }
            
            return res.json({
                success: true,
                refundStatus: item.status,
                refundedAt: item.refundedAt,
                refundReason: item.refundReason
            });
        }

        return res.json({
            success: true,
            refundStatus: order.status,
            refundedAt: order.refundedAt,
            refundReason: order.refundReason
        });

    } catch (error) {
        console.error('Error getting refund status:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to get refund status',
            error: error.message 
        });
    }
};

module.exports = {
    processRefund,
    getRefundStatus
};
