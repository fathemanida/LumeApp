const Order = require("../../models/orderSchema");
const Wallet = require("../../models/walletSchema");
const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");

const processReturnRefund = async (req) => {
  try {
    console.log('==process return refund');
    const { orderId, amount, userId, itemId } = req.body;

    console.log('====orderId,amount,userId,itemId', orderId, amount, userId, itemId);

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

    console.log('===wallet', wallet);

    const transaction = {
      type: "CREDIT",
      amount,
      description: `Refund for ${itemId ? "returned item" : "returned order"} in order #${order.orderId}`,
      orderId,
      itemId: itemId || null,
      status: "COMPLETED",
      createdAt: new Date(),
    };

    console.log('==wallet balance', wallet.balance);
    wallet.balance += amount;
    wallet.transactions.push(transaction);
    await wallet.save();
    console.log('=amount', amount);

    await User.findByIdAndUpdate(userId, { wallet: wallet._id });

    if (itemId) {
      const returnedItem = order.items.find((item) => item._id.equals(itemId));
      console.log('==item', returnedItem);

      if (returnedItem) {
        returnedItem.status = "Returned";
        returnedItem.returnStatus = "Approved";
        console.log('==status changed', returnedItem.status);
      }

      const allReturned = order.items.every((item) => item.status === "Returned");
      if (allReturned) {
        order.status = "Returned";
      }

    } else {
      order.items.forEach((item) => {
        item.status = "Returned";
        item.returnStatus = "Approved";
      });
      order.status = "Returned";
    }

    await order.save();

    return {
      success: true,
      message: itemId
        ? "Item refund processed successfully"
        : "Full order refund processed successfully",
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
