const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Cart = require("../../models/cartSchema");
const Product = require("../../models/productSchema");
const Coupon = require("../../models/couponSchema");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const router = require("../../routes/userRoutes");
const { error } = require("console");
const mongoose = require("mongoose");
const Order = require("../../models/orderSchema");
const Offer = require("../../models/offerSchema");
const { off } = require("process");
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/uploads/user");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed!"));
  },
}).single("profileImage");


const addToCart = async (req, res) => {
  try {
     console.log('======');
    console.log('======');
    console.log('======');
    console.log('======');
    const userId = req.session.user.id;
    const { productId, selectedSize, quantity } = req.body;

    const product = await Product.findById(productId).populate({
      path: "category",
      populate: { path: "categoryOffer" },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const productStock = product.quantity || 0;
    const maxAllowed = Math.min(productStock, 6);
    console.log('======priduct stock',productStock);
        console.log('======maxAllowed',maxAllowed);


    if (productStock === 0) {
      return res.status(400).json({ success: false, message: "Product is out of stock" });
    }

    if (quantity > maxAllowed) {
      return res.status(400).json({
        success: false,
        message: productStock <= 6
          ? `Only ${productStock} items available in stock`
          : "Maximum 6 items allowed per product"
      });
    }

    const basePrice = product.salePrice && product.salePrice < product.regularPrice
      ? product.salePrice
      : product.regularPrice;
    console.log('======basePRice',basePrice);

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ["all", "categories", "products"] },
    });
       console.log('======offers,',offers);

    const { maxDiscount } = getBestOffer(product, offers);
    const offerDiscount = maxDiscount;
    let finalPrice = basePrice - offerDiscount;
    if (finalPrice < 0) finalPrice = 0;
    const totalPrice = finalPrice * quantity;
        console.log('======maxdiscount:', maxDiscount);
    console.log('======offerDis:', offerDiscount);
    console.log('======finalPrice:', finalPrice);
    console.log('======totalprice:', totalPrice);
    console.log('======');


    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({
        userId,
        items: [],
        totalOfferDiscount: 0,
        cartTotal: 0,
        finalCartTotal: 0,
        couponDiscount: 0
      });
    }

    const existingItem = cart.items.find(
      item => item.productId.equals(productId) && item.size === selectedSize
    );
    console.log(existingItem,'====existing item')

    if (existingItem) {
      const newTotalQuantity = existingItem.quantity + Number(quantity);

      if (newTotalQuantity > maxAllowed) {
        const msg = productStock <= 6
          ? `Cannot add more items. Only ${productStock} items available in stock`
          : `Cannot add more items. Maximum 6 items allowed per product`;
        return res.status(400).json({ success: false, message: msg });
      }
          console.log('======existingItem',existingItem);
   



      existingItem.quantity = newTotalQuantity;
      existingItem.price = basePrice;
      existingItem.offerDiscount = offerDiscount;
      existingItem.finalPrice = finalPrice;
      existingItem.totalPrice = newTotalQuantity * finalPrice;
    } else {
      cart.items.push({
        productId,
        size: selectedSize,
        quantity,
        price: basePrice,
        offerDiscount,
        finalPrice,
        totalPrice,
        status: "In Cart"
      });
    }

    let totalOfferDiscount = 0;
    let cartTotal = 0;

    cart.items.forEach(item => {
      totalOfferDiscount += (item.offerDiscount || 0) * item.quantity;
      cartTotal += item.totalPrice;
    });

    cart.totalOfferDiscount = totalOfferDiscount;
    cart.cartTotal = cartTotal;

    const couponDiscount = cart.couponDiscount || 0;
    cart.finalCartTotal = cartTotal - couponDiscount;
    
    if (existingItem) {
      console.log('======Quantity', existingItem.quantity);
      console.log('======Price', existingItem.price);
      console.log('======offerDis', existingItem.offerDiscount);
      console.log('======finalprice', existingItem.finalPrice);
      console.log('======totalPrice', existingItem.totalPrice);
    } else {
      const newItem = cart.items.find(item => item.productId.equals(productId) && item.size === selectedSize);
      if (newItem) {
        console.log('======New Item Quantity', newItem.quantity);
        console.log('======New Item Price', newItem.price);
        console.log('======New Item offerDis', newItem.offerDiscount);
        console.log('======New Item finalprice', newItem.finalPrice);
        console.log('======New Item totalPrice', newItem.totalPrice);
      }
    }
    
    console.log('======totalofferDis', totalOfferDiscount);
    console.log('======');
    console.log('======cartTotal', cartTotal);


    await cart.save();

    return res.status(200).json({ success: true, message: "Product added to cart" });

  } catch (error) {
    console.error("Error adding to cart:", error);
    res.status(500).json({ success: false, message: "Error adding to cart" });
  }
};



const cart = async (req, res) => {
  try {
    const userId = req.session.user?.id;
    if (!userId) return res.redirect("/login");

    const user = await User.findById(userId);
    const cart = await Cart.findOne({ userId })
      .populate({
        path: "items.productId",
        populate: {
          path: "category",
          populate: {
            path: "categoryOffer"
          }
        }
      })
      .populate('couponApplied');

    if (!cart || cart.items.length === 0) {
      return res.render("cart", {
        user,
        items: [],
        totalPrice: 0,
        totalOfferDiscount: 0,
        totalCouponDiscount: 0,
        shipping: 0,
        finalPrice: 0,
        coupons: [],
        couponApplied: null,
        discount: 0,
      });
    }

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ["all", "categories", "products"] },
    }).lean();

    let totalPrice = 0;
    let totalOfferDiscount = 0;

    for (let item of cart.items) {
      const product = item.productId;
      const quantity = item.quantity;
      const unitPrice = product.salePrice;

      const matchedOffers = offers.filter((offer) => {
        if (offer.applicableOn === "all") return true;
        if (
          offer.applicableOn === "categories" &&
          offer.categories.some(
            (cat) => cat.toString() === product.category._id.toString()
          )
        ) return true;
        if (
          offer.applicableOn === "products" &&
          offer.products.some(
            (prod) => prod.toString() === product._id.toString()
          )
        ) return true;
        return false;
      });

      let bestDiscountPerItem = 0;
      matchedOffers.forEach((offer) => {
        let discount = 0;
        if (offer.discountType === "percentage") {
          discount = (unitPrice * offer.discountValue) / 100;
        } else {
          discount = offer.discountValue;
        }
        if (discount > bestDiscountPerItem) bestDiscountPerItem = discount;
      });

      const discountedPrice = unitPrice - bestDiscountPerItem;
      const itemTotal = discountedPrice * quantity;

      item.price = unitPrice;
      item.offerDiscount = bestDiscountPerItem;
      item.finalPrice = discountedPrice;
      item.totalPrice = itemTotal;

      totalPrice += unitPrice * quantity;
      totalOfferDiscount += bestDiscountPerItem * quantity;
    }

    let totalCouponDiscount = 0;
    let couponApplied = cart.couponApplied;
    let appliedCouponDetails = null;

    if (couponApplied) {
      const coupon = await Coupon.findOne({
        _id: couponApplied,
        isActive: true,
        startDate: { $lte: now },
        endDate: { $gte: now },
        minPurchase: { $lte: totalPrice - totalOfferDiscount },
      }).lean();

      if (coupon) {
        if (coupon.discountType === "PERCENTAGE") {
          totalCouponDiscount =
            ((totalPrice - totalOfferDiscount) * coupon.discountValue) / 100;
        } else {
          totalCouponDiscount = coupon.discountValue;
        }

        appliedCouponDetails = coupon;
      } else {
        cart.couponApplied = null;
      }
    }

    const shipping = totalPrice - totalOfferDiscount - totalCouponDiscount >= 1000 ? 0 : 40;
    const finalPrice = totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;

    cart.discount = totalCouponDiscount;
    cart.appliedCouponDetails = appliedCouponDetails;
    await cart.save(); 

    const availableCoupons = await Coupon.find({
      isActive: true,
      expiryDate: { $gt: now },
      minOrderAmount: { $lte: totalPrice - totalOfferDiscount }
    }).select('code discountType discountValue maxDiscount minOrderAmount expiryDate usedBy')
      .lean();
    
    const filteredCoupons = availableCoupons.filter(coupon => {
      return !coupon.usedBy || !coupon.usedBy.some(id => id.toString() === userId.toString());
    });
    
    console.log('Available coupons:', filteredCoupons.length, 'out of', availableCoupons.length, 'active coupons');
    console.log('Cart total after offers:', totalPrice - totalOfferDiscount);

    res.render("cart", {
      user,
      items: cart.items,
      totalPrice,
      totalOfferDiscount,
      totalCouponDiscount,
      shipping,
      finalPrice,
      coupons: availableCoupons,
      couponApplied: couponApplied,
      discount: totalCouponDiscount,
    });
  } catch (err) {
    console.error("Error loading cart:", err);
    res.status(500).render("error", { message: "Unable to load cart page." });
  }
};


const updateQuantity = async (req, res) => {
  try {
    const { itemId, action } = req.body;
    const userId = req.session.user.id;

    if (!itemId || !action) {
      return res.status(400).json({
        success: false,
        message: "Item ID and action are required",
      });
    }

    const cart = await Cart.findOne({ userId }).populate({
      path: "items.productId",
      populate: [
        { path: "offer" },
        { path: "category", populate: { path: "categoryOffer" } },
      ],
    });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const cartItem = cart.items.find((item) => item._id.toString() === itemId);
    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      });
    }

    if (!cartItem.productId) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const product = cartItem.productId;
    const currentQuantity = cartItem.quantity;
    let newQuantity = currentQuantity;
    const productStock = product.quantity || product.productStock || 0;
    const maxAllowed = Math.min(productStock, 6);

    if (action === "increase") {
      if (currentQuantity >= maxAllowed) {
        if (productStock <= 6) {
          return res.status(400).json({
            success: false,
            message: `Only ${productStock} items available in stock`,
          });
        } else {
          return res.status(400).json({
            success: false,
            message: "Maximum quantity limit reached (6 items per product)",
          });
        }
      }
      newQuantity = currentQuantity + 1;
    } else if (action === "decrease") {
      if (currentQuantity <= 1) {
        return res.status(400).json({
          success: false,
          message: "Minimum quantity is 1",
        });
      }
      newQuantity = currentQuantity - 1;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid action",
      });
    }

    const basePrice =
      product.salePrice && product.salePrice < product.regularPrice
        ? product.salePrice
        : product.regularPrice;
    let offerDiscount = 0;
    let largestDiscount = 0;

    if (product.offer && product.offer.isActive) {
      if (product.offer.discountType === "percentage") {
        const discount = (basePrice * product.offer.discountValue) / 100;
        if (discount > largestDiscount) {
          largestDiscount = discount;
          offerDiscount = discount;
        }
      } else {
        if (product.offer.discountValue > largestDiscount) {
          largestDiscount = product.offer.discountValue;
          offerDiscount = product.offer.discountValue;
        }
      }
    }

    if (
      product.category &&
      product.category.categoryOffer &&
      product.category.categoryOffer.isActive
    ) {
      if (product.category.categoryOffer.discountType === "percentage") {
        const discount =
          (basePrice * product.category.categoryOffer.discountValue) / 100;
        if (discount > largestDiscount) {
          largestDiscount = discount;
          offerDiscount = discount;
        }
      } else {
        if (product.category.categoryOffer.discountValue > largestDiscount) {
          largestDiscount = product.category.categoryOffer.discountValue;
          offerDiscount = product.category.categoryOffer.discountValue;
        }
      }
    }

    const effectivePrice = Math.max(basePrice - offerDiscount, 0);
    cartItem.quantity = newQuantity;
    cartItem.price = effectivePrice;
    cartItem.totalPrice = newQuantity * effectivePrice;

    await cart.save();

    const totalPrice = cart.items.reduce((total, item) => {
      const itemBasePrice =
        item.productId.salePrice &&
        item.productId.salePrice < item.productId.regularPrice
          ? item.productId.salePrice
          : item.productId.regularPrice;
      let itemOfferDiscount = 0;
      let itemLargestDiscount = 0;

      if (item.productId.offer && item.productId.offer.isActive) {
        if (item.productId.offer.discountType === "percentage") {
          const discount =
            (itemBasePrice * item.productId.offer.discountValue) / 100;
          if (discount > itemLargestDiscount) {
            itemLargestDiscount = discount;
            itemOfferDiscount = discount;
          }
        } else {
          if (item.productId.offer.discountValue > itemLargestDiscount) {
            itemLargestDiscount = item.productId.offer.discountValue;
            itemOfferDiscount = item.productId.offer.discountValue;
          }
        }
      }

      if (
        item.productId.category &&
        item.productId.category.categoryOffer &&
        item.productId.category.categoryOffer.isActive
      ) {
        if (
          item.productId.category.categoryOffer.discountType === "percentage"
        ) {
          const discount =
            (itemBasePrice *
              item.productId.category.categoryOffer.discountValue) /
            100;
          if (discount > itemLargestDiscount) {
            itemLargestDiscount = discount;
            itemOfferDiscount = discount;
          }
        } else {
          if (
            item.productId.category.categoryOffer.discountValue >
            itemLargestDiscount
          ) {
            itemLargestDiscount =
              item.productId.category.categoryOffer.discountValue;
            itemOfferDiscount =
              item.productId.category.categoryOffer.discountValue;
          }
        }
      }

      const itemEffectivePrice = Math.max(itemBasePrice - itemOfferDiscount, 0);
      return total + itemEffectivePrice * item.quantity;
    }, 0);

    const shipping = totalPrice > 1500 ? 0 : 40;
    const discount = cart.discount || 0;
    const finalPrice = totalPrice - discount + shipping;

    res.json({
      success: true,
      quantity: newQuantity,
      totalPrice: cartItem.totalPrice,
      stock: productStock,
      maxQuantity: maxAllowed,
      cartTotal: totalPrice,
      discount: discount,
      shipping: shipping,
      finalPrice: finalPrice,
    });
  } catch (error) {
    console.error("Error in updateQuantity:", error);
    res.status(500).json({
      success: false,
      message: "Error updating quantity",
    });
  }
};

const removeItem = async (req, res) => {
  try {
    const { itemId } = req.body;
    const userId = req.session.user.id;

    if (!itemId) {
      return res.status(400).json({ success: false, message: "Item ID is required" });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ success: false, message: "Cart not found" });
    }

    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: "Item not found in cart" });
    }

    cart.items.splice(itemIndex, 1);

    let totalPrice = 0;
    let totalOfferDiscount = 0;

    cart.items.forEach(item => {
      totalPrice += item.totalPrice;
      totalOfferDiscount += item.offerDiscount * item.quantity;
    });

    const shipping = totalPrice > 1500 ? 0 : 40;
    const discount = cart.discount || 0; 
    const finalPrice = totalPrice + shipping - discount;

    cart.cartTotal = totalPrice;
    cart.totalOfferDiscount = totalOfferDiscount;
    cart.finalCartTotal = finalPrice;

    await cart.save();

    res.json({
      success: true,
      message: "Item removed successfully",
      totals: {
        subtotal: totalPrice,
        offerDiscount: totalOfferDiscount,
        shipping: shipping,
        discount: discount,
        finalPrice: finalPrice,
      },
    });
  } catch (error) {
    console.error("Error removing item:", error);
    res.status(500).json({
      success: false,
      message: "Error removing item from cart",
      error: error.message,
    });
  }
};


const getCheckout = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const userId = req.session.user.id;

    const addresses = await Address.find({ userId: userId });

    const cart = await Cart.findOne({ userId })
      .populate({
        path: "items.productId",
        populate: [
          { path: "offer" },
          { path: "category", populate: { path: "categoryOffer" } },
        ],
      })
      .populate("couponApplied");

    const now = new Date();

    const coupons = await Coupon.find({
      isActive: true,
      expiryDate: { $gt: now },
    }).select(
      "code discountType discountValue maxDiscount minOrderAmount expiryDate usedBy"
    );

    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ["all", "categories", "products"] },
    });

    if (!cart || cart.items.length === 0) {
      return res.render("checkout", {
        user: req.session.user,
        items: [],
        totalPrice: 0,
        totalOfferDiscount: 0,
        totalCouponDiscount: 0,
        shipping: 0,
        finalPrice: 0,
        addresses: [],
        couponApplied: null,
        coupons: [],
        offerExpiryTime: null,
      });
    }

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalCouponDiscount = 0;

    cart.items.forEach((item) => {
      const product = item.productId;
      const basePrice =
        product.salePrice && product.salePrice < product.regularPrice
          ? product.salePrice
          : product.regularPrice;
      const originalPrice = basePrice * item.quantity;
      totalPrice += originalPrice;

      item.price = basePrice;
      item.originalPrice = originalPrice;
    });

    cart.items.forEach((item) => {
      const product = item.productId;
      const basePrice =
        product.salePrice && product.salePrice < product.regularPrice
          ? product.salePrice
          : product.regularPrice;
      const { maxDiscount, bestOffer } = getBestOffer(
        product,
        offers,
        item.quantity
      );
      item.offerDiscount = maxDiscount;
      item.appliedOffer = bestOffer;
      totalOfferDiscount += maxDiscount;
    });

    if (cart.couponApplied) {
      const coupon = cart.couponApplied;
      const priceAfterOffer = totalPrice - totalOfferDiscount;
      if (coupon.discountType === "PERCENTAGE") {
        totalCouponDiscount = (priceAfterOffer * coupon.discountValue) / 100;
        if (coupon.maxDiscount) {
          totalCouponDiscount = Math.min(
            totalCouponDiscount,
            coupon.maxDiscount
          );
        }
      } else {
        totalCouponDiscount = coupon.discountValue;
      }
    }

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalPrice =
      totalPrice - totalOfferDiscount - totalCouponDiscount + shipping;

    cart.items.forEach((item) => {
      let itemCouponDiscount = 0;
      if (
        cart.couponApplied &&
        cart.couponApplied.discountType === "PERCENTAGE"
      ) {
        itemCouponDiscount =
          (item.originalPrice - item.offerDiscount) *
          (cart.couponApplied.discountValue / 100);
      } else if (cart.couponApplied) {
        itemCouponDiscount = 0;
      }
      item.couponDiscount = itemCouponDiscount;
      item.totalPrice =
        item.originalPrice - item.offerDiscount - itemCouponDiscount;
    });

    const allExpiryDates = [
      ...offers.map((o) => o.endDate),
      ...coupons.map((c) => c.expiryDate),
    ];
    const futureExpiryDates = allExpiryDates.filter((d) => d > now);
    const nearestExpiry = futureExpiryDates.length
      ? new Date(Math.min(...futureExpiryDates.map((d) => d.getTime())))
      : null;

    res.render("checkout", {
      user: req.session.user,
      items: cart.items,
      totalPrice,
      totalOfferDiscount,
      totalCouponDiscount,
      shipping,
      finalPrice,
      addresses,
      couponApplied: cart.couponApplied,
      coupons,
      offerExpiryTime: nearestExpiry, 
    });
  } catch (error) {
    console.error("Error in getCheckout:", error);
    req.flash("error", "Error loading checkout page");
    res.redirect("/home");
  }
};


const applyCoupon = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.session.user.id;

    if (!code) {
      return res.status(400).json({ success: false, message: "Coupon code is required" });
    }

    const cart = await Cart.findOne({ userId }).populate({
      path: "items.productId",
      populate: [
        { path: "offer" },
        { path: "category", populate: { path: "categoryOffer" } },
      ],
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: "Cart is empty or not found" });
    }

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    });

    let totalPrice = 0;
    let totalOfferDiscount = 0;
    let totalQuantity = 0;

    cart.items.forEach((item) => {
      const product = item.productId;
      const quantity = item.quantity;
      totalQuantity += quantity;

      const basePrice =
        product.salePrice && product.salePrice < product.regularPrice
          ? product.salePrice
          : product.regularPrice;

      const itemTotal = basePrice * quantity;
      totalPrice += itemTotal;

      const { maxDiscount } = getBestOffer(product, offers, quantity);
      totalOfferDiscount += maxDiscount;
    });

    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
      expiryDate: { $gt: new Date() },
    });

    if (!coupon) {
      return res.status(400).json({ success: false, message: "Invalid or expired coupon code" });
    }

    const user = await User.findById(userId);
    const alreadyUsed = user.usedCoupons.some(
      (used) => used.code === coupon.code.toUpperCase()
    );

    if (alreadyUsed) {
      return res.status(400).json({ success: false, message: "Coupon already used" });
    }

    if (coupon.minOrderAmount && totalPrice < coupon.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon`,
      });
    }

    const totalAfterOffer = totalPrice - totalOfferDiscount;
    let couponDiscount = 0;

    if (coupon.discountType === "PERCENTAGE") {
      couponDiscount = (totalAfterOffer * coupon.discountValue) / 100;
      if (coupon.maxDiscount) {
        couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
      }
    } else {
      couponDiscount = coupon.discountValue;
    }

    const couponPerUnit = totalQuantity > 0 ? couponDiscount / totalQuantity : 0;

    cart.couponApplied = coupon._id;
    cart.appliedCouponDetails = coupon;
    cart.discount = couponDiscount;
    await cart.save();

    await Coupon.findByIdAndUpdate(coupon._id, {
      $addToSet: { usedBy: userId },
    });

    await User.findByIdAndUpdate(userId, {
      $addToSet: {
        usedCoupons: {
          code: coupon.code.toUpperCase(),
          usedOn: new Date(),
        },
      },
    });

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalPrice = totalPrice - totalOfferDiscount - couponDiscount + shipping;

    return res.json({
      success: true,
      message: "Coupon applied successfully",
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: couponDiscount,
        maxDiscount: coupon.maxDiscount,
        expiryDate: coupon.expiryDate,
      },
      distribution: {
        totalQuantity,
        couponPerUnit,
      },
      totals: {
        subtotal: totalPrice,
        offerDiscount: totalOfferDiscount,
        couponDiscount,
        shipping,
        finalPrice,
      },
    });
  } catch (error) {
    console.error("Error in applyCoupon:", error);
    return res.status(500).json({
      success: false,
      message: "Error applying coupon",
    });
  }
};


const removeCoupon = async (req, res) => {
  try {
    const userId = req.session.user.id;

    const cart = await Cart.findOne({ userId })
      .populate({
        path: "items.productId",
        select: "productName regularPrice salePrice stock",
      })
      .populate("couponApplied");

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const totalPrice = cart.items.reduce((total, item) => {
      if (!item.productId) return total;

      const price =
        item.productId.salePrice && item.productId.salePrice < item.productId.regularPrice
          ? item.productId.salePrice
          : item.productId.regularPrice;

      return total + price * item.quantity;
    }, 0);

    const couponId = cart.couponApplied?._id;
    const couponCode = cart.appliedCouponDetails?.code?.toUpperCase();

    cart.couponApplied = null;
    cart.appliedCouponDetails = null;
    cart.discount = 0;

    if (couponId) {
      await Coupon.findByIdAndUpdate(couponId, {
        $pull: { usedBy: userId },
      });
    }

    if (couponCode) {
      await User.findByIdAndUpdate(userId, {
        $pull: { usedCoupons: { code: couponCode } },
      });
    }

    const shipping = totalPrice >= 1500 ? 0 : 40;
    const finalPrice = totalPrice + shipping;

    await cart.save();

    return res.json({
      success: true,
      message: "Coupon removed successfully",
      totals: {
        subtotal: totalPrice,
        offerDiscount: 0, 
        couponDiscount: 0,
        shipping,
        finalPrice,
      },
    });
  } catch (error) {
    console.error("Error removing coupon:", error);
    return res.status(500).json({
      success: false,
      message: "Error removing coupon",
      error: error.message,
    });
  }
};



// const placeOrder = async (req, res) => {
//   console.log("sdffhgvmbgfgsdfadgfdhgmhvfgdsdggfh");
//   try {
//     const userId = req.session.user.id;
//     const { addressId, paymentMethod } = req.body;

//     if (!addressId || !paymentMethod) {
//       return res
//         .status(400)
//         .json({
//           success: false,
//           message: "Address and payment method are required",
//         });
//     }

//     const cart = await Cart.findOne({ userId }).populate({
//       path: "items.productId",
//       populate: [
//         { path: "offer" },
//         { path: "category", populate: { path: "categoryOffer" } },
//       ],
//     });

//     if (!cart || cart.items.length === 0) {
//       return res.status(400).json({ success: false, message: "Cart is empty" });
//     }

//     const now = new Date();
//     const offers = await Offer.find({
//       isActive: true,
//       startDate: { $lte: now },
//       endDate: { $gte: now },
//     });

//     let totalPrice = 0;
//     let totalOfferDiscount = 0;
//     let totalQuantities = 0;
//     const processedItems = [];

//     for (const item of cart.items) {
//       const product = item.productId;
//       const quantity = item.quantity;
//       const basePrice =
//         product.salePrice && product.salePrice < product.regularPrice
//           ? product.salePrice
//           : product.regularPrice;
//       const originalPrice = basePrice * quantity;
//       totalPrice += originalPrice;
//       totalQuantities += quantity;

//       const { maxDiscount, bestOffer, offerType } = getBestOffer(
//         product,
//         offers,
//         quantity
//       );
//       totalOfferDiscount += maxDiscount;

//       processedItems.push({
//         productId: product._id,
//         quantity: quantity,
//         originalPrice: originalPrice,
//         price: basePrice,
//         appliedOffer: bestOffer
//           ? {
//               offerId: bestOffer._id,
//               offerType: offerType,
//               offerName: bestOffer.offerName,
//               discountType: bestOffer.discountType,
//               discountValue: bestOffer.discountValue,
//               discountAmount: maxDiscount,
//             }
//           : null,
//       });
//     }

//     const shipping = totalPrice >= 1500 ? 0 : 40;
//     let couponDiscount = 0;
//     let usedCoupon = null;
//     if (cart.appliedCoupon) {
//       const coupon = await Coupon.findById(cart.appliedCoupon);
//       if (coupon) {
//         if (coupon.usedBy && coupon.usedBy.includes(userId)) {
//           return res.status(400).json({
//             success: false,
//             message: "You have already used this coupon in a previous order",
//           });
//         }
//         const priceAfterOffer = totalPrice - totalOfferDiscount;
//         if (coupon.discountType === "PERCENTAGE") {
//           couponDiscount = (priceAfterOffer * coupon.discountValue) / 100;
//           if (coupon.maxDiscount) {
//             couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
//           }
//         } else {
//           couponDiscount = coupon.discountValue;
//         }
//         try {
//           usedCoupon = coupon._id;
//         } catch (error) {
//           console.error("Error updating coupon usedBy:", error);
//           return res.status(500).json({
//             success: false,
//             message: "Error processing coupon",
//           });
//         }
//       }
//     }

//     const finalPrice =
//       totalPrice - totalOfferDiscount - couponDiscount + shipping;
//     const couponPerUnit =
//       totalQuantities > 0 ? couponDiscount / totalQuantities : 0;

//     const finalItems = processedItems.map((item) => {
//       // Calculate offer details if any
//       let appliedOffer = null;
//       if (item.appliedOffer) {
//         appliedOffer = {
//           offerId: item.appliedOffer._id || item.appliedOffer.offerId,
//           offerType:
//             item.appliedOffer.offerType || item.appliedOffer.type || "product",
//           offerName:
//             item.appliedOffer.name || item.appliedOffer.code || "Special Offer",
//           discountType: item.appliedOffer.discountType || "fixed",
//           discountValue: item.appliedOffer.discountValue || 0,
//           discountAmount: item.appliedOffer.discountAmount || 0,
//         };
//       }

//       const itemCouponDiscount = couponPerUnit * item.quantity;
//       const itemFinalPrice =
//         (item.originalPrice - (appliedOffer?.discountAmount || 0)) *
//           item.quantity -
//         itemCouponDiscount;

//       return {
//         productId: item.productId._id || item.productId,
//         quantity: item.quantity,
//         originalPrice: item.originalPrice,
//         price: item.originalPrice - (appliedOffer?.discountAmount || 0), // Price per unit after offers
//         appliedOffer: appliedOffer,
//         couponPerUnit: couponPerUnit,
//         totalCouponDiscount: itemCouponDiscount,
//         finalPrice: itemFinalPrice / item.quantity, // Final price per unit after all discounts
//         status: "Processing",
//       };
//     });

//     const order = new Order({
//       userId,
//       items: finalItems,
//       totalAmount: finalPrice,
//       shippingAddress: addressId,
//       paymentMethod,
//       status: "Pending",
//       usedCoupon: usedCoupon,
//       couponDiscount: couponDiscount,
//       offerDiscount: totalOfferDiscount,
//       subtotal: totalPrice,
//       shipping: shipping,
//       couponApplied: !!usedCoupon,
//       // Add additional fields for better tracking
//       paymentStatus: "Pending",
//       orderDate: new Date(),
//     });

//     await order.save();

//     for (const item of cart.items) {
//       const product = item.productId;
//       if (product) {
//         const newStock = (product.quantity || 0) - item.quantity;
//         await Product.findByIdAndUpdate(product._id, {
//           quantity: newStock < 0 ? 0 : newStock,
//           status: newStock > 0 ? "Available" : "Out of Stock",
//         });
//       }
//     }

//     if (usedCoupon) {
//       try {
//         await Coupon.findByIdAndUpdate(usedCoupon, {
//           $addToSet: { usedBy: userId },
//         });
//       } catch (error) {
//         console.error("Error marking coupon as used:", error);
//       }
//     }

//     cart.items = [];
//     cart.appliedCoupon = null;
//     cart.discount = 0;
//     await cart.save();

//     res.json({
//       success: true,
//       message: "Order placed successfully",
//       orderId: order._id,
//     });
//   } catch (error) {
//     console.error("Error in placeOrder:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error placing order",
//     });
//   }
// };

/**
 * Finds the best applicable offer for a product
 * @param {Object} product - The product to find offers for
 * @param {Array} offers - Array of offer objects
 * @param {number} [quantity=1] - Quantity of the product
 * @returns {Object} Object containing maxDiscount, bestOffer, and offerType
 */
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
  addToCart,
  cart,
  updateQuantity,
  removeItem,
  getCheckout,
  applyCoupon,
  removeCoupon,
  // placeOrder,
};
