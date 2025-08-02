/**
 * Calculates refund amount based on order details and action type
 * @param {Object} order - The order object
 * @param {String} actionType - Type of action ('cancel' or 'return')
 * @returns {Object} - Contains refund amount and description
 */
const calculateRefund = (order, actionType = 'cancel') => {
    let refundAmount = 0;
    let description = '';
    
    // Calculate refund based on action type
    if (actionType === 'cancel') {
        // For cancellation, refund the full amount paid
        refundAmount = order.totalAmount;
        description = `Refund for order cancellation #${order.orderId}`;
    } else if (actionType === 'return') {
        // For returns, refund the item total minus any non-refundable amounts
        refundAmount = order.items.reduce((total, item) => {
            if (item.status === 'Returned' || item.status === 'Cancelled') {
                return total;
            }
            return total + (item.price * item.quantity);
        }, 0);
        
        // Apply any non-refundable shipping or handling fees
        if (order.shipping && order.shipping > 0) {
            refundAmount = Math.max(0, refundAmount - order.shipping);
        }
        
        description = `Refund for order return #${order.orderId}`;
    }
    
    // Ensure refund amount is not negative
    refundAmount = Math.max(0, refundAmount);
    
    return {
        amount: parseFloat(refundAmount.toFixed(2)),
        description: description
    };
};

/**
 * Formats refund description based on order and item details
 * @param {Object} order - The order object
 * @param {String} itemId - Optional item ID for partial refunds
 * @returns {String} - Formatted description
 */
const formatRefundDescription = (order, itemId = null) => {
    if (itemId) {
        const item = order.items.find(i => i._id.toString() === itemId);
        if (item) {
            return `Refund for item: ${item.productId?.productName || 'Item'} (Qty: ${item.quantity}) from order #${order.orderId}`;
        }
    }
    return `Refund for order #${order.orderId}`;
};

module.exports = {
    calculateRefund,
    formatRefundDescription
};
