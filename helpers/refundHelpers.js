/**
 * Calculates the refund amount for an order
 * @param {Object} order - The order object
 * @param {String} actionType - Type of action ('cancel' or 'return')
 * @returns {Object} - Object containing refund amount and status
 */
const calculateRefund = (order, actionType = 'cancel') => {
    try {
        let refundAmount = 0;
        
        if (actionType === 'cancel') {
            refundAmount = order.totalAmount;
        } else if (actionType === 'return') {
           
            refundAmount = order.totalAmount;
           
        }

        return {
            success: true,
            refundAmount: Math.max(0, refundAmount), 
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


const formatRefundDescription = (order, actionType, refundAmount) => {
    const action = actionType === 'cancel' ? 'cancelled' : 'returned';
    const formattedAmount = refundAmount.toFixed(2);
    
    return `Refund for order #${order.orderId} (${action}): $${formattedAmount}`;
};

module.exports = {
    calculateRefund,
    formatRefundDescription
};
