const Order = require("../../models/orderSchema");
const Wallet = require("../../models/walletSchema");
const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");

const processReturnRefund = async (req) => {
  try {
    console.log('==process return refund');
    const { orderId, amount, userId, itemId } = req.body;

    if (!req.session.user || !req.session.user.isAdmin) {
      return {
        success: false,
        message: "Unauthorized access",
      };
    }

    const order = await Order.findById(orderId).populate("items.productId");

    if (!order) {
      return { success: false, message: "Order not found" };
    }

    let wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      wallet = new Wallet({
        userId,
        balance: 0,
        transactions: [],
      });
    }

    const transaction = {
      type: "CREDIT",
      amount: amount,
      description: `Refund for returned item in order #${order.orderId}`,
      orderId,
      itemId,
      status: "COMPLETED",
      createdAt: new Date(),
    };
console.log('==wallet balance',wallet.balance);
    wallet.balance += amount;
    wallet.transactions.push(transaction);
    await wallet.save();
console.log('=amount',amount);
    await User.findByIdAndUpdate(userId, { wallet: wallet._id });

    const returnedItem = order.items.find((item) => item._id.toString() === itemId);

    if (returnedItem) {
      returnedItem.status = "Returned";
      returnedItem.returnStatus = "Approved";

      const product = await Product.findById(returnedItem.productId);

      if (product) {
        console.log('Product before update:', JSON.stringify({
          productId: product._id,
          productOffer: product.productOffer,
          quantity: product.quantity
        }, null, 2));

        product.quantity = (parseInt(product.quantity) || 0) + (parseInt(returnedItem.quantity) || 0);
        product.status = 'Available';

        if (product.productOffer) {
          console.log('Product offer before update:', product.productOffer);
          
          if (typeof product.productOffer.discountType === 'number') {
            product.productOffer.discountType = product.productOffer.discountType === 0 ? 'percentage' : 'flat';
          } 
          else if (!product.productOffer.discountType || 
                  !['percentage', 'flat'].includes(product.productOffer.discountType)) {
            product.productOffer.discountType = 'percentage';
          }
          
          console.log('Product offer after update:', product.productOffer);
        }

        try {
          await product.save();
          console.log('Product updated successfully');
        } catch (saveError) {
          console.error('Error saving product:', saveError);
          if (saveError.name === 'ValidationError' && saveError.errors && saveError.errors['productOffer.discountType']) {
            console.log('Attempting to fix discountType validation error');
            if (product.productOffer) {
              delete product.productOffer.discountType; 
              product.productOffer.discountType = 'percentage';
              await product.save({ validateBeforeSave: false });
              console.log('Product saved with fixed discountType');
            }
          } else {
            throw saveError; 
          }
        }
      }
    }

    const allReturned = order.items.every((item) => item.status === 'Returned');
    if (allReturned) {
      order.status = 'Returned';
    }

    await order.save();

    return {
      success: true,
      message: "Item refund processed successfully",
      refundAmount: amount,
    };

  } catch (error) {
    console.error("Error in processReturnRefund:", error);
    throw new Error("Something went wrong while processing the return");
  }
};


module.exports = {
  processReturnRefund,
};
