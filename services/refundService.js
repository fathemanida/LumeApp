const Wallet = require('../models/walletSchema');
const Order = require('../models/orderSchema');
const User = require('../models/userSchema');
const Product = require('../models/productSchema');


const processRefund = async ({
  userId,
  orderId,
  itemId = null,
  amount,
  reason,
  type = 'CANCEL'
}) => {
  const session = await Order.startSession();
  session.startTransaction();

  try {
    const order = await Order.findById(orderId).session(session);
    const user = await User.findById(userId).session(session);
    
    if (!order || !user) {
      throw new Error('Order or user not found');
    }

    let wallet = await Wallet.findOne({ userId }).session(session);
    
    if (!wallet) {
      wallet = new Wallet({
        userId,
        balance: 0,
        transactions: []
      });
    }

    const transaction = {
      type: 'CREDIT',
      amount,
      description: `${type} Refund for Order #${order.orderNumber}` + 
                  (itemId ? ` (Item: ${itemId})` : ''),
      orderId: order._id,
      status: 'COMPLETED',
      date: new Date(),
      referenceId: `REFUND-${Date.now()}`,
      metadata: {
        reason,
        refundType: type,
        itemId: itemId || null
      }
    };

    wallet.balance += amount;
    wallet.transactions.push(transaction);
    await wallet.save({ session });

    if (itemId) {
      const item = order.items.find(i => i._id.toString() === itemId);
      if (item) {
        item.status = type === 'CANCEL' ? 'Cancelled' : 'Returned';
        item.refundedAt = new Date();
        item.refundAmount = amount;
      }

      const allItemsProcessed = order.items.every(item => 
        ['Cancelled', 'Returned'].includes(item.status)
      );
      
      if (allItemsProcessed) {
        order.status = type === 'CANCEL' ? 'Cancelled' : 'Returned';
      } else {
        order.status = type === 'CANCEL' ? 'Partially Cancelled' : 'Partially Returned';
      }
    } else {
      order.status = type === 'CANCEL' ? 'Cancelled' : 'Returned';
      order.items.forEach(item => {
        item.status = type === 'CANCEL' ? 'Cancelled' : 'Returned';
        item.refundedAt = new Date();
        item.refundAmount = item.finalPrice || item.price;
      });
    }

    order.updatedAt = new Date();
    await order.save({ session });

    if (type === 'RETURN' && itemId) {
      const item = order.items.find(i => i._id.toString() === itemId);
      if (item) {
        const product = await Product.findById(item.productId).session(session);
        if (product) {
          product.quantity += item.quantity;
          product.status = product.quantity > 0 ? 'Available' : 'Out of Stock';
          await product.save({ session });
        }
      }
    }

    if (!user.wallet || user.wallet.toString() !== wallet._id.toString()) {
      user.wallet = wallet._id;
      await user.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    return {
      success: true,
      message: `${type} processed successfully`,
      refundAmount: amount,
      walletBalance: wallet.balance,
      orderStatus: order.status
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error(`Error in processRefund (${type}):`, error);
    throw new Error(`Failed to process ${type.toLowerCase()} refund: ${error.message}`);
  }
};


const calculateRefundAmount = (order, itemId = null) => {
  if (itemId) {
    const item = order.items.find(i => i._id.toString() === itemId);
    return item ? (item.finalPrice || item.price) * item.quantity : 0;
  }
  
  return order.items.reduce((total, item) => {
    return total + ((item.finalPrice || item.price) * item.quantity);
  }, 0);
};

module.exports = {
  processRefund,
  calculateRefundAmount
};
