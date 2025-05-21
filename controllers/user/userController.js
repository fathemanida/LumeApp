const User = require("../../models/userSchema");
const Product=require("../../models/productSchema");
const Category=require("../../models/categorySchema");
const bcrypt = require("bcrypt");
const mongoose = require('mongoose');
const nodemailer = require("nodemailer");
const env = require("dotenv").config();
const session = require("express-session");
const passport = require("passport");




const loadLogin = async (req, res) => {
  try {

      return res.render("login");
   
  } catch (error) {
    console.log("cant render login");
    res.redirect("/page404");
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const findUser = await User.findOne({ isAdmin: 0, email: email });
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

    req.session.user = true;
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
    console.log('usr going to sign up');
    return res.render("signup", { message: null });
    
  } catch (error) {
    console.log("sign up page not loading", error);
    res.status(500).send("Can not enter to sign up page");
  }
};
function generateOtp() {
  return Math.floor(10000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, otp) {
  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
      },
    });
    console.log("heloooooooooo");
    const info = await transport.sendMail({
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: "Verify your Account",
      text: `Thank you for signing up. Please verify your email address by entering the given OTP: ${otp}`,
      html: `<b>Your OTP: ${otp}</b>`,
    });
    console.log(email);
    return info.accepted.length > 0;
  } catch (error) {
    console.log("error in sending email", error);
    return false;
  }
}
const securePassword = async (passsword) => {
  const passwordHash = await bcrypt.hash(passsword, 10);
  return passwordHash;
};

const logout = async (req, res) => {
  try {
    req.session.user = null;
    console.log('User session cleared');
    res.render("login");
  } catch (error) {
    console.log("Error in logout", error);
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

      const saveUserData = new User({
        name: user.name,
        email: user.email,
        phone: user.phone,
        password: passwordHash,
      });
      console.log("Did we reach here?");

      await saveUserData.save();
      req.session.user = saveUserData._id;

      req.session.otp = null;
      console.log("Did we reach here?");

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



const signup = async (req, res) => {
  try {
    console.log('heloooo');
    const { name, phone, email, password, cPassword } = req.body;
    console.log('name:',name,'phone:', phone, 'email:',email,'password:', password, "c:",cPassword );
    if (password !== cPassword) {
      return res.render("signup", { message: "Passwords do not match" });
    }

    const findUser = await User.findOne({ email });
    if (findUser) {
      return res.render("signup", { message: "User already exists" });
    }

    const otp = generateOtp();
    const emailSent = await sendVerificationEmail(email, otp);

    if (!emailSent) {
      return res.json({ success: false, message: "Email sending failed" });
    }

    req.session.otp = otp;
   
    req.session.userData = { email, password, phone, name };
    console.log(`OTP sent: ${otp}`);
    console.log("OTP saved in session:", req.session.otp);
    // const newUser=new User({name,email,phone,password})
    // await newUser.save();
    res.render("verify-otp");
  } catch (error) {
    console.error("Signup error", error);
    res.redirect("/pageNotFound");
  }
};


const loadHome = async (req, res) => {
  try {

    const user = req.session.user;
    console.log(req.session.user)

    const userData = await User.findById(user._id);

    const categories=await Category.find({isListed:true})
    const categoryIds=categories.map((category)=>category._id.toString())
    const page=parseInt(req.query.page)||1;
    const limit=9;
    const skip=(page-1)*limit;
    const products=await Product.find({isListed:true,
      category:{$in:categoryIds},
      quantity:{$gt:0},

    }).sort({
      createdOn:-1}).skip(skip).limit(limit)

      const totalProducts=await Product.countDocuments({
        isBlocked:false,
        category:{$in:categoryIds},
        quantity:{$gt:0}
      })

      const totalPages=Math.ceil(totalProducts/limit);

     const categoryWithIds=categories.map(category=>({
       _id:category._id,
       name:category.name,
       image:category.image
     }))
     const featuredProducts = await Product.find({ featured: true })
     .sort({ createdAt: -1 }) 
     .limit(3);
     const newCollections = await Product.find({ new: true })
     .sort({ createdAt: -1 }) 
     .limit(3);

     const categoriesWithProducts = await Product.aggregate([
      {
        $group: {
          _id: "$category",
          name: { $first: "$category" },
        
                }
      },
      { $limit: 4 } 
    ]);




   
    
     
     
    return res.render("home",{
      user:userData,
      products:products,
      totalProducts:totalProducts,
      currentPage:page,
      totalPages:totalPages,
      category:categoryWithIds,
      featured:featuredProducts,
      newCollections:newCollections,
      categories:categoriesWithProducts,
      
     
    });
  } catch (error) {
    console.log("shopping not loading", error);
    res.status(500).send("Can not enter to shopping page");
  }
 };


const loadShopAll = async (req, res) => {
  try {
    let userData = null;
    if (req.session.user?._id) {
      userData = await User.findById(req.session.user._id);
    }

    const categories = await Category.find({ isListed: true });
    console.log('Categories found:', categories.length);

    const categoryId = req.query.category;
    const sortBy = req.query.sort;

      let query = {
      $or: [
        { isListed: true },
        { status: "Available" }
      ],
      isBlocked: false,
      quantity: { $gt: 0 }
    };

    if (categoryId) {
      query.category = categoryId;
    }

    const totalProducts = await Product.countDocuments(query);
    console.log('\nTotal products:', totalProducts);

    const page = parseInt(req.query.page) || 1;
    const limit = 9;
    const skip = (page - 1) * limit;
    const totalPages = Math.ceil(totalProducts / limit);

    let sort = { createdOn: -1 };
    if (sortBy) {
      switch (sortBy) {
        case 'price-low':
          sort = { salePrice: 1 };
          break;
        case 'price-high':
          sort = { salePrice: -1 };
          break;
        case 'name-asc':
          sort = { productName: 1 };
          break;
        case 'name-desc':
          sort = { productName: -1 };
          break;
        case 'newest':
          sort = { createdOn: -1 };
          break;
      }
    }

    const products = await Product.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name');

    console.log('\nProducts found for current page:', products.length);

    const categoryData = categories.map(c => ({
      _id: c._id,
      name: c.name,
      image: c.image
    }));

    res.render("shopAll", {
      user: userData,
      products,
      totalProducts,
      currentPage: page,
      totalPages,
      category: categoryData,
      selectedCategory: categoryId || null,
      selectedSort: sortBy || null
    });
  } catch (error) {
    console.error("Error in loadShopAll:", error);
    res.status(500).render("error", { message: "Cannot load shop page" });
  }
};

const filterProduct = async (req, res) => {
  console.log('req received here');
  try {
    const userData = req.session.user?._id 
      ? await User.findById(req.session.user._id) 
      : null;

    const categories = await Category.find({ isListed: true });
    const categoryId = req.query.category;
    const sortBy = req.query.sort;

    // First, let's check and fix category assignments
    console.log('\nChecking product categories...');
    const allProducts = await Product.find({});
    
    for (const product of allProducts) {
      const productName = product.productName.toLowerCase();
      let newCategoryId = null;

      // Map product names to new category IDs
      if (productName.includes('ring') && !productName.includes('earring')) {
        newCategoryId = '682b080dbed5c417e3f4c00f'; // Rings
      } else if (productName.includes('earring')) {
        newCategoryId = '682b07dfbed5c417e3f4c007'; // Earrings
      } else if (productName.includes('bracelet')) {
        newCategoryId = '682b0830bed5c417e3f4c017'; // Bracelets
      } else if (productName.includes('necklace')) {
        newCategoryId = '682b084ebed5c417e3f4c01f'; // Necklaces
      }

      if (newCategoryId && product.category.toString() !== newCategoryId) {
        console.log(`Updating ${product.productName} from ${product.category} to ${newCategoryId}`);
        await Product.findByIdAndUpdate(
          product._id,
          { category: new mongoose.Types.ObjectId(newCategoryId) }
        );
      }
    }

    // Base query for active products
    let query = {
      $or: [
        { isListed: true },
        { status: "Available" }
      ],
      isBlocked: false,
      quantity: { $gt: 0 }
    };

    // Add category filter if categoryId is provided
    if (categoryId) {
      try {
        // Convert string ID to ObjectId
        const categoryObjectId = new mongoose.Types.ObjectId(categoryId);
        
        // Debug: Check if any products have this category without other filters
        const simpleCategoryCount = await Product.countDocuments({ 
          category: categoryObjectId 
        });
        console.log(`Products with just this category: ${simpleCategoryCount}`);

        // Add category to query
        query.category = categoryObjectId;

        // Debug: Check the count with all filters
        const fullQueryCount = await Product.countDocuments(query);
        console.log(`Products with all filters: ${fullQueryCount}`);

        // Debug: Show all products in this category
        const categoryProducts = await Product.find({ category: categoryObjectId });
        console.log('\nProducts in this category:');
        categoryProducts.forEach(product => {
          console.log(`- ${product.productName} (Category: ${product.category})`);
        });

      } catch (error) {
        console.error('Error in category filtering:', error);
      }
    }

    const sortOptions = {
      'price-low': { salePrice: 1 },
      'price-high': { salePrice: -1 },
      'name-asc': { productName: 1 },
      'name-desc': { productName: -1 },
      'newest': { createdOn: -1 },
    };

    const sort = sortOptions[sortBy] || { createdOn: -1 };
    const page = parseInt(req.query.page) || 1;
    const limit = 9;
    const skip = (page - 1) * limit;

    const totalProducts = await Product.countDocuments(query);
    const filteredProducts = await Product.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name");

    const totalPages = Math.ceil(totalProducts / limit);

    const categoryData = categories.map(c => ({
      _id: c._id,
      name: c.name,
      image: c.image
    }));

    res.render("shopAll", {
      user: userData,
      products: filteredProducts,
      totalProducts,
      currentPage: page,
      totalPages,
      category: categoryData,
      selectedCategory: categoryId || null,
      selectedSort: sortBy || null
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
      return res.status(400).render('error', { message: 'Product ID is required' });
    }

    const product = await Product.findById(productId)
      .populate('category', 'name')
      .lean();

    if (!product) {
      return res.status(404).render('error', { message: 'Product not found' });
    }

    
    const relatedProducts = await Product.find({
      category: product.category._id,
      _id: { $ne: product._id },
      isListed: true,
      quantity: { $gt: 0 }
    })
    .limit(4)
    .populate('category', 'name')
    .lean();

    
    const categories = await Category.find({ isListed: true });

    res.render('product-details', {
      user: userData,
      product,
      relatedProducts,
      category: categories,
      currentUser: userData
    });
  } catch (error) {
    console.error('Error in productDetails:', error);
    res.status(500).render('error', { message: 'Error loading product details' });
  }
};

module.exports={
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
    logout
}