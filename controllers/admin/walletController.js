const Order = require("../../models/orderSchema");
const Wallet = require("../../models/walletSchema");
const User = require("../../models/userSchema");

const processReturnRefund = async (req) => {
  try {
    const { orderId } = req.body;
    const Product = require('../../models/productSchema');

    if (!req.session.user || !req.session.user.isAdmin) {
      return {
        success: false,
        message: "Unauthorized access",
      };
    }

    const order = await Order.findById(orderId).populate("items.productId");

    if (!order) {
      return {
        success: false,
        message: "Order not found",
      };
    }

    let wallet = await Wallet.findOne({ userId: order.userId });

    if (!wallet) {
      wallet = new Wallet({
        userId: order.userId,
        balance: 0,
        transactions: [],
      });
    }

    const refundAmount = order.finalAmount;

    const transaction = {
      type: "CREDIT",
      amount: refundAmount,
      description: `Refund for returned order #${order.orderId}`,
      orderId: order._id,
      status: "COMPLETED",
      createdAt: new Date(),
    };

    wallet.balance += refundAmount;
    wallet.transactions.push(transaction);
    await wallet.save();

    await User.findByIdAndUpdate(order.userId, { wallet: wallet._id });

    order.status = "Returned";

    for (const item of order.items) {
      if (item.status === 'Returned' || item.returnStatus === 'Approved') {
        const product = await Product.findById(item.productId);
        if (product) {
          // Validate offer data
          if (!product.productOffer) {
            product.productOffer = {
              active: false,
              discountType: 'percentage',
              discountValue: 0
            };
          } else if (
            product.productOffer.discountType !== 'percentage' &&
            product.productOffer.discountType !== 'flat'
          ) {
            product.productOffer.discountType = 'percentage'; // default fallback
          }

          product.quantity = (product.quantity || 0) + item.quantity;
          product.status = 'Available';

          await product.save();
        }
      }
    }

    await order.save();

    return {
      success: true,
      message: "Return processed and refund completed successfully",
      refundAmount: refundAmount,
    };
  } catch (error) {
    console.error("Error in processReturnRefund:", error);
    throw new Error("Something went wrong while processing the return");
  }
};


module.exports = {
  processReturnRefund,
};
