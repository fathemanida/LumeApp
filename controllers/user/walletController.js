const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema');
const User = require('../../models/userSchema');
const Product = require('../../models/productSchema');
const { calculateRefund, formatRefundDescription } = require('../../helpers/refundHelpers');

const cancelOrReturnOrder = async (req, res) => {
  try {
    const { orderId, actionType } = req.body; 

    const order = await Order.findById(orderId).populate('items.productId');

    if (!order || order.status === 'Cancelled' || order.status === 'Returned') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or already processed order'
      });
    }

    if (actionType === 'cancel') {
        if (order.status === 'Shipped' || order.status === 'Delivered') {
            return res.status(400).json({ success: false, message: 'Cannot cancel order at this stage.' });
        }
        
      if (order.paymentMethod !== 'COD') {
        const refundBreakdown = await calculateRefund(order, [], 'cancellation');
        
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
          amount: refundBreakdown.totalRefund,
          description: formatRefundDescription(refundBreakdown),
          orderId: order._id,
          status: 'COMPLETED',
          createdAt: new Date(),
          refundBreakdown: refundBreakdown
        };

        wallet.balance += refundBreakdown.totalRefund;
        wallet.transactions.push(transaction);
        await wallet.save();

        await User.findByIdAndUpdate(order.userId, { wallet: wallet._id });
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

      return res.status(200).json({
          success: true,
          message: 'Order cancelled successfully'
      });
    }

    if (actionType === 'return') {
        if (order.status !== 'Delivered') {
            return res.status(400).json({ success: false, message: 'Only delivered orders can be returned.' });
        }
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

    const order = await Order.findById(orderId).populate('items.productId');

    if (!order || order.status !== 'Return Requested') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order or return not requested'
      });
    }

    const refundBreakdown = await calculateRefund(order, [], 'return');
    
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
      amount: refundBreakdown.totalRefund,
      description: formatRefundDescription(refundBreakdown),
      orderId: order._id,
      status: 'COMPLETED',
      createdAt: new Date(),
      refundBreakdown: refundBreakdown 
    };

    wallet.balance += refundBreakdown.totalRefund;
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

    res.render('wallet', {
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


const addRefund = async (req) => {
  try {
    const userId = req.session?.user?._id;
    if (!userId) throw new Error('Missing user session');

    let { amount, orderId, description } = req.body;

    amount = Number(amount);
    if (isNaN(amount) || amount <= 0) {
      return { success: false, message: 'Invalid refund amount' };
    }

    let wallet = await Wallet.findOne({ userId });

    const transaction = {
      type: 'CREDIT',
      amount,
      description: description || 'Order refund',
      orderId,
      status: 'COMPLETED',
      date: new Date()
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

    return { success: true, message: 'Refund credited to wallet' };
  } catch (error) {
    console.error('Error refunding to wallet:', error);
    return { success: false, message: 'Wallet refund failed', error };
  }
};



module.exports = {
    getWallet,
    getTransactions,
    addRefund,
    cancelOrReturnOrder,
    processReturnRefund,
    addRefund
};
