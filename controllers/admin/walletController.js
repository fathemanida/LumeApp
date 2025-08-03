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

          // Ensure productOffer exists and has valid values
          const validDiscountTypes = ['percentage', 'flat'];
          
          // Initialize productOffer if it doesn't exist
          if (!product.productOffer) {
            product.productOffer = {
              active: false,
              discountType: 'percentage',
              discountValue: 0,
              startDate: null,
              endDate: null
            };
          } else {
            // Validate and normalize discountType
            let discountType = 'percentage'; // Default value
            
            // If discountType is a valid string, use it; otherwise, log a warning and use default
            if (typeof product.productOffer.discountType === 'string' && 
                validDiscountTypes.includes(product.productOffer.discountType)) {
              discountType = product.productOffer.discountType;
            } else if (product.productOffer.discountType !== undefined) {
              console.warn(`Invalid discountType (${product.productOffer.discountType}) found for product ${product._id}, defaulting to 'percentage'`);
            }
            
            // Ensure discountValue is a valid number
            const discountValue = typeof product.productOffer.discountValue === 'number' && 
                                !isNaN(product.productOffer.discountValue) ?
                                Math.max(0, product.productOffer.discountValue) : 0;
            
            // Rebuild productOffer with validated values
            product.productOffer = {
              active: !!product.productOffer.active,
              discountType: discountType,
              discountValue: discountValue,
              startDate: product.productOffer.startDate instanceof Date ? 
                        product.productOffer.startDate : null,
              endDate: product.productOffer.endDate instanceof Date ? 
                      product.productOffer.endDate : null
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
