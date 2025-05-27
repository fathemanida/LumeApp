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
    const limit = 6; 

    const searchQuery = {
      $or: [
        { productName: { $regex: new RegExp(".*" + search + ".*", "i") } },
        { description: { $regex: new RegExp(".*" + search + ".*", "i") } },
      ],
    };

    const matchingCategories = await Category.find({
      categoryName: { $regex: new RegExp(".*" + search + ".*", "i") },
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
      });

    const totalProducts = await Product.countDocuments(searchQuery);
    const totalPages = Math.ceil(totalProducts / limit);
    const offset = (page - 1) * limit;

    const categories = await Category.find({ isListed: true });

    res.render("product", {
      cat: categories || [],
      data: productData || [],
      currentPage: page,
      search: search,
      totalPages: totalPages,
      totalProducts: totalProducts, 
      startingNumber: (page - 1) * limit + 1, 
      offset:offset,
    });
  } catch (error) {
    console.error("Error in getAllProducts:", error);
    res.render("error", { message: "Server error, please try again later" });
  }
};

const loadAddProduct = async (req, res) => {
  try {
    const categories = await Category.find({ isListed: true });
    res.render("admin/product-add", { categories });
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
    } = req.body;

    if (
      !productName ||
      !description ||
      !category ||
      !regularPrice ||
      !quantity
    ) {
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

    if (salePrice && (isNaN(salePrice) || salePrice >= regularPrice)) {
      return res.status(400).json({
        success: false,
        message: "Sale price must be less than regular price",
      });
    }

   
    if (!Number.isInteger(Number(quantity)) || quantity < 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a non-negative integer",
      });
    }

    
    const productExists = await Product.findOne({ productName });
    if (productExists) {
      return res.status(400).json({
        success: false,
        message: "Product already exists",
      });
    }

   
    const productImage = [];
    if (req.files && req.files.length > 0) {
      if (req.files.length !== 3) {
        return res.status(400).json({
          success: false,
          message: "Exactly three images are required",
        });
      }

      for (const file of req.files) {
        
        const filename = path.basename(file.path);
        productImage.push(filename);
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "Exactly three images are required",
      });
    }

   
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc) {
      return res.status(400).json({
        success: false,
        message: "Category not found",
      });
    }

    
    const timestamp = Date.now();
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const productCode = `${categoryDoc.name
      .slice(0, 3)
      .toUpperCase()}${timestamp}${randomNum}`;

    
    const newProduct = new Product({
      productName,
      description,
      category: categoryDoc._id,
      regularPrice,
      salePrice: salePrice || regularPrice,
      sizes: parsedSizes,
      productCode,
      quantity,
      productImage,
      status: quantity > 0 ? "Available" : "Out of Stock",
      featured: featured === "yes",
      new: isNew === "yes",
      createdOn: new Date(),
    });

    await newProduct.save();

    return res.status(200).json({
      success: true,
      message: "Product added successfully",
      redirect: "/admin/product",
    });
  } catch (error) {
    console.error("Error in addProduct:", error);
    
    if (req.files) {
      req.files.forEach((file) => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    return res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
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
  let newImageFilenames = []; 
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

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
      existingImages = [],
    } = req.body;

    if (!productName || !category || !regularPrice) {
      return res.status(400).json({
        success: false,
        message: "Product name, category, and regular price are required",
      });
    }

    if (!/^[A-Z][a-zA-Z0-9\s]*$/.test(productName)) {
      return res.status(400).json({
        success: false,
        message: "Product name must start with a capital letter and contain only alphabets and numbers",
      });
    }

    if (description.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Description must be at least 10 characters long",
      });
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(400).json({
        success: false,
        message: "Specified category does not exist",
      });
    }

    const regularPriceNum = parseFloat(regularPrice);
    if (isNaN(regularPriceNum) || regularPriceNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Regular price must be a positive number",
      });
    }

    let salePriceNum = regularPriceNum;
    if (salePrice) {
      salePriceNum = parseFloat(salePrice);
      if (isNaN(salePriceNum) || salePriceNum <= 0) {
        return res.status(400).json({
          success: false,
          message: "Sale price must be a positive number",
        });
      }
      if (salePriceNum >= regularPriceNum) {
        return res.status(400).json({
          success: false,
          message: "Sale price must be less than or equal to regular price",
        });
      }
    }

    const quantityNum = parseInt(quantity);
    if (isNaN(quantityNum) || quantityNum < 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a non-negative integer",
      });
    }

    let parsedSizes = [];
    if (sizes) {
      try {
        parsedSizes = Array.isArray(sizes) ? sizes : JSON.parse(sizes);
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: "Invalid sizes format",
        });
      }
    }

    const finalImages = [...existingImages];
    if (req.files && req.files.length > 0) {
      try {
        newImageFilenames = req.files.map((file) => path.basename(file.path));
        
        for (let i = 0; i < Math.min(req.files.length, 3); i++) {
          if (finalImages[i]) {
            const oldImagePath = path.join("public", "uploads", "product", finalImages[i]);
            if (fs.existsSync(oldImagePath)) {
              fs.unlinkSync(oldImagePath);
            }
          }
          finalImages[i] = newImageFilenames[i];
        }
      } catch (error) {
        console.error("Error handling images:", error);
        await Promise.all(
          newImageFilenames.map(async (filename) => {
            const filePath = path.join("public", "uploads", "product", filename);
            if (fs.existsSync(filePath)) {
              await fs.unlink(filePath);
            }
          })
        );
        return res.status(500).json({
          success: false,
          message: "Error processing images. Please try again.",
        });
      }
    }

    const cleanedImages = finalImages.filter((img) => img);
    if (cleanedImages.length !== 3) {
      await Promise.all(
        newImageFilenames.map(async (filename) => {
          const filePath = path.join("public", "uploads", "product", filename);
          if (fs.existsSync(filePath)) {
            await fs.unlink(filePath);
          }
        })
      );
      return res.status(400).json({
        success: false,
        message: "Exactly three images are required",
      });
    }

    const updateData = {
      productName: productName.trim(),
      description: description.trim(),
      category: new mongoose.Types.ObjectId(category),
      regularPrice: regularPriceNum,
      salePrice: salePriceNum,
      quantity: quantityNum,
      sizes: parsedSizes,
      featured: featured === "yes" || featured === true,
      new: isNew === "yes" || isNew === true,
      status: quantityNum > 0 ? "Available" : "Out of Stock",
      productImage: cleanedImages,
      isListed: true
      
    };

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    ).populate("category");

    if (!updatedProduct) {
      throw new Error("Failed to update product");
    }

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
      redirect: "/admin/product",
    });
  } catch (error) {
    console.error("Error in editProduct:", error);

    await Promise.all(
      newImageFilenames.map(async (filename) => {
        const filePath = path.join("public", "uploads", "product", filename);
        if (fs.existsSync(filePath)) {
          await fs.unlink(filePath);
        }
      })
    );

    return res.status(500).json({
      success: false,
      message: error.message || "Server error, please try again later",
    });
  }
};

const getListProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (product.isListed) {
      return res.status(400).json({
        success: false,
        message: "Product is already listed",
      });
    }

    product.isListed = true;
    await product.save();

    return res.status(200).json({
      success: true,
      message: "Product listed successfully",
    });
  } catch (error) {
    console.error("Error listing product:", error);
    return res.status(500).json({
      success: false,
      message: "Server error, please try again later",
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
