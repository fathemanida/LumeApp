const calculateCartTotals = async (cart) => {
  if (!cart || !cart.items || cart.items.length === 0) {
    return {
      items: [],
      totalPrice: 0,
      totalOfferDiscount: 0,
      totalCouponDiscount: 0,
      shipping: 0,
      finalPrice: 0
    };
  }

  let totalPrice = 0;
  let totalOfferDiscount = 0;
  let totalCouponDiscount = 0;

  cart.items.forEach(item => {
    const product = item.productId;
    const basePrice = product.salePrice && product.salePrice < product.regularPrice ? 
      product.salePrice : product.regularPrice;
    const originalPrice = basePrice * item.quantity;
    totalPrice += originalPrice;

    item.price = basePrice;
    item.originalPrice = originalPrice;
  });

  cart.items.forEach(item => {
    const product = item.productId;
    let offerDiscount = 0;
    let largestDiscount = 0;
    let appliedOffer = null;

    if (product.offer && product.offer.isActive) {
      if (product.offer.discountType === 'percentage') {
        const discountAmount = (item.originalPrice * product.offer.discountValue) / 100;
        if (discountAmount > largestDiscount) {
          largestDiscount = discountAmount;
          offerDiscount = discountAmount;
          appliedOffer = 'product';
        }
      } else {
        if (product.offer.discountValue > largestDiscount) {
          largestDiscount = product.offer.discountValue;
          offerDiscount = product.offer.discountValue;
          appliedOffer = 'product';
        }
      }
    }
    if (product.category && product.category.categoryOffer && 
        product.category.categoryOffer.active) {
      if (product.category.categoryOffer.discountType === 'percentage') {
        const discountAmount = (item.originalPrice * product.category.categoryOffer.discountValue) / 100;
        if (discountAmount > largestDiscount) {
          largestDiscount = discountAmount;
          offerDiscount = discountAmount;
          appliedOffer = 'category';
        }
      } else {
        if (product.category.categoryOffer.discountValue > largestDiscount) {
          largestDiscount = product.category.categoryOffer.discountValue;
          offerDiscount = product.category.categoryOffer.discountValue;
          appliedOffer = 'category';
        }
      }
    }

    item.offerDiscount = offerDiscount;
    item.appliedOffer = appliedOffer;
    totalOfferDiscount += offerDiscount;
  });

  if (cart.couponApplied) {
    const coupon = cart.couponApplied;
    if (coupon.discountType === 'percentage') {
      totalCouponDiscount = (totalPrice * coupon.discountValue) / 100;
      if (coupon.maxDiscount) {
        totalCouponDiscount = Math.min(totalCouponDiscount, coupon.maxDiscount);
      }
    } else {
      totalCouponDiscount = coupon.discountValue;
    }

    const totalBeforeCoupon = totalPrice;
    cart.items.forEach(item => {
      const itemProportion = item.originalPrice / totalBeforeCoupon;
      item.couponDiscount = totalCouponDiscount * itemProportion;
    });
  }

  const shipping = totalPrice >= 1500 ? 0 : 40;
  const finalPrice = totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;

  cart.items.forEach(item => {
    item.totalPrice = item.originalPrice - item.offerDiscount - (item.couponDiscount || 0);
  });

  return {
    items: cart.items,
    totalPrice,
    totalOfferDiscount,
    totalCouponDiscount,
    shipping,
    finalPrice
  };
};

module.exports = { calculateCartTotals };