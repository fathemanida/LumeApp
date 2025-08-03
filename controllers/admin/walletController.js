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
        try {
          const product = await Product.findById(item.productId);
          if (!product) continue;

          // Ensure productOffer exists and has correct structure
          if (!product.productOffer) {
            product.productOffer = {
              active: false,
              discountType: 'percentage',
              discountValue: 0,
              startDate: null,
              endDate: null
            };
          } else {
            // Ensure discountType is valid
            if (typeof product.productOffer.discountType === 'number' || 
                (product.productOffer.discountType !== 'percentage' && 
                 product.productOffer.discountType !== 'flat')) {
              product.productOffer.discountType = 'percentage';
            }
            
            // Ensure all required fields exist
            product.productOffer = {
              active: product.productOffer.active || false,
              discountType: product.productOffer.discountType || 'percentage',
              discountValue: typeof product.productOffer.discountValue === 'number' ? 
                product.productOffer.discountValue : 0,
              startDate: product.productOffer.startDate || null,
              endDate: product.productOffer.endDate || null
            };
          }

          // Update product quantity and status
          product.quantity = (parseInt(product.quantity) || 0) + (parseInt(item.quantity) || 0);
          product.status = 'Available';

          // Save with validation
          await product.save({ validateBeforeSave: true });
        } catch (error) {
          console.error('Error updating product inventory during return:', {
            error: error.message,
            stack: error.stack,
            orderId: order._id,
            itemId: item._id,
            productId: item.productId,
            quantity: item.quantity
          });
          // Continue with other items even if one fails
          continue;
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
