const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const env = require("dotenv").config();
const session = require("express-session");
const passport = require("passport");
const Offer = require("../../models/offerSchema");
const Wallet = require("../../models/walletSchema");

const loadLogin = async (req, res) => {
  try {
     if (req.session.user) {
      return res.redirect("/");
    }
    return res.render("login");
  } catch (error) {
    console.log("cant render login");
    res.redirect("/page404");
  }
};

const login = async (req, res) => {
  try {
     if (req.session.user) {
      return res.redirect("/");
    }
    const { email, password } = req.body;

    const findUser = await User.findOne({ isAdmin: 0, email: email });
    if (findUser) {
      const userById = await User.findById(findUser._id);
      console.log(userById);
    }
    if (!findUser) {
      return res.render("login", { message: "User not found! " });
    }

    if (findUser.isBlocked) {
      res.render("login", { message: "You are blocked by admin" });
    }
    const passwordMatch = await bcrypt.compare(password, findUser.password);

    if (!passwordMatch) {
      return res.render("login", { message: "Incorrect password" });
    }

    req.session.user = {
      id: findUser._id,
      username: findUser.name,
      email: findUser.email,
    };

    return res.redirect("/");
  } catch (error) {
    console.log("error in login", error);
    res.render("login", { message: "can't login..Err" });
  }
};

const loadSignup = async (req, res) => {
  try {
    console.log("usr going to sign up");
    if (req.session.user) {
      return res.redirect("/login");
    }
    return res.render("signup", { message: null });
  } catch (error) {
    console.log("sign up page not loading", error);
    res.status(500).send("Can not enter to sign up page");
  }
};
function generateOtp() {
  return Math.floor(10000 + Math.random() * 900000).toString();
}



const sendVerificationEmail = async (email, otp) => {
  try {
const transporter = nodemailer.createTransport({
  service: 'gmail',
  port: 587,
  secure: false,
  auth: {
    user: process.env.NODEMAILER_EMAIL,
    pass: process.env.NODEMAILER_PASSWORD,
  }
});


    const mailOptions = {
      from: `"Lume Elegence" <${process.env.NODEMAILER_EMAIL}>`,
      to: email,
      subject: 'Verify Your Email - Lume Elegence',
      text: `Hi there,\n\nThanks for signing up on Lume Elegence.\nYour OTP is: ${otp}\n\nEnter this OTP to verify your email.\n\nIf you did not request this, you can ignore this message.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Welcome to Lume Elegence!</h2>
          <p>Thank you for signing up. Please verify your email using the OTP below:</p>
          <h3 style="color:#333;">Your OTP: <strong>${otp}</strong></h3>
          <p>If you did not request this, you can safely ignore this email.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(`Verification email sent to ${email}: ${info.messageId}`);
    return info.accepted.length > 0;
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
};

module.exports = sendVerificationEmail;

const securePassword = async (passsword) => {
  const passwordHash = await bcrypt.hash(passsword, 10);
  return passwordHash;
};

const logout = async (req, res) => {
  try {
    if (req.session.user) {
      delete req.session.user;
      console.log("User session cleared");
    }
    return res.redirect("/login");
  } catch (error) {
    console.log("Error in logout", error);
  }
};

const generateReferralCode = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
};

const signup = async (req, res) => {
  try {
    const { email, password, phone, name, referralCode } = req.body;

    const findUser = await User.findOne({ email: email });
    if (findUser) {
      return res.render("signup", { message: "User already exists" });
    }

    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referalCode: referralCode });
      if (!referrer) {
        return res.render("signup", { message: "Invalid referral code" });
      }
    }

    const otp = generateOtp();
    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return res.json({ success: false, message: "Email sending failed" });
    }

    req.session.otp = otp;
    req.session.userData = { email, password, phone, name, referralCode };
    console.log(`OTP sent: ${otp}`);
    console.log("OTP saved in session:", req.session.otp);
    res.render("verify-otp");
  } catch (error) {
    console.error("Signup error", error);
    res.redirect("/pageNotFound");
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    console.log("Entered OTP:", otp);
    console.log("Stored OTP:", req.session.otp);

    if (otp === req.session.otp) {
      const user = req.session.userData;
      const passwordHash = await securePassword(user.password);

      const referralCode = generateReferralCode();

      const saveUserData = new User({
        name: user.name,
        email: user.email,
        phone: user.phone,
        password: passwordHash,
        referalCode: referralCode,
        redeemed: false,
        redeemedUsers: []
      });

      await saveUserData.save();

      const wallet = new Wallet({
        userId: saveUserData._id,
        balance: 0,
        transactions: []
      });
      await wallet.save();

      await User.findByIdAndUpdate(saveUserData._id, { wallet: wallet._id });

      if (user.referralCode) {
        const referrer = await User.findOne({ referalCode: user.referralCode });
        if (referrer) {
          referrer.redeemedUsers.push(saveUserData._id);
          await referrer.save();

          let referrerWallet = await Wallet.findOne({ userId: referrer._id });
          if (!referrerWallet) {
            referrerWallet = new Wallet({ 
              userId: referrer._id, 
              balance: 0, 
              transactions: [] 
            });
          }
          referrerWallet.balance += 100;
          referrerWallet.transactions.push({
            type: 'CREDIT',
            amount: 100,
            description: `Referral reward for referring ${saveUserData.name}`,
            status: 'COMPLETED',
            createdAt: new Date()
          });
          await referrerWallet.save();

          let newUserWallet = await Wallet.findOne({ userId: saveUserData._id });
          if (!newUserWallet) {
            newUserWallet = new Wallet({ 
              userId: saveUserData._id, 
              balance: 0, 
              transactions: [] 
            });
          }
          newUserWallet.balance += 50;
          newUserWallet.transactions.push({
            type: 'CREDIT',
            amount: 50,
            description: 'Welcome bonus for using referral code',
            status: 'COMPLETED',
            createdAt: new Date()
          });
          await newUserWallet.save();

          const coupon = new Offer({
            name: `Referral Reward - ${referrer.name}`,
            code: `REF${referrer.referalCode}`,
            discountType: 'flat',
            discountValue: 100,
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            applicableOn: 'all',
            isActive: true,
            isReferral: true,
            userId: referrer._id
          });
          await coupon.save();
        }
      }

      req.session.user = saveUserData._id;
      req.session.otp = null;

      return res.json({
        success: true,
        message: "Account created successfully! Redirecting to login...",
        redirectUrl: "/login",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP, please try again!",
      });
    }
  } catch (error) {
    console.log("Error in OTP verification:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const resendOtp = async (req, res) => {
  try {
    const { email } = req.session.userData;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email not fond in session" });
    }
    const otp = generateOtp();
    req.session.otp = otp;

    const emailSent = await sendVerificationEmail(email, otp);
    if (emailSent) {
      console.log("Resend OTP:", otp);
      res
        .status(200)
        .json({ success: true, message: "OTP Resend successfully" });
    } else {
      res.status(500).json({
        success: false,
        message: "Sorry,Failed to resend OTP.Please try again",
      });
    }
  } catch (error) {
    console.log("error in resend", error);
    res.status(500).send("error in resend backend");
  }
};

const loadHome = async (req, res) => {
  try {
     
    const user = req.session.user;
    let isBlocked = false;

    if (user) {
      const dbUser = await User.findById(user.id);
      if (dbUser?.isBlocked) {
        isBlocked = true;
      }
    }

    const categories = await Category.find({ isListed: true });
    const categoryIds = categories.map((category) => category._id.toString());

    const currentDate = new Date();
    const activeOffers = await Offer.find({
      isActive: true,
      startDate: { $lte: currentDate },
      endDate: { $gte: currentDate },
    });

    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    const baseQuery = {
      category: { $in: categoryIds },
      
    };

    const products = await Product.find(baseQuery)
      .sort({ createdOn: -1 })
      .skip(skip)
      .limit(limit);

    const totalProducts = await Product.countDocuments(baseQuery);
    const totalPages = Math.ceil(totalProducts / limit);

    const categoryWithIds = categories.map((category) => ({
      _id: category._id,
      name: category.name,
      image: category.image,
    }));

    const featuredProductsRaw = await Product.find({
      ...baseQuery,
      featured: true,
    })
      .sort({ createdAt: -1 })
      .limit(6);

    const newCollectionsRaw = await Product.find({
      ...baseQuery,
      new: true,
    })
      .sort({ createdAt: -1 })
      .limit(6);

    const categoriesWithProducts = await Product.aggregate([
      {
        $match: {
          isListed: true,
          category: { $in: categories.map((c) => c._id) },
          quantity: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: "$category",
        },
      },
      {
        $limit: 4,
      },
    ]);

    const attachBestOffer = (productList) =>
      Promise.all(
        productList.map(async (product) => {
          const price = product.salePrice || product.regularPrice;
          const matchedOffers = activeOffers.filter((offer) => {
            if (offer.applicableOn === "all") return true;
            if (
              offer.applicableOn === "categories" &&
              offer.categories.some(
                (catId) => catId.toString() === product.category.toString()
              )
            )
              return true;
            if (
              offer.applicableOn === "products" &&
              offer.products.some(
                (prodId) => prodId.toString() === product._id.toString()
              )
            )
              return true;
            return false;
          });

          let maxDiscount = 0;
          let bestOffer = null;

          matchedOffers.forEach((offer) => {
            let discount =
              offer.discountType === "percentage"
                ? (price * offer.discountValue) / 100
                : offer.discountValue;
            if (discount > maxDiscount) {
              maxDiscount = discount;
              bestOffer = offer;
            }
          });

          const productData = {
            ...product._doc,
            offer: bestOffer || null,
          };

          return productData;
        })
      );

    const productsWithOffers = await attachBestOffer(products);
    const featuredWithOffers = await attachBestOffer(featuredProductsRaw);
    const newCollectionsWithOffers = await attachBestOffer(newCollectionsRaw);

    let spotlightProductRaw = await Product.find({ ...baseQuery })
      .sort({ createdAt: -1 })
      .limit(1);
    let spotlightProduct = await attachBestOffer(spotlightProductRaw);

    res.render("home", {
      user,
      products: productsWithOffers,
      totalProducts,
      currentPage: page,
      totalPages,
      category: categoryWithIds,
      featured: featuredWithOffers,
      newCollections: newCollectionsWithOffers,
      categories: categoriesWithProducts,
      blocked: isBlocked,
      offers: activeOffers,
      spotlightProduct: spotlightProduct || [],
    });
  } catch (error) {
    console.error("Error loading home page:", error);
    res.status(500).send("Internal Server Error");
  }
};


const loadShopAll = async (req, res) => {
  try {
    let userData = null;
    const user=req.session.user
    if (user) {
          const userId=user.id

      userData = await User.findById(userId);
    }

    const searchQuery = req.query.search || "";
    const categories = await Category.find({ isListed: true });
    const listedCategoryIds = categories.map(c => c._id.toString());

    const categoryId = req.query.category;
    const sortBy = req.query.sort;

    let query = {
      isBlocked: false,
      category: { $in: listedCategoryIds },
    };

    if (searchQuery) {
      query.$or = [
        { productName: { $regex: searchQuery, $options: "i" } },
        { description: { $regex: searchQuery, $options: "i" } },
      ];
    }

    if (categoryId && listedCategoryIds.includes(categoryId)) {
      query.category = categoryId;
    }

    const totalProducts = await Product.countDocuments(query);
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;
    const totalPages = Math.ceil(totalProducts / limit);

    let sort = { createdOn: -1 };
    if (sortBy) {
      switch (sortBy) {
        case "price-low":
          sort = { salePrice: 1 };
          break;
        case "price-high":
          sort = { salePrice: -1 };
          break;
        case "name-asc":
          sort = { productName: 1 };
          break;
        case "name-desc":
          sort = { productName: -1 };
          break;
        case "newest":
          sort = { createdOn: -1 };
          break;
      }
    }

    let products = await Product.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name")
      .populate({
        path: 'offer',
        match: {
          isActive: true,
          startDate: { $lte: new Date() },
          endDate: { $gte: new Date() }
        }
      })
      .lean();

    const now = new Date();

    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ["all", "categories", "products"] },
    }).lean();

    products = products.map((product) => {
  const matchedOffers = offers.filter((offer) => {
    if (offer.applicableOn === "all") return true;
    if (
      offer.applicableOn === "categories" &&
      offer.categories.some(cat => cat.toString() === product.category._id.toString())
    ) return true;
    if (
      offer.applicableOn === "products" &&
      offer.products.some(prod => prod.toString() === product._id.toString())
    ) return true;
    return false;
  });

  if (matchedOffers.length > 0) {
    let maxDiscount = 0;
    let bestOffer = null;

    matchedOffers.forEach((offer) => {
      let discount = 0;
      if (offer.discountType === 'percentage') {
        discount = (product.salePrice * offer.discountValue) / 100;
      } else {
        discount = offer.discountValue;
      }

      if (discount > maxDiscount) {
        maxDiscount = discount;
        bestOffer = offer;
      }
    });

    if (bestOffer) {
      product.offer = bestOffer;
    }
  }

  return product;
});


    const categoryData = categories.map((c) => ({
      _id: c._id,
      name: c.name,
      image: c.image,
    }));

    res.render("shopAll", {
      user: userData,
      products,
      totalProducts,
      currentPage: page,
      totalPages,
      category: categoryData,
      selectedCategory: categoryId || null,
      selectedSort: sortBy || null,
      searchQuery: req.query.search || ""
    });
  } catch (error) {
    console.error("Error in loadShopAll:", error);
    res.status(500).render("error", { message: "Cannot load shop page" });
  }
};

const hello=async (req,res) => {
  try {
    res.render('hello')
  } catch (error) {
    
  }
}
const filterProduct = async (req, res) => {
  console.log("req received here");
  try {
    const userData = req.session.user?._id
      ? await User.findById(req.session.user._id)
      : null;

    const categories = await Category.find({ isListed: true });
    const categoryId = req.query.category;
    const sortBy = req.query.sort;

    console.log("\nChecking product categories...");
    const allProducts = await Product.find({});

    const categoryRules = await Category.find({ isListed: true }).lean();
    const categoryMapping = categoryRules.map((category) => ({
      _id: category._id,
      keywords: category.keywords || [category.name.toLowerCase()],
      excludeKeywords: category.excludeKeywords || [],
    }));

    for (const product of allProducts) {
      const productName = product.productName.toLowerCase();
      let newCategoryId = null;

      for (const category of categoryMapping) {
        const hasKeyword = category.keywords.some((keyword) =>
          productName.includes(keyword.toLowerCase())
        );
        const hasExclusion = category.excludeKeywords.some((exclude) =>
          productName.includes(exclude.toLowerCase())
        );

        if (hasKeyword && !hasExclusion) {
          newCategoryId = category._id;
          break;
        }
      }

      if (newCategoryId && product.category.toString() !== newCategoryId) {
        console.log(
          `Updating ${product.productName} from ${product.category} to ${newCategoryId}`
        );
        await Product.findByIdAndUpdate(product._id, {
          category: new mongoose.Types.ObjectId(newCategoryId),
        });
      }
    }

    let query = {
      isListed: true,
      isBlocked: false,
      quantity: { $gt: 0 },
    };

    if (categoryId) {
      try {
        const categoryObjectId = new mongoose.Types.ObjectId(categoryId);
        const simpleCategoryCount = await Product.countDocuments({
          category: categoryObjectId,
        });
        console.log(`Products with just this category: ${simpleCategoryCount}`);

        query.category = categoryObjectId;

        const fullQueryCount = await Product.countDocuments(query);
        console.log(`Products with all filters: ${fullQueryCount}`);

        const categoryProducts = await Product.find({
          category: categoryObjectId,
        });
        console.log("\nProducts in this category:");
        categoryProducts.forEach((product) => {
          console.log(
            `- ${product.productName} (Category: ${product.category})`
          );
        });
      } catch (error) {
        console.error("Error in category filtering:", error);
      }
    }

    const sortOptions = {
      "price-low": { salePrice: 1 },
      "price-high": { salePrice: -1 },
      "name-asc": { productName: 1 },
      "name-desc": { productName: -1 },
      newest: { createdOn: -1 },
    };

    const sort = sortOptions[sortBy] || { createdOn: -1 };
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    const totalProducts = await Product.countDocuments(query);
    const filteredProducts = await Product.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name");

    // Fetch active offers
    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ["all", "categories", "products"] },
    }).lean();

    // Attach best offer to each filtered product
    const filteredProductsWithOffers = filteredProducts.map((product) => {
      const matchedOffers = offers.filter((offer) => {
        if (offer.applicableOn === "all") return true;
        if (
          offer.applicableOn === "categories" &&
          offer.categories.some(cat => cat.toString() === product.category._id.toString())
        ) return true;
        if (
          offer.applicableOn === "products" &&
          offer.products.some(prod => prod.toString() === product._id.toString())
        ) return true;
        return false;
      });

      if (matchedOffers.length > 0) {
        let maxDiscount = 0;
        let bestOffer = null;

        matchedOffers.forEach((offer) => {
          let discount = 0;
          if (offer.discountType === 'percentage') {
            discount = (product.salePrice * offer.discountValue) / 100;
          } else {
            discount = offer.discountValue;
          }

          if (discount > maxDiscount) {
            maxDiscount = discount;
            bestOffer = offer;
          }
        });

        if (bestOffer) {
          product.offer = bestOffer;
        }
      }

      return product;
    });

    const totalPages = Math.ceil(totalProducts / limit);

    const categoryData = categories.map((c) => ({
      _id: c._id,
      name: c.name,
      image: c.image,
    }));

    res.render("shopAll", {
      user: userData,
      products: filteredProductsWithOffers,
      totalProducts,
      currentPage: page,
      totalPages,
      category: categoryData,
      selectedCategory: categoryId || null,
      selectedSort: sortBy || null,
    });
  } catch (error) {
    console.error("Error in filterProduct:", error);
    res.status(500).render("error", { message: "Cannot filter products" });
  }
};

const productDetails = async (req, res) => {
  try {
    let userData = null;
    if (req.session.user) {
      userData = await User.findById(req.session.user._id);
    }

    const productId = req.query.id;

    if (!productId) {
      return res
        .status(400)
        .render("error", { message: "Product ID is required" });
    }

    const product = await Product.findById(productId)
      .populate({ path: "category", select: "name categoryOffer" })
      .lean();

    if (!product) {
      return res.status(404).render("error", { message: "Product not found" });
    }

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      applicableOn: { $in: ["all", "categories", "products"] },
    }).lean();

    let bestOffer = null;
    let maxDiscount = 0;
    const price = product.salePrice || product.regularPrice;

    offers.forEach((offer) => {
      let applies = false;
      if (offer.applicableOn === "all") applies = true;
      if (
        offer.applicableOn === "categories" &&
        offer.categories.some(cat => cat.toString() === product.category._id.toString())
      ) applies = true;
      if (
        offer.applicableOn === "products" &&
        offer.products.some(prod => prod.toString() === product._id.toString())
      ) applies = true;

      if (applies) {
        let discount = offer.discountType === "percentage"
          ? (price * offer.discountValue) / 100
          : offer.discountValue;
        if (discount > maxDiscount) {
          maxDiscount = discount;
          bestOffer = offer;
        }
      }
    });

    product.offer = bestOffer || null;

    const relatedProducts = await Product.find({
      category: product.category._id,
      _id: { $ne: product._id },
      isListed: true,
      quantity: { $gt: 0 },
    })
      .limit(4)
      .populate("category", "name")
      .lean();

    const categories = await Category.find({ isListed: true });

    res.render("product-details", {
      user: userData,
      product,
      relatedProducts,
      category: categories,
      currentUser: userData,
    });
  } catch (error) {
    console.error("Error in productDetails:", error);
    res
      .status(500)
      .render("page404", { message: "Error loading product details" });
  }
};

const newArrivals = async (req, res) => {
  try {
    const userData = req.session.user?._id
      ? await User.findById(req.session.user._id)
      : null;

    const categories = await Category.find({ isListed: true });
    const listedCategoryIds = categories.map((c) => c._id); 

    const query = {
      isListed: true,
      status: "Available",
      isBlocked: false,
      quantity: { $gt: 0 },
      new: true,
      category: { $in: listedCategoryIds },
    };

    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    const totalProducts = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalProducts / limit);

    const featuredData = await Product.find(query)
      .sort({ createdOn: -1 })
      .skip(skip)
      .limit(limit)
      .populate("category")
      .exec();

    const featuredWithPrices = await Promise.all(
      featuredData.map(async (product) => {
        const salesPrice = product.regularPrice;
        return {
          ...product._doc,
          salesPrice,
        };
      })
    );

    res.render("new-arrivals", {
      products: featuredWithPrices,
      currentPage: page,
      totalPages,
      query: req.query,
      user: userData,
      totalProducts,
      category: categories,
      selectedCategory: null,
      selectedSort: null,
    });
  } catch (error) {
    console.log("Error in new arrivals:", error);
    res.render("page404");
  }
};


const featured = async (req, res) => {
  try {
    const userData = req.session.user?._id
      ? await User.findById(req.session.user._id)
      : null;

    const categories = await Category.find({ isListed: true });
    const listedCategoryIds = categories.map((c) => c._id);

    const query = {
      isListed: true,
      status: "Available",
      isBlocked: false,
      quantity: { $gt: 0 },
      featured: true,
      category: { $in: listedCategoryIds },
    };

    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    const totalProducts = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalProducts / limit);

    const featuredData = await Product.find(query)
      .sort({ createdOn: -1 })
      .skip(skip)
      .limit(limit)
      .populate("category")
      .exec();

    const now = new Date();
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    });

    const featuredWithPrices = await Promise.all(
      featuredData.map(async (product) => {
        const salesPrice = product.salePrice || product.regularPrice;

        const matchedOffers = offers.filter((offer) => {
          if (offer.applicableOn === "all") return true;
          if (
            offer.applicableOn === "categories" &&
            offer.categories.some(
              (cat) => cat.toString() === product.category._id.toString()
            )
          ) {
            return true;
          }
          if (
            offer.applicableOn === "products" &&
            offer.products.some(
              (prod) => prod.toString() === product._id.toString()
            )
          ) {
            return true;
          }
          return false;
        });

        let maxDiscount = 0;
        let bestOffer = null;

        matchedOffers.forEach((offer) => {
          let discount = 0;
          if (offer.discountType === "percentage") {
            discount = (salesPrice * offer.discountValue) / 100;
          } else {
            discount = offer.discountValue;
          }

          if (discount > maxDiscount) {
            maxDiscount = discount;
            bestOffer = offer;
          }
        });

        const finalProduct = {
          ...product._doc,
          salesPrice,
        };
        if (bestOffer) {
          finalProduct.offer = bestOffer;
        }

        return finalProduct;
      })
    );

    res.render("featured", {
      products: featuredWithPrices,
      currentPage: page,
      totalPages,
      query: req.query,
      user: userData,
      totalProducts,
      category: categories,
      selectedCategory: null,
      selectedSort: null,
    });
  } catch (error) {
    console.log("Error in featured products:", error);
    res.render("page404");
  }
};


module.exports = {
  loadLogin,
  login,
  loadSignup,
  signup,
  verifyOtp,
  resendOtp,
  loadHome,
  loadShopAll,
  filterProduct,
  productDetails,
  logout,
  newArrivals,
  featured,
  hello
};
