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
  try {
    const order = await Order.findById(orderId);
    const user = await User.findById(userId);
    if (!order || !user) throw new Error('Order or user not found');

    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      wallet = new Wallet({
        userId,
        balance: 0,
        transactions: []
      });
    }

    let refundAmount = amount;

    if (itemId) {
      const item = order.items.find(i => i._id.toString() === itemId);
      if (!item) throw new Error('Item not found in order');

      if (order.couponDiscount && order.couponDiscount > 0) {
        const couponPerItem = order.couponDiscount / (order.items.length - 1); // fix: add parentheses
        refundAmount += couponPerItem;
        console.log('===couponper',couponPerItem);
      }

      const transaction = {
        type: 'CREDIT',
        amount: refundAmount,
        description: `${type} Refund for Order #${order.orderNumber} (Item: ${itemId})`,
        orderId: order._id,
        status: 'COMPLETED',
        date: new Date(),
        referenceId: `REFUND-${Date.now()}`,
        metadata: {
          reason,
          refundType: type,
          itemId: itemId
        }
      };

      wallet.balance += refundAmount;
      wallet.transactions.push(transaction);
      await wallet.save();

      item.status = type === 'CANCEL' ? 'Cancelled' : 'Returned';
      item.refundedAt = new Date();
      item.refundAmount = refundAmount;

      const allItemsProcessed = order.items.every(item =>
        ['Cancelled', 'Returned'].includes(item.status)
      );

      order.status = allItemsProcessed
        ? (type === 'CANCEL' ? 'Cancelled' : 'Returned')
        : (type === 'CANCEL' ? 'Partially Cancelled' : 'Partially Returned');

      if (type === 'RETURN') {
        const product = await Product.findById(item.productId);
        if (product) {
          product.quantity += item.quantity;
          product.status = product.quantity > 0 ? 'Available' : 'Out of Stock';
          await product.save();
        }
      }
    } else {
      const transaction = {
        type: 'CREDIT',
        amount: refundAmount,
        description: `${type} Refund for Order #${order.orderNumber}`,
        orderId: order._id,
        status: 'COMPLETED',
        date: new Date(),
        referenceId: `REFUND-${Date.now()}`,
        metadata: {
          reason,
          refundType: type,
          itemId: null
        }
      };

      wallet.balance += refundAmount;
      wallet.transactions.push(transaction);
      await wallet.save();

      order.status = type === 'CANCEL' ? 'Cancelled' : 'Returned';
      order.items.forEach(item => {
        item.status = type === 'CANCEL' ? 'Cancelled' : 'Returned';
        item.refundedAt = new Date();
        item.refundAmount = item.finalPrice || item.price;
      });
    }

    order.updatedAt = new Date();
    await order.save();

    if (!user.wallet || user.wallet.toString() !== wallet._id.toString()) {
      user.wallet = wallet._id;
      await user.save();
    }

    return {
      success: true,
      message: `${type} processed successfully`,
      refundAmount: refundAmount,
      walletBalance: wallet.balance,
      orderStatus: order.status
    };
  } catch (error) {
    console.error(`Error in processRefund (${type}):`, error);
    throw new Error(`Failed to process ${type.toLowerCase()} refund`);
  }
};

const calculateRefundAmount = (item) => {
  console.log('==calculated refund');
  if (
    item.status !== "Delivered" ||
    item.isReturned === true ||
    item.returnStatus === "Rejected"
  ) {
    return {
      eligible: false,
      reason: "Item is not eligible for refund",
      refundAmount: 0
    };
  }

  const refundAmount = item.finalPrice * item.quantity;

  return {
    eligible: true,
    refundAmount,
    details: {
      originalPrice: item.originalPrice,
      appliedOffer: item.appliedOffer,
      couponPerUnit: item.couponPerUnit,
      quantity: item.quantity,
      finalPricePerUnit: item.finalPrice
    }
  };
};

module.exports = {
  processRefund,
  calculateRefundAmount
};

