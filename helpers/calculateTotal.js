function calculateCartTotals(cart) {
  let totalPrice = 0;
  let totalOfferDiscount = 0;
  let totalCouponDiscount = 0;
  const currentTime = new Date();

  cart.items.forEach(item => {
    const product = item.productId;

    const basePrice = product.salePrice && product.salePrice < product.regularPrice
      ? product.salePrice
      : product.regularPrice;

    const originalPrice = basePrice * item.quantity;

    item.price = basePrice;
    item.originalPrice = originalPrice;
    totalPrice += originalPrice;
  });

  cart.items.forEach(item => {
    const product = item.productId;
    const originalPrice = item.originalPrice;
    let maxOfferDiscount = 0;
    let appliedOffer = null;

    if (
      product.offer &&
      product.offer.isActive &&
      product.offer.expiryDate &&
      new Date(product.offer.expiryDate) > currentTime
    ) {
      const value = product.offer.discountValue;
      const type = product.offer.discountType;
      const discount = type === 'percentage' ? (originalPrice * value) / 100 : value;

      if (discount > maxOfferDiscount) {
        maxOfferDiscount = discount;
        appliedOffer = 'product';
      }
    }

    const categoryOffer = product.category?.categoryOffer;
    if (
      categoryOffer &&
      categoryOffer.active &&
      categoryOffer.expiryDate &&
      new Date(categoryOffer.expiryDate) > currentTime
    ) {
      const value = categoryOffer.discountValue;
      const type = categoryOffer.discountType;
      const discount = type === 'percentage' ? (originalPrice * value) / 100 : value;

      if (discount > maxOfferDiscount) {
        maxOfferDiscount = discount;
        appliedOffer = 'category';
      }
    }

    item.offerDiscount = maxOfferDiscount;
    item.appliedOffer = appliedOffer;
    totalOfferDiscount += maxOfferDiscount;
  });

  const priceAfterOffer = totalPrice - totalOfferDiscount;

  if (
    cart.couponApplied &&
    cart.couponApplied.expiryDate &&
    new Date(cart.couponApplied.expiryDate) > currentTime
  ) {
    const coupon = cart.couponApplied;

    if (coupon.discountType === 'PERCENTAGE') {
      totalCouponDiscount = (priceAfterOffer * coupon.discountValue) / 100;
      if (coupon.maxDiscount) {
        totalCouponDiscount = Math.min(totalCouponDiscount, coupon.maxDiscount);
      }
    } else {
      totalCouponDiscount = coupon.discountValue;
    }
  } else {
    cart.couponApplied = null; 
  }

  const shipping = totalPrice >= 1500 ? 0 : 40;

  const finalPrice = totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;
  console.log('final:', finalPrice, 'offer:', totalOfferDiscount, 'coupon:', totalCouponDiscount);

  cart.items.forEach(item => {
    const priceAfterOfferPerItem = item.originalPrice - item.offerDiscount;
    let itemCouponDiscount = 0;

    if (cart.couponApplied && cart.couponApplied.discountType === 'PERCENTAGE') {
      itemCouponDiscount = (priceAfterOfferPerItem * cart.couponApplied.discountValue) / 100;
    }

    item.couponDiscount = itemCouponDiscount;
    item.totalPrice = item.originalPrice - item.offerDiscount - itemCouponDiscount;
  });

  return {
    items: cart.items,
    totalPrice,
    totalOfferDiscount,
    totalCouponDiscount,
    shipping,
    finalPrice
  };
}

module.exports = calculateCartTotals;
