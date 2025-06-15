const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema');
const User = require('../../models/userSchema');

const cancelOrReturnOrder = async (req, res) => {
  try {
    const { orderId, actionType } = req.body; 

    const order = await Order.findById(orderId);

    if (!order || order.status === 'Cancelled' || order.status === 'Returned') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or already processed order'
      });
    }

    // Handle cancellation - direct refund
    if (actionType === 'cancel') {
      // Process refund if payment was not COD
      if (order.paymentMethod !== 'COD') {
        let wallet = await Wallet.findOne({ userId: order.userId });
        
        if (!wallet) {
          wallet = new Wallet({ 
            userId: order.userId, 
            balance: 0, 
            transactions: [] 
          });
        }

        const transaction = {
          type: 'CREDIT',
          amount: order.finalAmount,
          description: `Direct refund for cancelled order #${order.orderId}`,
          orderId: order._id,
          status: 'COMPLETED',
          createdAt: new Date()
        };

        wallet.balance += order.finalAmount;
        wallet.transactions.push(transaction);
        await wallet.save();

        // Update user's wallet reference if not set
        await User.findByIdAndUpdate(order.userId, { wallet: wallet._id });

        // Update order status to Cancelled
        order.status = 'Cancelled';
        await order.save();

        return res.status(200).json({
          success: true,
          message: 'Order cancelled and amount refunded to wallet successfully'
        });
      } else {
        // For COD orders, just cancel without refund
        order.status = 'Cancelled';
        await order.save();

        return res.status(200).json({
          success: true,
          message: 'Order cancelled successfully'
        });
      }
    }

    // Handle return - requires admin confirmation
    if (actionType === 'return') {
      // Set status to Return Requested
      order.status = 'Return Requested';
      await order.save();

      return res.status(200).json({
        success: true,
        message: 'Return request submitted. Refund will be processed after admin confirmation.'
      });
    }

  } catch (error) {
    console.error('Error in cancelOrReturnOrder:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong while processing your request.'
    });
  }
};

const processReturnRefund = async (req, res) => {
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

    res.status(200).json({
      success: true,
      message: 'Return processed and refund completed successfully',
      refundAmount: refundAmount
    });

  } catch (error) {
    console.error('Error in processReturnRefund:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong while processing the return'
    });
  }
};

const getWallet = async (req, res) => {
  try {
    const user = req.session.user;

    if (!user || !user.id) {
      return res.status(401).json({ success: false, message: 'User not logged in' });
    }

    const userId = user.id;

    let wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0, transactions: [] });
      await wallet.save();
      
      await User.findByIdAndUpdate(userId, { wallet: wallet._id });
    }

          const sortedTransactions = wallet.transactions.sort((a, b) => b.createdAt - a.createdAt);

    res.render('user/wallet', {
      user: user,
      wallet: wallet || { balance: 0, transactions: [] },
      transactions: sortedTransactions || []
    });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    res.status(500).render('error', { message: 'Failed to load wallet' });
  }
};


const getTransactions = async (req, res) => {
  try {
    const userId = req.session.user._id;

    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      return res.json({ transactions: [] });
    }

    res.json({ transactions: wallet.transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Failed to get transactions' });
  }
};

const addRefund = async (req, res) => {
  try {
    const userId = req.session.user._id;
    const { amount, orderId, description } = req.body;

    let wallet = await Wallet.findOne({ userId });

    const transaction = {
      type: 'CREDIT',
      amount,
      description: description || 'Order refund',
      orderId,
      status: 'COMPLETED'
    };

    if (!wallet) {
      wallet = new Wallet({
        userId,
        balance: amount,
        transactions: [transaction]
      });
    } else {
      wallet.balance += amount;
      wallet.transactions.push(transaction);
    }

    await wallet.save();

    res.status(200).json({ success: true, message: 'Refund credited to wallet' });
  } catch (error) {
    console.error('Error refunding to wallet:', error);
    res.status(500).json({ success: false, message: 'Wallet refund failed' });
  }
};

module.exports = {
    getWallet,
    getTransactions,
    addRefund,
    cancelOrReturnOrder,
    processReturnRefund
};
