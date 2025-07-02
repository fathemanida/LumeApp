const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const User = require("../../models/userSchema");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "public/uploads/product";

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Not an image! Please upload an image."), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const productInfo = async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6; 

    const searchQuery = {
      $or: [
        { productName: { $regex: new RegExp(".*" + search + ".*", "i") } },
        { description: { $regex: new RegExp(".*" + search + ".*", "i") } },
      ],
    };

    const matchingCategories = await Category.find({
      name: { $regex: new RegExp(".*" + search + ".*", "i") },
      isListed: true,
    }).select("_id");

    if (matchingCategories.length > 0) {
      searchQuery.$or.push({
        category: { $in: matchingCategories.map((cat) => cat._id) },
      });
    }

    const productData = await Product.find(searchQuery)
      .limit(limit)
      .skip((page - 1) * limit)
      .sort({ createdOn: -1 })
      .populate({
        path: "category",
        select: "name",
      })
      .populate({
        path: 'offer',
        match: {
          isActive: true,
          startDate: { $lte: new Date() },
          endDate: { $gte: new Date() }
        }
      });

    const totalProducts = await Product.countDocuments(searchQuery);
    const totalPages = Math.ceil(totalProducts / limit);
    const offset = (page - 1) * limit;

    const categories = await Category.find({ isListed: true });

    if (req.xhr || req.headers.accept.indexOf("json") > -1 || req.query.json === 'true') {
      return res.json({
        success: true,
        products: productData,
        currentPage: page,
        totalPages,
        totalProducts,
        offset
      });
    }

    res.render("product", {
      cat: categories || [],
      data: productData || [],
      currentPage: page,
      search: search,
      totalPages: totalPages,
      totalProducts: totalProducts, 
      startingNumber: (page - 1) * limit + 1, 
      offset: offset,
    });
  } catch (error) {
    console.error("Error in getAllProducts:", error);
    if (req.xhr || req.headers.accept.indexOf("json") > -1 || req.query.json === 'true') {
      return res.status(500).json({
        success: false,
        message: "Server error, please try again later"
      });
    }
    res.render("error", { message: "Server error, please try again later" });
  }
};

const loadAddProduct = async (req, res) => {
  try {
    const categories = await Category.find({ isListed: true });
    res.render("admin/product-add", { categories, selectedSizes: []  });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
  }
};

const addProduct = async (req, res) => {
  try {
    console.log('Request body:', req.body);
    console.log('Request files:', req.files);

    const {
      productName,
      description,
      category,
      regularPrice,
      salePrice,
      quantity,
      featured,
      new: isNew,
      sizes,
      productOffer
    } = req.body;

    if (!productName || !description || !category || !regularPrice || !quantity) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }

    if (!req.files || req.files.length === 0 || req.files.length > 3) {
      return res.status(400).json({ message: 'Please upload 1 to 3 images' });
    }

    let parsedSizes = [];
    if (sizes) {
      try {
        parsedSizes = JSON.parse(sizes);
        if (!Array.isArray(parsedSizes)) {
          return res.status(400).json({ message: 'Sizes must be an array' });
        }
        for (const size of parsedSizes) {
          if (!size.size || typeof size.quantity !== 'number' || size.quantity < 0) {
            return res.status(400).json({ message: 'Invalid size or quantity value' });
          }
        }
      } catch (error) {
        return res.status(400).json({ message: 'Invalid sizes format' });
      }
    }

    let parsedProductOffer = { active: false };
    if (productOffer) {
      try {
        parsedProductOffer = JSON.parse(productOffer);
        if (typeof parsedProductOffer !== 'object') {
          return res.status(400).json({ message: 'Invalid product offer format' });
        }

        if (parsedProductOffer.active) {
          const { discountType, discountValue, startDate, endDate } = parsedProductOffer;

          if (!discountType || !['percentage', 'flat'].includes(discountType)) {
            return res.status(400).json({ message: 'Invalid or missing discount type' });
          }
          if (typeof discountValue !== 'number' || discountValue < 0) {
            return res.status(400).json({ message: 'Discount value must be a non-negative number' });
          }
          if (discountType === 'percentage' && discountValue > 100) {
            return res.status(400).json({ message: 'Percentage discount must be between 0 and 100' });
          }
          if (!startDate || isNaN(new Date(startDate).getTime())) {
            return res.status(400).json({ message: 'Invalid or missing start date' });
          }
          if (!endDate || isNaN(new Date(endDate).getTime())) {
            return res.status(400).json({ message: 'Invalid or missing end date' });
          }
          if (new Date(startDate) >= new Date(endDate)) {
            return res.status(400).json({ message: 'End date must be after start date' });
          }
        }
      } catch (error) {
        return res.status(400).json({ message: 'Invalid product offer format' });
      }
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(400).json({ message: 'Invalid category' });
    }

    const parsedRegularPrice = parseFloat(regularPrice);
    const parsedSalePrice = salePrice ? parseFloat(salePrice) : parsedRegularPrice;
    if (isNaN(parsedRegularPrice) || parsedRegularPrice <= 0) {
      return res.status(400).json({ message: 'Regular price must be a positive number' });
    }
    if (isNaN(parsedSalePrice) || parsedSalePrice <= 0) {
      return res.status(400).json({ message: 'Sale price must be a positive number' });
    }
    if (parsedSalePrice > parsedRegularPrice) {
      return res.status(400).json({ message: 'Sale price must be less than or equal to regular price' });
    }

    const parsedQuantity = parseInt(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity < 0) {
      return res.status(400).json({ message: 'Quantity must be a non-negative integer' });
    }

    const parsedFeatured = featured === 'yes';
    const parsedNew = isNew === 'yes';

    const imagePaths = req.files.map(file => file.filename);


    const timestamp = Date.now().toString().slice(-6);
    const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const productCode = `LUME${timestamp}${randomNum}`;

    const product = new Product({
      productName,
      description,
      productImage: imagePaths,
      category,
      regularPrice: parsedRegularPrice,
      salePrice: parsedSalePrice,
      quantity: parsedQuantity,
      sizes: parsedSizes,
      featured: parsedFeatured,
      new: parsedNew,
      productOffer: parsedProductOffer,
      productCode
    });

    await product.save();

    return res.status(201).json({ message: 'Product added successfully', redirect: '/admin/product' });
  } catch (error) {
    console.error('Error adding product:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: Object.values(error.errors).map(err => err.message).join(', ') });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const getEditProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id).populate("category");
    const categories = await Category.find({ isListed: true });

    if (!product) {
      return res.render("admin/error", { message: "Product not found" });
    }

    
    const productImages = [...product.productImage];
    while (productImages.length < 3) {
      productImages.push(null);
    }

    res.render("admin/product-edit", {
      product: {
        ...product._doc,
        productImage: productImages
      },
      categories,
      title: "Edit Product",
    });
  } catch (error) {
    console.error("Error in getEditProduct:", error);
    res.render("admin/error", {
      message: "Server error, please try again later",
    });
  }
};

const editProduct = async (req, res) => {
  try {
    const {
      productName,
      description,
      category,
      regularPrice,
      salePrice,
      quantity,
      sizes,
      featured,
      new: isNew,
      productOffer
    } = req.body;

    const productId = req.params.id;

    if (!productName || !description || !category || !regularPrice || !quantity) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided",
      });
    }

    if (!/^[A-Z][a-zA-Z0-9\s]*$/.test(productName)) {
      return res.status(400).json({
        success: false,
        message:
          "Product name must start with a capital letter and contain only alphabets and numbers",
      });
    }

    if (description.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Description must be at least 10 characters long",
      });
    }

    let parsedSizes = [];
    if (sizes) {
      try {
        parsedSizes = JSON.parse(sizes);
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: "Invalid sizes format",
        });
      }
    }

    if (isNaN(regularPrice) || regularPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Regular price must be a positive number",
      });
    }

    if (salePrice && (isNaN(salePrice) || salePrice > regularPrice)) {
      return res.status(400).json({
        success: false,
        message: "Sale price must be less than or equal to regular price",
      });
    }

    if (!Number.isInteger(Number(quantity)) || quantity < 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a non-negative integer",
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const existingProduct = await Product.findOne({
      productName,
      _id: { $ne: productId }
    });
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: "A product with this name already exists",
      });
    }

    let parsedOffer = { active: false };
    if (productOffer) {
      try {
        parsedOffer = JSON.parse(productOffer);
        
        if (parsedOffer.active) {
          if (!parsedOffer.discountType || !parsedOffer.discountValue || !parsedOffer.startDate || !parsedOffer.endDate) {
            return res.status(400).json({
              success: false,
              message: "All offer fields are required when offer is active"
            });
          }

          if (parsedOffer.discountType === 'percentage' && (parsedOffer.discountValue < 0 || parsedOffer.discountValue > 100)) {
            return res.status(400).json({
              success: false,
              message: "Percentage discount must be between 0 and 100"
            });
          }

          if (new Date(parsedOffer.startDate) >= new Date(parsedOffer.endDate)) {
            return res.status(400).json({
              success: false,
              message: "End date must be after start date"
            });
          }
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer data format"
        });
      }
    }

    let finalPrice = regularPrice;
    if (parsedOffer.active) {
      if (parsedOffer.discountType === 'percentage') {
        finalPrice = regularPrice - (regularPrice * parsedOffer.discountValue / 100);
      } else {
        finalPrice = Math.max(regularPrice - parsedOffer.discountValue, 0);
      }
    }

    const updateData = {
      productName,
      description,
      category,
      regularPrice,
      salePrice: finalPrice,
      quantity,
      sizes: parsedSizes,
      featured: featured === 'true',
      new: isNew === 'true',
      productOffer: parsedOffer
    };

    if (req.files && req.files.length > 0) {
      if (req.files.length !== 3) {
        return res.status(400).json({
          success: false,
          message: "Exactly three images are required",
        });
      }

      if (product.productImage && product.productImage.length > 0) {
        for (const image of product.productImage) {
          const imagePath = path.join('public/uploads/product', image);
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        }
      }

      const productImage = req.files.map(file => path.basename(file.path));
      updateData.productImage = productImage;
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: "Product updated successfully",
      product: updatedProduct
    });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product"
    });
  }
};

const getListProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    product.isListed = true;
    
    if (product.productOffer && product.productOffer.active) {
      product.productOffer = {
        active: true,
        discountType: product.productOffer.discountType || 'percentage',
        discountValue: product.productOffer.discountValue || 0,
        startDate: product.productOffer.startDate,
        endDate: product.productOffer.endDate
      };
    } else {
      product.productOffer = {
        active: false,
        discountType: 'percentage',
        discountValue: 0,
        startDate: null,
        endDate: null
      };
    }

    await product.save();

    res.status(200).json({
      success: true,
      message: "Product listed successfully",
    });
  } catch (error) {
    console.error("Error listing product:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error listing product",
    });
  }
};

const getUnlistProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (!product.isListed) {
      return res.status(400).json({
        success: false,
        message: "Product is already unlisted",
      });
    }

    product.isListed = false;
    await product.save();

    return res.status(200).json({
      success: true,
      message: "Product unlisted successfully",
    });
  } catch (error) {
    console.error("Error unlisting product:", error);
    return res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      req.flash("error", "Product not found");
      return res.redirect("/admin/product");
    }

   
    if (product.productImage) {
      product.productImage.forEach((image) => {
        const imagePath = path.join("public", image);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      });
    }

    await Product.findByIdAndDelete(id);
    req.flash("success", "Product deleted successfully");
    res.redirect("/admin/product");
  } catch (error) {
    console.error("Error in deleteProduct:", error);
    req.flash("error", "Failed to delete product");
    res.redirect("/admin/product");
  }
};

module.exports = {
  productInfo,
  loadAddProduct,
  addProduct,
  getEditProduct,
  editProduct,
  getListProduct,
  getUnlistProduct,
  deleteProduct,
  upload,
};
