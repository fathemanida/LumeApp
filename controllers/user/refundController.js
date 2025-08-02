const User = require("../../models/userSchema.js");
const Address = require("../../models/addressSchema.js");
const Cart=require("../../models/cartSchema.js")
const Product=require("../../models/productSchema.js")
const Order=require("../../models/orderSchema.js")
const walletController=require('../../controllers/user/walletController.js')
const env = require("dotenv").config();
const session = require("express-session");
const path = require("path");
const router = require("../../routes/userRoutes.js");
const Wallet = require("../../models/walletSchema.js");
const { addRefund } = require('./walletController.js');



const cancelOrder = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { orderId } = req.params;
    const { itemsToCancel = [] } = req.body;

    const order = await Order.findOne({ _id: orderId, userId })
      .populate('items.productId')
      .populate('address');
      
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // Check if order is already cancelled
    if (order.status === "Cancelled") {
      return res.status(400).json({ success: false, message: "Order is already cancelled" });
    }

    if (["Shipped", "Delivered"].includes(order.status)) {
      return res.status(400).json({ success: false, message: "Cannot cancel after shipping" });
    }

    const isFullCancel = itemsToCancel.length === 0 || itemsToCancel.length === order.items.length;

    let refundAmount = 0;
    let remainingTotal = 0;

    const returnedItems = [];
    const keptItems = [];

    // First, check if any items are already cancelled
    const alreadyCancelledItems = [];
    for (const item of order.items) {
      const shouldBeCancelled = isFullCancel || itemsToCancel.includes(item._id.toString());
      if (shouldBeCancelled && item.status === 'Cancelled') {
        alreadyCancelledItems.push({
          itemId: item._id,
          productName: item.productId?.productName || 'Unknown Product'
        });
      }
    }

    // If any items are already cancelled, return error with details
    if (alreadyCancelledItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some items are already cancelled',
        cancelledItems: alreadyCancelledItems
      });
    }

    // Process cancellation for items that need to be cancelled
    for (let item of order.items) {
      const isCancelled = isFullCancel || itemsToCancel.includes(item._id.toString());

      if (isCancelled) {
        let totalPerItem = item.finalPrice * item.quantity;

        if (item.couponDiscountPerUnit) {
          totalPerItem -= item.couponDiscountPerUnit * item.quantity;
        }

        refundAmount += totalPerItem;
        item.status = 'Cancelled';
        returnedItems.push(item);

        await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } });

      } else {
        keptItems.push(item);
        remainingTotal += item.finalPrice * item.quantity;
      }
    }

    if (
      order.coupon &&
      order.coupon.minOrderAmount &&
      remainingTotal < order.coupon.minOrderAmount
    ) {
      refundAmount -= order.coupon.discountAmount;
    }
    
    order.status = isFullCancel ? "Cancelled" : "Partialy Cancelled";

    if (order.paymentMethod !== "COD" && refundAmount > 0) {
      await addRefund({
        session: { user: { _id: userId } },
        body: {
          amount: refundAmount,
          orderId: order._id,
          description: "Order cancellation refund"
        }
      });
    }

    await order.save();

    res.json({ success: true, refund: refundAmount, message: "Order cancelled successfully" });
  } catch (error) {
    console.error("Error in cancelOrder:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};




const returnOrder = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { orderId } = req.params;
    const { itemsToReturn = [] } = req.body;

    const order = await Order.findOne({ _id: orderId, userId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (order.status !== "Delivered")
      return res.status(400).json({ success: false, message: "Only delivered orders can be returned" });

    const isFullReturn = itemsToReturn.length === 0 || itemsToReturn.length === order.items.length;

    let refundAmount = 0;
    let remainingTotal = 0;

    const returnedItems = [];
    const keptItems = [];

    for (let item of order.items) {
      const isReturned = isFullReturn || itemsToReturn.includes(item._id.toString());

      if (isReturned) {
        let totalPerItem = item.finalPrice * item.quantity;

        if (item.couponDiscountPerUnit) {
          totalPerItem -= item.couponDiscountPerUnit * item.quantity;
        }

        refundAmount += totalPerItem;
        item.status = 'Returned';
        returnedItems.push(item);

        await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } });

      } else {
        keptItems.push(item);
        remainingTotal += item.finalPrice * item.quantity;
      }
    }

    if (
      order.coupon &&
      order.coupon.minOrderAmount &&
      remainingTotal < order.coupon.minOrderAmount
    ) {
      refundAmount -= order.coupon.discountAmount;
    }

    order.status = isFullReturn ? "Returned" : "Partial Return";

    if (order.paymentMethod !== "COD" && refundAmount > 0) {
      await addRefund({
        session: { user: { _id: userId } },
        body: {
          amount: refundAmount,
          orderId: order._id,
          description: "Order return refund"
        }
      });
    }

    await order.save();

    res.json({ success: true, refund: refundAmount, message: "Items returned successfully" });
  } catch (error) {
    console.error("Error in returnOrder:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports={
    cancelOrder,
    returnOrder
}
