/**
 * Calculates the refund amount for an order
 * @param {Object} order - The order object
 * @param {String} actionType - Type of action ('cancel' or 'return')
 * @returns {Object} - Object containing refund amount and status
 */
const calculateRefund = (order, actionType = 'cancel') => {
    try {
        // Calculate refund amount based on order total and action type
        let refundAmount = 0;
        
        if (actionType === 'cancel') {
            // For cancellations, refund the full amount
            refundAmount = order.totalAmount;
        } else if (actionType === 'return') {
            // For returns, you might want to deduct restocking fees, etc.
            // This is a basic implementation - adjust according to your business logic
            refundAmount = order.totalAmount;
            
            // Example: Deduct 10% restocking fee for returns
            // const restockingFee = order.totalAmount * 0.10;
            // refundAmount = order.totalAmount - restockingFee;
        }

        return {
            success: true,
            refundAmount: Math.max(0, refundAmount), // Ensure non-negative
            status: 'processed'
        };
    } catch (error) {
        console.error('Error calculating refund:', error);
        return {
            success: false,
            error: 'Failed to calculate refund',
            status: 'failed'
        };
    }
};

/**
 * Formats the refund description for display
 * @param {Object} order - The order object
 * @param {String} actionType - Type of action ('cancel' or 'return')
 * @param {Number} refundAmount - The amount being refunded
 * @returns {String} - Formatted description
 */
const formatRefundDescription = (order, actionType, refundAmount) => {
    const action = actionType === 'cancel' ? 'cancelled' : 'returned';
    const formattedAmount = refundAmount.toFixed(2);
    
    return `Refund for order #${order.orderId} (${action}): $${formattedAmount}`;
};

module.exports = {
    calculateRefund,
    formatRefundDescription
};
