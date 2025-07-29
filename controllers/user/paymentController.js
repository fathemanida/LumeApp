const User=require('../../models/userSchema');
const Order=require('../../models/orderSchema');
const Product=require('../../models/productSchema');
const Cart=require('../../models/cartSchema');
const Address = require('../../models/addressSchema');
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const router = require("../../routes/userRoutes");
const { error } = require("console");
const crypto = require('crypto');
const Coupon = require('../../models/couponSchema');
const calculateCartTotals = require('../../helpers/calculateTotal');
const Wallet = require('../../models/walletSchema');


const Razorpay = require('razorpay');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
  test_mode: true
});

const createOrder = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { addressId, paymentMethod } = req.body;

    if (!addressId) {
      return res.status(400).json({ success: false, message: 'Address is required' });
    }

    const cart = await Cart.findOne({ userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'offer' },
          { path: 'category', populate: { path: 'categoryOffer' } }
        ]
      })
      .populate('appliedCoupon');

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Your cart is empty' });
    }

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalCouponDiscount = 0;
    const now = new Date();

    cart.items.forEach(item => {
      const product = item.productId;
      const quantity = item.quantity;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;

      const originalPrice = basePrice * quantity;

      let productOfferDiscount = 0;
      if (product.offer?.isActive && 
          (!product.offer.startDate || new Date(product.offer.startDate) <= now) &&
          (!product.offer.expiryDate || new Date(product.offer.expiryDate) >= now)) {
        if (product.offer.discountType === 'percentage') {
          productOfferDiscount = (originalPrice * product.offer.discountValue) / 100;
        } else {
          productOfferDiscount = product.offer.discountValue * quantity;
        }
      }

      let categoryOfferDiscount = 0;
      if (product.category?.categoryOffer?.active &&
          (!product.category.categoryOffer.startDate || new Date(product.category.categoryOffer.startDate) <= now) &&
          (!product.category.categoryOffer.expiryDate || new Date(product.category.categoryOffer.expiryDate) >= now)) {
        if (product.category.categoryOffer.discountType === 'percentage') {
          categoryOfferDiscount = (originalPrice * product.category.categoryOffer.discountValue) / 100;
        } else {
          categoryOfferDiscount = product.category.categoryOffer.discountValue * quantity;
        }
      }

      const offerDiscount = Math.max(productOfferDiscount, categoryOfferDiscount);
      const priceAfterOffer = originalPrice - offerDiscount;

      item.originalPrice = originalPrice;
      item.basePrice = basePrice;
      item.priceAfterOffer = priceAfterOffer;
      item.offerDiscount = offerDiscount;
      item.appliedOffer = productOfferDiscount >= categoryOfferDiscount
        ? (product.offer?.isActive ? {
            offerId: product.offer._id,
            offerType: 'product',
            offerName: product.offer.name || '',
            discountType: product.offer.discountType,
            discountValue: product.offer.discountValue,
            discountAmount: productOfferDiscount
          } : null)
        : (product.category?.categoryOffer?.active ? {
            offerId: product.category.categoryOffer._id,
            offerType: 'category',
            offerName: product.category.categoryOffer.name || '',
            discountType: product.category.categoryOffer.discountType,
            discountValue: product.category.categoryOffer.discountValue,
            discountAmount: categoryOfferDiscount
          } : null);

      totalPrice += originalPrice;
      totalOfferDiscount += offerDiscount;
    });

    if (cart.appliedCoupon) {
      const priceAfterOffer = totalPrice - totalOfferDiscount;
      if (cart.appliedCoupon.discountType === 'PERCENTAGE') {
        totalCouponDiscount = (priceAfterOffer * cart.appliedCoupon.discountValue) / 100;
        if (cart.appliedCoupon.maxDiscount) {
          totalCouponDiscount = Math.min(totalCouponDiscount, cart.appliedCoupon.maxDiscount);
        }
      } else {
        totalCouponDiscount = cart.appliedCoupon.discountValue;
      }
    }

    const totalPriceAfterOffer = cart.items.reduce((sum, item) => sum + item.priceAfterOffer, 0);
    cart.items.forEach(item => {
      const itemCouponShare = totalCouponDiscount > 0 && totalPriceAfterOffer > 0
        ? (item.priceAfterOffer / totalPriceAfterOffer) * totalCouponDiscount
        : 0;
      item.couponPerUnit = item.quantity > 0 ? itemCouponShare / item.quantity : 0;
      item.totalCouponDiscount = itemCouponShare;
      item.finalPrice = item.priceAfterOffer - itemCouponShare;
    });

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalAmount = totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;

    const itemsForOrder = cart.items.map(item => {
      const product = item.productId;
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;
      
      const originalPrice = basePrice * item.quantity;
      const finalPrice = item.finalPrice || originalPrice;
      const finalPricePerUnit = finalPrice / item.quantity;
      
      // Format the offer data to match the schema
      let appliedOffer = null;
      if (item.appliedOffer) {
        appliedOffer = {
          offerId: item.appliedOffer._id || null,
          offerType: item.appliedOffer.offerType || 'product',
          offerName: item.appliedOffer.name || 'Special Offer',
          discountType: item.appliedOffer.discountType || 'fixed',
          discountValue: item.appliedOffer.discountValue || 0,
          discountAmount: item.appliedOffer.discountAmount || 0
        };
      }
      
      return {
        productId: product._id,
        quantity: item.quantity,
        originalPrice: originalPrice,
        price: basePrice,
        appliedOffer: appliedOffer,
        couponPerUnit: item.couponPerUnit || 0,
        totalCouponDiscount: item.totalCouponDiscount || 0,
        finalPrice: finalPricePerUnit,
        status: 'Active',
        createdAt: new Date(),
        updatedAt: new Date()
      };
    });

    const couponData = cart.appliedCoupon ? {
      code: cart.appliedCoupon.code,
      discount: cart.appliedCoupon.discountValue,
      type: cart.appliedCoupon.discountType,
      maxDiscount: cart.appliedCoupon.maxDiscount
    } : null;

    const orderData = {
      userId,
      status: 'Pending',
      paymentStatus: 'Pending',
      paymentMethod: paymentMethod === 'Razorpay' ? 'Razorpay' : paymentMethod === 'COD' ? 'COD' : 'ONLINE',
      items: itemsForOrder,
      totalAmount: finalAmount,
      address: addressId,
      paymentDetails: {
        method: paymentMethod,
        status: 'Pending',
        amount: finalAmount,
        currency: 'INR',
        createdAt: new Date()
      },
      orderDate: new Date(),
      couponDiscount: totalCouponDiscount,
      offerDiscount: totalOfferDiscount,
      shipping: shipping,
      subtotal: totalPrice,
      appliedCoupon: cart.appliedCoupon?._id || null,
      couponApplied: !!cart.appliedCoupon,
      coupon: couponData,
      razorpayOrderId: paymentMethod === 'Razorpay' ? `order_${require('crypto').randomBytes(8).toString('hex')}` : null,
      orderId: `ORD${Date.now()}`,
      createdOn: new Date(),
      updatedAt: new Date(),
      estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) // 5 days from now
    };

    const order = new Order(orderData);

    for (const item of cart.items) {
      const product = item.productId;
      if (product) {
        const newStock = (product.quantity || 0) - item.quantity;
        await Product.findByIdAndUpdate(product._id, {
          quantity: newStock < 0 ? 0 : newStock,
          status: newStock > 0 ? 'Available' : 'Out of Stock'
        });
      }
    }

    if (paymentMethod === 'Razorpay') {
      const amountInPaise = Math.round(finalAmount * 100);
      const razorpayOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: order._id.toString(),
        payment_capture: 1
      });
      order.razorpayOrderId = razorpayOrder.id;
      await order.save();

      return res.status(200).json({
        success: true,
        orderId: order._id,
        razorpayOrderId: razorpayOrder.id,
        currency: razorpayOrder.currency,
        amount: razorpayOrder.amount
      });
    } else if (paymentMethod === 'COD' || paymentMethod === 'Wallet') {
      order.status = 'Processing';
      order.paymentStatus = paymentMethod === 'COD' ? 'Pending' : 'Paid';
      await order.save();

      await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [], appliedCoupon: null } }
      );

      return res.status(200).json({
        success: true,
        orderId: order._id,
        redirect: `/payment-confirmation?orderId=${order._id}`
      });
    }

  } catch (error) {
    console.error('Error in createOrder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};




const paymentMethod = async (req, res) => {
  try {
    const userId=req.session.user.id

    const user = await User.findById(userId);
  const cart = await Cart.findOne({ userId })
      .populate({
        path: "items.productId",
        populate: [
          { path: "offer" },
          { path: "category", populate: { path: "categoryOffer" } },
        ],
      })
      .populate("appliedCoupon");    console.log('=====cartData',cart);
    console.log('=====user',user);

    if (!cart || cart.items.length === 0) {
      return res.redirect('/cart');
    }

    let totalPrice = 0;
    let totalOfferDiscount = 0;

    const updatedItems = [];

    for (const item of cart.items) {
      const product = item.productId;
      if (!product || !product.isListed) continue;

      const quantity = item.quantity;
      const actualPrice = product.price;

      const bestOffer = await getBestOffer(product); 
      const offerDiscount = bestOffer?.discount || 0;
      const discountedPrice = actualPrice - offerDiscount;
     console.log('======bestoffer',bestOffer);
          console.log('======offerDiscoun',offerDiscount);
               console.log('======discoutprce',discountedPrice);


      totalPrice += actualPrice * quantity;
      totalOfferDiscount += offerDiscount * quantity;



           console.log('======totalprice',totalPrice);
     console.log('======totalofferdic',totalOfferDiscount);

      updatedItems.push({
        product,
        quantity,
        actualPrice,
        discountedPrice,
        offerDiscount
      });
    }

    let couponDiscount = 0;
    let appliedCoupon = null;

    if (cart.appliedCoupon) {
      const coupon = await Coupon.findOne({ code: cart.appliedCoupon });

      const isUsed = user.usedCoupons?.some(
        (c) => c.code === coupon.code
      );

      if (
        coupon &&
        coupon.isActive &&
        coupon.expiry > new Date() &&
        !isUsed &&
        totalPrice - totalOfferDiscount >= coupon.minAmount
      ) {
        appliedCoupon = coupon.code;
        couponDiscount = coupon.discountAmount;
      }
    }

    const shipping = totalPrice <1500?40:0;
    const finalPrice = totalPrice - totalOfferDiscount - couponDiscount + shipping;

    res.render('payment', {
      items: updatedItems,
      totalPrice,
      totalOfferDiscount,
      couponDiscount,
      finalPrice,
      shipping,
      appliedCoupon,
      user,
      cart
    });

  } catch (error) {
    console.error('Payment page error:', error);
    res.status(500).send('Something went wrong');
  }
};






const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      orderId,
      addressId
    } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment credentials',
        redirect: `/payment-failed?orderId=${orderId}&error=Missing payment credentials`
      });
    }

    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Signature verification failed',
        redirect: `/payment-failed?orderId=${orderId}&error=Payment verification failed`
      });
    }

    const order = await Order.findById(orderId)
      .populate('appliedCoupon')
      .populate('userId');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
        redirect: '/payment-failed?error=Order not found'
      });
    }

    if (order.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: 'Order ID mismatch',
        redirect: `/payment-failed?orderId=${orderId}&error=Order ID mismatch`
      });
    }

    order.paymentStatus = 'Paid';
    order.status = 'Processing';
    order.paymentDetails = {
      razorpay: {
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        signature: razorpay_signature,
        verifiedAt: new Date()
      },
      method: 'Razorpay',
      status: 'Completed',
      amount: order.totalAmount,
      currency: 'INR',
      paidAt: new Date()
    };

    if (addressId) {
      order.address = addressId;
    }

    order.items = order.items.map(item => ({
      ...item.toObject(),
      status: 'Processing',
      updatedAt: new Date()
    }));

    await order.save();

    if (order.appliedCoupon) {
      try {
        const coupon = order.appliedCoupon;
        const now = new Date();

        const isValidTime =
          (!coupon.validFrom || now >= coupon.validFrom) &&
          (!coupon.validUntil || now <= coupon.validUntil);

        if (isValidTime) {
          const couponCode = coupon.code.toUpperCase();

          await User.findByIdAndUpdate(order.userId, {
            $addToSet: {
              usedCoupons: {
                code: couponCode,
                usedOn: now,
                orderId: order._id
              }
            }
          });

          await Coupon.findByIdAndUpdate(coupon._id, {
            $inc: { usageCount: 1 },
            $addToSet: { usedBy: order.userId },
            lastUsedAt: now
          });
        } else {
          console.warn(`Coupon '${coupon.code}' used but was expired or not yet valid.`);
        }
      } catch (error) {
        console.error('Error updating coupon usage:', error);
      }
    }

    if (req.session.user) {
      await Cart.findOneAndUpdate(
        { userId: req.session.user.id },
        {
          $set: {
            items: [],
            discount: 0,
            appliedCoupon: null,
            updatedAt: new Date()
          }
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      orderId: order._id,
      redirect: `/payment-confirmation?orderId=${order._id}`
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      redirect: `/payment-failed?orderId=${req.body?.orderId}&error=Payment processing failed`
    });
  }
};


const processPayment = async (req, res) => {
  try {
    const userId = req.session.user._id;
    
    // First, get the cart with basic population
    let cartData = await Cart.findOne({ user: userId })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'category', model: 'Category' },
          { path: 'offer', model: 'Offer' }
        ]
      })
      .populate('appliedCoupon');

    console.log('=====cart Data before processing', JSON.stringify(cartData, null, 2));
    
    if (!cartData || !cartData.items || cartData.items.length === 0) {
      console.log('No items in cart or cart not found');
      return res.status(400).json({ success: false, message: "Your cart is empty" });
    }
    
    // Filter out any items where product is null or undefined
    cartData.items = cartData.items.filter(item => item.productId);
    
    if (cartData.items.length === 0) {
      console.log('All items in cart are invalid');
      return res.status(400).json({ success: false, message: "Your cart contains invalid items" });
    }

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalCouponDiscount = 0;
    const now = new Date();
    
    // Get all active offers
    const activeOffers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });

    // First pass: Calculate base prices and original prices
    for (const item of cartData.items) {
      const product = item.productId;
      if (!product) continue;
      
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;
      
      // Ensure price is a valid number
      item.price = parseFloat(basePrice) || 0;
      item.originalPrice = (parseFloat(basePrice) * parseInt(item.quantity)) || 0;
      totalPrice += item.originalPrice;
      
      // Initialize offer discount if not present
      item.offerDiscount = 0;
      item.finalPrice = item.originalPrice;
    }
    
    // Second pass: Calculate offer discounts
    for (const item of cartData.items) {
      const product = item.productId;
      if (!product) continue;
      
      let maxOfferDiscount = 0;
      let bestOffer = null;
      let offerType = null;

      // Check product-specific offers first
      if (product.offer && 
          product.offer.isActive && 
          product.offer.startDate <= now && 
          product.offer.endDate >= now) {
        
        const value = parseFloat(product.offer.discountValue) || 0;
        const type = product.offer.discountType;
        let discount = 0;
        
        if (type === 'percentage') {
          discount = (item.originalPrice * value) / 100;
          // Apply max discount if specified
          if (product.offer.maxDiscount && discount > product.offer.maxDiscount) {
            discount = product.offer.maxDiscount;
          }
        } else {
          // Flat discount
          discount = value * item.quantity;
        }
        
        if (discount > 0) {
          maxOfferDiscount = discount;
          bestOffer = product.offer;
          offerType = 'product';
        }
      }

      const categoryOffer = product.category?.categoryOffer;
      // Check category offers if no product offer or for better category offer
      if (product.category?.categoryOffer?.isActive &&
          product.category.categoryOffer.startDate <= now &&
          product.category.categoryOffer.endDate >= now) {
        
        const value = parseFloat(product.category.categoryOffer.discountValue) || 0;
        const type = product.category.categoryOffer.discountType;
        let discount = 0;
        
        if (type === 'percentage') {
          discount = (item.originalPrice * value) / 100;
          // Apply max discount if specified
          if (product.category.categoryOffer.maxDiscount && discount > product.category.categoryOffer.maxDiscount) {
            discount = product.category.categoryOffer.maxDiscount;
          }
        } else {
          // Flat discount
          discount = value * item.quantity;
        }
        
        if (discount > maxOfferDiscount) {
          maxOfferDiscount = discount;
          bestOffer = product.category.categoryOffer;
          offerType = 'category';
        }
      }
      
      // Check global offers if no better offer found
      for (const offer of activeOffers) {
        if (offer.applicableOn === 'all' || 
            (offer.applicableOn === 'categories' && offer.categories.includes(product.category?._id?.toString())) ||
            (offer.applicableOn === 'products' && offer.products.includes(product._id.toString()))) {
          
          const value = parseFloat(offer.discountValue) || 0;
          const type = offer.discountType;
          let discount = 0;
          
          if (type === 'percentage') {
            discount = (item.originalPrice * value) / 100;
            // Apply max discount if specified
            if (offer.maxDiscount && discount > offer.maxDiscount) {
              discount = offer.maxDiscount;
            }
          } else {
            // Flat discount
            discount = value * item.quantity;
          }
          
          if (discount > maxOfferDiscount) {
            maxOfferDiscount = discount;
            bestOffer = offer;
            offerType = 'global';
          }
        }
      }
      
      // Apply the best offer found
      if (maxOfferDiscount > 0 && bestOffer) {
        item.offerDiscount = Math.min(maxOfferDiscount, item.originalPrice);
        item.appliedOffer = {
          offerId: bestOffer._id,
          offerType: offerType,
          discountType: bestOffer.discountType,
          discountValue: bestOffer.discountValue,
          discountAmount: item.offerDiscount
        };
        item.finalPrice = Math.max(0, item.originalPrice - item.offerDiscount);
        totalOfferDiscount += item.offerDiscount;
      }

      // Apply the best offer found
      if (maxOfferDiscount > 0 && bestOffer) {
        item.offerDiscount = Math.min(maxOfferDiscount, item.originalPrice);
        item.appliedOffer = {
          offerId: bestOffer._id,
          offerType: offerType,
          discountType: bestOffer.discountType,
          discountValue: bestOffer.discountValue,
          discountAmount: item.offerDiscount
        };
        item.finalPrice = Math.max(0, item.originalPrice - item.offerDiscount);
        totalOfferDiscount += item.offerDiscount;
      } else {
        item.finalPrice = item.originalPrice;
      }
    }

    // Calculate price after offer discounts
    const priceAfterOffer = Math.max(0, totalPrice - totalOfferDiscount);
    
    // Apply coupon discount if valid
    if (cartData.appliedCoupon) {
      const coupon = cartData.appliedCoupon;
      const isCouponValid = !coupon.validTill || new Date(coupon.validTill) >= now;
      
      if (isCouponValid) {
        if (coupon.discountType === 'PERCENTAGE') {
          totalCouponDiscount = (priceAfterOffer * (coupon.discountValue || 0)) / 100;
          if (coupon.maxDiscount) {
            totalCouponDiscount = Math.min(totalCouponDiscount, coupon.maxDiscount);
          }
        } else {
          totalCouponDiscount = Math.min(coupon.discountValue || 0, priceAfterOffer);
        }
        
        // Distribute coupon discount proportionally across items
        const totalDiscountableAmount = cartData.items.reduce((sum, item) => {
          return sum + Math.max(0, item.finalPrice);
        }, 0);
        
        if (totalDiscountableAmount > 0) {
          let remainingCouponDiscount = totalCouponDiscount;
          
          // First pass: Calculate proportional discount for each item
          cartData.items.forEach((item, index) => {
            if (index === cartData.items.length - 1) {
              // Last item gets remaining discount to avoid floating point issues
              item.couponDiscount = Math.min(remainingCouponDiscount, item.finalPrice);
            } else {
              const itemRatio = item.finalPrice / totalDiscountableAmount;
              item.couponDiscount = parseFloat((totalCouponDiscount * itemRatio).toFixed(2));
              remainingCouponDiscount -= item.couponDiscount;
            }
            
            // Ensure final price is never negative
            item.finalPrice = Math.max(0, item.finalPrice - item.couponDiscount);
          });
        }
      } else {
        // Coupon expired, remove it
        cartData.appliedCoupon = null;
        cartData.couponDiscount = 0;
      }
    }
    
    // Calculate shipping (free for orders over 1500)
    const shipping = totalPrice >= 1500 ? 0 : 40;
    
    // Recalculate totals to ensure consistency
    const recalculatedSubtotal = cartData.items.reduce((sum, item) => 
      sum + (item.price * item.quantity), 0);
    const recalculatedOfferDiscount = cartData.items.reduce((sum, item) => 
      sum + (item.offerDiscount || 0), 0);
    const recalculatedCouponDiscount = cartData.items.reduce((sum, item) => 
      sum + (item.couponDiscount || 0), 0);
    
    const finalPrice = Math.max(0, 
      recalculatedSubtotal - recalculatedOfferDiscount - recalculatedCouponDiscount + shipping
    );
    
    // Update cart with calculated values
    cartData.cartTotal = recalculatedSubtotal;
    cartData.totalOfferDiscount = recalculatedOfferDiscount;
    cartData.couponDiscount = recalculatedCouponDiscount;
    cartData.finalCartTotal = finalPrice;
    
    // Save the updated cart
    await cartData.save();
    
    // Prepare the response
    const response = {
      success: true,
      cart: {
        _id: cartData._id,
        userId: cartData.userId,
        items: cartData.items.map(item => ({
          _id: item._id,
          productId: item.productId._id,
          product: {
            _id: item.productId._id,
            name: item.productId.name,
            price: item.price,
            images: item.productId.images,
            slug: item.productId.slug,
            category: item.productId.category
          },
          quantity: item.quantity,
          size: item.size,
          price: item.price,
          originalPrice: item.originalPrice,
          offerDiscount: item.offerDiscount || 0,
          couponDiscount: item.couponDiscount || 0,
          finalPrice: item.finalPrice,
          appliedOffer: item.appliedOffer || null
        })),
        appliedCoupon: cartData.appliedCoupon ? {
          _id: cartData.appliedCoupon._id,
          code: cartData.appliedCoupon.code,
          discountType: cartData.appliedCoupon.discountType,
          discountValue: cartData.appliedCoupon.discountValue,
          maxDiscount: cartData.appliedCoupon.maxDiscount,
          minOrderAmount: cartData.appliedCoupon.minOrderAmount
        } : null,
        cartTotal: cartData.cartTotal,
        totalOfferDiscount: cartData.totalOfferDiscount,
        couponDiscount: cartData.couponDiscount,
        finalCartTotal: cartData.finalCartTotal,
        createdAt: cartData.createdAt,
        updatedAt: cartData.updatedAt
      },
      totals: {
        subtotal: cartData.cartTotal,
        offerDiscount: cartData.totalOfferDiscount,
        couponDiscount: cartData.couponDiscount,
        shipping: shipping,
        total: cartData.finalCartTotal
      }
    };

    console.log('Processed payment data:', JSON.stringify(response, null, 2));
    return res.json(response);
  } catch (error) {
    console.error("Error in processPayment:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


const paymentConfirmation = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user.id;
    const { orderId } = req.query;

    if (!orderId) {
      console.log('❌ No order ID provided');
      return res.redirect('/orders');
    }

    console.log('🧾 Fetching order confirmation for user:', userId, 'Order ID:', orderId);

    const order = await Order.findOne({ _id: orderId, userId })
      .populate({
        path: 'items.productId',
        select: 'productName productImage regularPrice salePrice category offer',
        populate: [
          { 
            path: 'category', 
            select: 'name categoryOffer',
            populate: { 
              path: 'categoryOffer',
              select: 'name discountType discountValue active startDate expiryDate'
            } 
          },
          { 
            path: 'offer',
            select: 'name discountType discountValue isActive startDate expiryDate'
          }
        ]
      })
      .populate({
        path: 'address',
        select: 'name houseNo roadArea city state pincode phone isDefault'
      })
      .populate({
        path: 'appliedCoupon',
        select: 'code discountType discountValue maxDiscount'
      })
      .lean();

    if (!order) {
      console.log('❌ Order not found or does not belong to user.');
      return res.redirect('/orders');
    }

    console.log(`✅ Order ${order._id} found for user ${userId}`);
    
    const formattedItems = order.items.map(item => {
      const product = item.productId || {};
      const quantity = item.quantity || 1;
      
      const basePrice = product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice || 0;
      
      const originalPrice = basePrice * quantity;
      
      const offerDetails = item.appliedOffer ? {
        type: item.appliedOffer.offerType,
        name: item.appliedOffer.offerName,
        discountType: item.appliedOffer.discountType,
        discountValue: item.appliedOffer.discountValue,
        discountAmount: item.appliedOffer.discountAmount || 0
      } : null;

      const finalPricePerUnit = item.finalPrice || basePrice;
      const totalFinalPrice = finalPricePerUnit * quantity;
      
      const savings = originalPrice - totalFinalPrice;
      
      return {
        id: item._id,
        productId: product._id,
        name: product.productName || 'Product not available',
        image: product.productImage?.[0] || '/images/no-image.png',
        quantity,
        originalPrice: item.originalPrice || originalPrice,
        basePrice,
        price: finalPricePerUnit, 
        total: totalFinalPrice,   
        savings: savings > 0 ? savings : 0,
        status: item.status || 'Processing',
        appliedOffer: offerDetails,
        couponDiscount: item.couponPerUnit ? {
          perUnit: item.couponPerUnit,
          total: item.totalCouponDiscount || 0
        } : null,
        canCancel: ['Processing', 'Pending', 'Confirmed'].includes(item.status || 'Processing'),
        canReturn: item.status === 'Delivered' && 
                  (!item.returnRequested && !item.returnStatus)
      };
    });

    const subtotal = formattedItems.reduce((sum, item) => sum + (item.basePrice * item.quantity), 0);
    const totalDiscount = order.offerDiscount + order.couponDiscount;
    const shipping = order.shipping || (subtotal >= 1500 ? 0 : 40);
    const totalAmount = order.totalAmount || (subtotal - totalDiscount + shipping);

    const orderSummary = {
      orderNumber: order.orderNumber || `#${order._id.toString().slice(-6).toUpperCase()}`,
      orderDate: order.orderDate || order.createdAt,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      subtotal,
      discount: totalDiscount,
      shipping,
      total: totalAmount,
      itemsCount: formattedItems.reduce((sum, item) => sum + item.quantity, 0),
      estimatedDelivery: order.estimatedDelivery
        ? new Date(order.estimatedDelivery).toLocaleDateString()
        : 'Within 5-7 business days'
    };

    const responseData = {
      user: req.session.user,
      order: {
        ...orderSummary,
        items: formattedItems,
        address: order.address,
        canCancel: ['Pending', 'Processing', 'Confirmed'].includes(order.status),
        canTrack: ['Processing', 'Shipped', 'Out for Delivery'].includes(order.status),
        paymentDetails: order.paymentDetails || {}
      },
      showSuccess: req.query.success === 'true',
      successMessage: 'Your order has been placed successfully!',
      showError: req.query.error,
      errorMessage: req.query.error || ''
    };

    console.log(`📦 Order ${order._id} confirmation page loaded successfully`);
    
    res.render('orderConfirmation', responseData);

  } catch (error) {
    console.error('❗ Error in paymentConfirmation:', error);
    
    res.status(500).render('error', { 
      message: 'Something went wrong while loading your order details.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      user: req.session.user || null,
      showBackButton: true,
      backUrl: '/orders'
    });
  }
};


const paymentFailure = async (req, res) => {
  try {
    const { orderId, error } = req.query;
    
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        status: 'Failed',
        paymentStatus: 'Failed',
        paymentError: error || 'Payment failed'
      });
    }

    res.render('paymentFailed', {
      user: req.session.user,
      error: error || 'Payment could not be processed',
      orderId
    });
  } catch (error) {
    console.error('Error in paymentFailure:', error);
    res.render('paymentFailed', {
      user: req.session.user,
      error: 'An unexpected error occurred'
    });
  }
};

function getBestOffer(product, offers = [], quantity = 1) {
  if (!product || !Array.isArray(offers)) {
    console.warn("Invalid input to getBestOffer:", { product, offers });
    return { maxDiscount: 0, bestOffer: null, offerType: null };
  }

  let maxDiscount = 0;
  let bestOffer = null;
  let offerType = null;
  const now = new Date();

  console.log(
    `\n=== getBestOffer for ${product.productName} (${product._id}) ===`
  );
  console.log(
    `- Category: ${product.category?.name || "None"} (${
      product.category?._id || "N/A"
    })`
  );
  console.log(
    `- Regular Price: ${product.regularPrice}, Sale Price: ${
      product.salePrice || "None"
    }`
  );
  console.log(`- Quantity: ${quantity}`);

  const sortedOffers = [...offers].sort((a, b) => {
    const aValue =
      a.discountType === "percentage"
        ? a.discountValue * 1000
        : a.discountValue;
    const bValue =
      b.discountType === "percentage"
        ? b.discountValue * 1000
        : b.discountValue;
    return bValue - aValue;
  });

  for (const offer of sortedOffers) {
    if (
      !offer.isActive ||
      now < new Date(offer.startDate) ||
      now > new Date(offer.endDate)
    ) {
      console.log(
        `\nSkipping offer ${offer.name || offer._id} - ${
          !offer.isActive ? "Inactive" : "Expired"
        }`
      );
      continue;
    }

    const price =
      product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;

    let applies = false;
    let currentOfferType = null;

    if (offer.applicableOn === "all") {
      applies = true;
      currentOfferType = "all_products";
      console.log(
        `\nOffer ${offer.name || offer._id}: Applies to all products`
      );
    } else if (offer.applicableOn === "categories" && product?.category?._id) {
      const categoryMatch =
        Array.isArray(offer.categories) &&
        offer.categories.some(
          (catId) => catId.toString() === product.category._id.toString()
        );

      if (categoryMatch) {
        applies = true;
        currentOfferType = "category";
        console.log(
          `\nOffer ${offer.name || offer._id}: Applies to category ${
            product.category.name
          }`
        );
      }
    } else if (offer.applicableOn === "products" && product?._id) {
      const productMatch =
        Array.isArray(offer.products) &&
        offer.products.some(
          (prodId) => prodId.toString() === product._id.toString()
        );

      if (productMatch) {
        applies = true;
        currentOfferType = "product";
        console.log(
          `\nOffer ${offer.name || offer._id}: Applies to this specific product`
        );
      }
    }

    if (applies) {
      let discount =
        offer.discountType === "percentage"
          ? ((price * offer.discountValue) / 100) * quantity
          : offer.discountValue * quantity;

      if (offer.discountType === "percentage" && offer.maxDiscount) {
        discount = Math.min(discount, offer.maxDiscount);
        console.log(`- Capped at max discount: ${offer.maxDiscount}`);
      }

      console.log(
        `- Calculated discount: ${discount} (${offer.discountValue}${
          offer.discountType === "percentage" ? "%" : " flat"
        })`
      );

      if (discount > maxDiscount) {
        maxDiscount = discount;
        bestOffer = offer;
        offerType = currentOfferType;
        console.log("- New best offer!");
      }
    }
  }

  console.log(`\n=== Best Offer for ${product.productName} ===`);
  console.log(`- Offer: ${bestOffer?.name || "None"}`);
  console.log(`- Type: ${offerType || "None"}`);
  console.log(`- Max Discount: ${maxDiscount}`);
  console.log("==============================\n");

  return {
    maxDiscount: Math.max(0, maxDiscount), 
    bestOffer,
    offerType,
  };
}

module.exports = {
  paymentMethod,
  createOrder,
  processPayment,
  paymentConfirmation,
  verifyPayment,
  paymentFailure
};