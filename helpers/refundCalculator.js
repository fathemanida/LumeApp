
const calculateRefund = async (order, itemsToRefund = [], refundType = 'cancellation') => {
  try {
    if (order.paymentMethod === 'COD') {
      return {
        success: false,
        message: 'COD orders do not require refund processing',
        totalRefund: 0,
        refundType: refundType
      };
    }

    const isFullOrderRefund = itemsToRefund.length === 0 || itemsToRefund.length === order.items.length;
    
    const itemsToProcess = itemsToRefund.length === 0 
      ? order.items 
      : order.items.filter(item => itemsToRefund.includes(item.productId._id.toString()));

    let refundBreakdown = {
      success: true,
      items: [],
      subtotal: 0,
      offerDiscount: 0,
      couponDiscount: 0,
      shippingRefund: 0,
      totalRefund: 0,
      isFullOrder: isFullOrderRefund,
      refundType: refundType
    };

    for (const item of itemsToProcess) {
      const quantity = item.quantity;
      
      const originalPrice = item.originalPrice || (item.price * quantity);
      const offerDiscount = item.appliedOffer ? item.appliedOffer.discountAmount : 0;
      const couponDiscount = item.totalCouponDiscount || (item.couponPerUnit * quantity);
      const finalPrice = item.finalPrice || (originalPrice - offerDiscount - couponDiscount);

      refundBreakdown.items.push({
        productId: item.productId,
        quantity: quantity,
        originalPrice: originalPrice,
        offerDiscount: offerDiscount,
        couponDiscount: couponDiscount,
        finalPrice: finalPrice,
        refundAmount: finalPrice 
      });

      refundBreakdown.subtotal += originalPrice;
      refundBreakdown.offerDiscount += offerDiscount;
      refundBreakdown.couponDiscount += couponDiscount;
    }

    if (isFullOrderRefund) {
      refundBreakdown.shippingRefund = order.shipping || 0;
    }

    refundBreakdown.totalRefund = refundBreakdown.subtotal - refundBreakdown.offerDiscount - refundBreakdown.couponDiscount + refundBreakdown.shippingRefund;

    refundBreakdown.totalRefund = Math.max(0, refundBreakdown.totalRefund);

    return refundBreakdown;

  } catch (error) {
    console.error('Error calculating refund:', error);
    throw new Error('Failed to calculate refund amount');
  }
};


/**
 * Format refund breakdown for display
 * @param {Object} refundBreakdown - Refund calculation result
 * @returns {String} Formatted refund description
 */
const formatRefundDescription = (refundBreakdown) => {
  const { refundType, isFullOrder, totalRefund } = refundBreakdown;
  const action = refundType === 'cancellation' ? 'cancelled' : 'returned';
  const scope = isFullOrder ? 'order' : 'item(s)';
  
  return `Refund for ${action} ${scope} - Amount: ₹${totalRefund.toFixed(2)}`;
};

module.exports = {
  calculateRefund,
  formatRefundDescription
};
