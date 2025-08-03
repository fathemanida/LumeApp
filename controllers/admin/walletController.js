const Order = require("../../models/orderSchema");
const Wallet = require("../../models/walletSchema");
const User = require("../../models/userSchema");
const Product = require('../../models/productSchema');

const processReturnRefund = async (req) => {
  try {
    const { orderId,amount,userId } = req.body;

    if (!req.session.user || !req.session.user.isAdmin) {
      return {
        success: false,
        message: "Unauthorized access",
      };
    }
console.log('==processing refund,amount,orderid',orderId,userid,amount);
    const order = await Order.findById(orderId).populate("items.productId");

    if (!order) {
      return {
        success: false,
        message: "Order not found",
      };
    }

    let wallet = await Wallet.findOne({ userId: userId });

    if (!wallet) {
      wallet = new Wallet({
        userId: order.userId,
        balance: 0,
        transactions: [],
      });
    }

    const refundAmount = amount;

    const transaction = {
      type: "CREDIT",
      amount: amount,
      description: `Refund for returned order #${order.orderId}`,
      orderId: orderId,
      status: "COMPLETED",
      createdAt: new Date(),
    };

    wallet.balance += amount;
    wallet.transactions.push(transaction);
    await wallet.save();

    await User.findByIdAndUpdate(order.userId, { wallet: wallet._id });

    order.status = "Returned";

    for (const item of order.items) {
      if (item.status === 'Returned' || item.returnStatus === 'Approved') {
        try {
          const product = await Product.findById(item.productId);
          if (!product) continue;

          if (!product.productOffer) {
            product.productOffer = {
              active: false,
              discountType: 'percentage',
              discountValue: 0,
              startDate: null,
              endDate: null
            };
          } else {
            if (typeof product.productOffer.discountType === 'number') {
              console.warn(`Invalid discountType (${product.productOffer.discountType}) found for product ${product._id}, defaulting to 'percentage'`);
              product.productOffer.discountType = 'percentage';
            } else if (product.productOffer.discountType !== 'percentage' && 
                      product.productOffer.discountType !== 'flat') {
              console.warn(`Invalid discountType (${product.productOffer.discountType}) found for product ${product._id}, defaulting to 'percentage'`);
              product.productOffer.discountType = 'percentage';
            }
            
            product.productOffer = {
              active: product.productOffer.active || false,
              discountType: product.productOffer.discountType || 'percentage',
              discountValue: typeof product.productOffer.discountValue === 'number' ? 
                product.productOffer.discountValue : 0,
              startDate: product.productOffer.startDate || null,
              endDate: product.productOffer.endDate || null
            };
          }

          product.quantity = (parseInt(product.quantity) || 0) + (parseInt(item.quantity) || 0);
          product.status = 'Available';

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
