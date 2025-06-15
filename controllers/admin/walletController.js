const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema');
const User = require('../../models/userSchema');

const processReturnRefund = async (req) => {
    try {
        const { orderId } = req.body;

        if (!req.session.user || !req.session.user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access'
            });
        }

        const order = await Order.findById(orderId).populate('orderItems.productId');

        if (!order || order.status !== 'Return Requested') {
            return res.status(400).json({
                success: false,
                message: 'Invalid order or return not requested'
            });
        }

        let wallet = await Wallet.findOne({ userId: order.userId });
        
        if (!wallet) {
            wallet = new Wallet({ 
                userId: order.userId, 
                balance: 0, 
                transactions: [] 
            });
        }

        const refundAmount = order.finalAmount;

        const transaction = {
            type: 'CREDIT',
            amount: refundAmount,
            description: `Refund for returned order #${order.orderId}`,
            orderId: order._id,
            status: 'COMPLETED',
            createdAt: new Date()
        };

        wallet.balance += refundAmount;
        wallet.transactions.push(transaction);
        await wallet.save();

        await User.findByIdAndUpdate(order.userId, { wallet: wallet._id });

        order.status = 'Returned';
        await order.save();

        return {
            success: true,
            message: 'Return processed and refund completed successfully',
            refundAmount: refundAmount
        };

    } catch (error) {
        console.error('Error in processReturnRefund:', error);
        throw new Error('Something went wrong while processing the return');
    }
};

module.exports = {
    processReturnRefund
}; 