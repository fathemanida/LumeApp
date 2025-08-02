const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema');
const User = require('../../models/userSchema');
const { calculateRefund, formatRefundDescription } = require('../../helpers/refundHelpers');

/**
 * Process a refund request for an order or order item
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processRefund = async (req, res) => {
    try {
        const { orderId, itemId, reason } = req.body;
        const userId = req.session.user.id;

        // Find the order
        const order = await Order.findOne({ _id: orderId, userId });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Check if item exists if itemId is provided
        if (itemId) {
            const item = order.items.id(itemId);
            if (!item) {
                return res.status(404).json({ success: false, message: 'Item not found in order' });
            }
            
            // Process item refund
            return processItemRefund(req, res, order, item);
        }

        // Process full order refund
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

/**
 * Process refund for a specific order item
 */
async function processItemRefund(req, res, order, item) {
    try {
        // Check if item is eligible for refund
        if (item.status !== 'delivered' && item.status !== 'shipped') {
            return res.status(400).json({ 
                success: false, 
                message: `Item is ${item.status} and cannot be refunded` 
            });
        }

        // Calculate refund amount for the item
        const refundAmount = item.price * item.quantity;
        
        // Update item status
        item.status = 'refunded';
        item.refundedAt = new Date();
        item.refundReason = req.body.reason || 'Refund requested';

        // Update order status if needed
        const allItemsRefunded = order.items.every(i => 
            i.status === 'refunded' || i.status === 'cancelled'
        );

        if (allItemsRefunded) {
            order.status = 'refunded';
        } else {
            order.status = 'partially_refunded';
        }

        await order.save();

        // Process refund to payment method or wallet
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

/**
 * Process full order refund
 */
async function processFullOrderRefund(req, res, order) {
    try {
        // Check if order is eligible for refund
        if (order.status === 'cancelled' || order.status === 'refunded') {
            return res.status(400).json({ 
                success: false, 
                message: `Order is already ${order.status}` 
            });
        }

        // Calculate refund amount
        const { amount: refundAmount } = calculateRefund(order, 'refund');
        
        // Update order status
        order.status = 'refunded';
        order.refundedAt = new Date();
        order.refundReason = req.body.reason || 'Order refunded';
        
        // Update all items status
        order.items.forEach(item => {
            item.status = 'refunded';
        });

        await order.save();

        // Process refund to payment method or wallet
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

/**
 * Process the actual refund payment
 */
async function processRefundPayment(userId, order, amount, type) {
    // Here you would typically integrate with a payment gateway
    // For now, we'll just log the refund
    console.log(`Processing ${type} of $${amount} for order ${order._id}`);
    
    // In a real implementation, you would:
    // 1. Check if original payment was via credit card
    // 2. Process refund through payment gateway if applicable
    // 3. Otherwise, credit user's wallet
    
    // For now, we'll just add to wallet
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

/**
 * Get refund status for an order or order item
 */
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
