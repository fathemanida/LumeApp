const Category = require("../../models/categorySchema");
const fs = require("fs");
const path = require("path");

const multer = require("multer");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = "public/uploads/category";

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

const categoryInfo = async (req, res) => {
  try {
    let search = "";
    if (req.query.search) {
      search = req.query.search;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 2;
    const skip = (page - 1) * limit;

    const categoryName = await Category.find({
      name: { $regex: ".*" + search + ".*", $options: "i" },
      isListed: true
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);

    const totalCategory = await Category.countDocuments({
      name: { $regex: ".*" + search + ".*", $options: "i" },
      isListed: true
    });
    const totalPages = Math.ceil(totalCategory / limit);
    const offset = (page - 1) * limit;

    // Always return JSON for AJAX requests
    if (req.xhr || req.headers.accept.indexOf("json") > -1 || req.query.json === 'true') {
      return res.json({
        success: true,
        categories: categoryName,
        currentPage: page,
        totalPages,
        totalCategory,
      });
    }

    res.render("admin/category", {
      cat: categoryName,
      currentPage: page,
      totalPages,
      totalCategory,
      search,
      offset,
    });
  } catch (error) {
    console.error("Error in categoryInfo:", error);
    if (req.xhr || req.headers.accept.indexOf("json") > -1 || req.query.json === 'true') {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
    res.redirect("/admin/pageError");
  }
};

const loadAddCategory = async (req, res) => {
  try {
    if (!req.session.admin) {
      return res.redirect("/admin/login");
    }

    console.log(req.session.admin);
    if (req.session.admin) {
      return res.render("category-add");
    } else {
      return res.redirect("/pageError");
    }
  } catch (error) {
    res.redirect("/pageError");
    console.log("error in load add category", error);
  }
};

const addCategory = async (req, res) => {
  try {
    const { name, description, categoryOffer } = req.body;

    if (!name || !description || !req.file) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided"
      });
    }

    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: "A category with this name already exists"
      });
    }

    let parsedOffer = { active: false };
    if (categoryOffer) {
      try {
        parsedOffer = JSON.parse(categoryOffer);
        
        if (parsedOffer.discountType) {
          parsedOffer.discountType = parsedOffer.discountType.toLowerCase();
        }
        
        // Set active status based on the offer data
        parsedOffer.active = parsedOffer.isActive;
        
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
        console.error("Error parsing offer data:", error);
        return res.status(400).json({
          success: false,
          message: "Invalid offer data format"
        });
      }
    }

    const category = new Category({
      name,
      description,
image: `uploads/category/${req.file.filename}`,
      categoryOffer: parsedOffer
    });

    await category.save();
    console.log(category);

    res.status(201).json({
      success: true,
      message: "Category added successfully",
      category
    });
  } catch (error) {
    console.error("Error adding category:", error);
    res.status(500).json({
      success: false,
      message: "Error adding category"
    });
  }
};

const getListcategory = async (req, res) => {
  try {
    if (!req.session.admin) {
      return res.redirect("/admin/login");
    }

    const { id } = req.params;

    if (!id || id === "null" || id === "undefined") {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID provided",
      });
    }

    console.log(`getListCategory called for ID: ${id}`);

    const category = await Category.findById(id);
    if (!category) {
      console.log("Category not found:", id);
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    if (category.isListed) {
      console.log("Category is already listed:", id);
      return res.status(200).json({
        success: false,
        message: "Category is already listed",
      });
    }

    await Category.findByIdAndUpdate(id, { isListed: true });
    console.log("Category listed successfully:", id);

    return res.status(200).json({
      success: true,
      message: "Category listed successfully",
    });
  } catch (error) {
    console.error("Error listing category:", error);
    return res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
  }
};

const getUnlistcategory = async (req, res) => {
  if (!req.session.admin) {
    return res.redirect("/admin/login");
  }

  try {
    const { id } = req.params;
    console.log(`getUnlistCategory called for ID: ${id}`);

    const category = await Category.findById(id);
    if (!category) {
      console.log("Category not found:", id);
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    if (!category.isListed) {
      console.log("Category is already unlisted:", id);
      return res.status(200).json({
        success: false,
        message: "Category is already unlisted",
      });
    }

    await Category.findByIdAndUpdate(id, { isListed: false });
    console.log("Category unlisted successfully:", id);

    return res.status(200).json({
      success: true,
      message: "Category unlisted successfully",
    });
  } catch (error) {
    console.error("Error unlisting category:", error);
    return res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
  }
};

const getEditCategory = async (req, res) => {
  try {
    if (!req.session.admin) {
      return res.redirect("/admin/login");
    }

    const id = req.query.id;
    const category = await Category.findById(id);
    if (!category) {
      return res.render("error", { message: "Category not found" });
    }
    const categoryImage = category.image || "default.jpg";
    console.log("Category Image:", category.image);

    res.render("category-edit", { category, categoryImage });
  } catch (error) {
    console.error("Error in getEditCategory:", error);
    res.render("error", { message: "Server error, please try again later" });
  }
};

const editCategory = async (req, res) => {
  try {
    const { name, description, categoryOffer } = req.body;
    const categoryId = req.params.id;

    if (!name || !description) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided"
      });
    }

    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found"
      });
    }

    // Check if another category with same name exists
    const existingCategory = await Category.findOne({
      name,
      _id: { $ne: categoryId }
    });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: "A category with this name already exists"
      });
    }

    let parsedOffer = { active: false };
    if (categoryOffer) {
      try {
        parsedOffer = JSON.parse(categoryOffer);
        
        if (parsedOffer.discountType) {
          parsedOffer.discountType = parsedOffer.discountType.toLowerCase();
        }
        
        // Set active status based on the offer data
        parsedOffer.active = parsedOffer.isActive;
        
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
        console.error("Error parsing offer data:", error);
        return res.status(400).json({
          success: false,
          message: "Invalid offer data format"
        });
      }
    }

    // Update category data
    const updateData = {
      name,
      description,
      categoryOffer: parsedOffer
    };

    // Handle image upload if provided
    if (req.file) {
      // Delete old image
      const oldImagePath = path.join( category.image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
      updateData.image = `${req.file.filename}`;
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      categoryId,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: "Category updated successfully",
      category: updatedCategory
    });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({
      success: false,
      message: "Error updating category"
    });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      req.flash("error", "No category ID provided");
      return res.redirect("/admin/category");
    }

    const deleted = await Category.findByIdAndDelete(id);
    if (!deleted) {
      req.flash("error", "Category not found");
      return res.redirect("/admin/category");
    }

    req.flash("success", "Category deleted successfully");
    res.redirect("/admin/category");
  } catch (error) {
    console.error("Error in deleteCategory:", error);
    req.flash("error", "Failed to delete category");
    res.redirect("/admin/category");
  }
};

module.exports = {
  categoryInfo,
  loadAddCategory,
  addCategory,
  editCategory,
  getEditCategory,
  getListcategory,
  getUnlistcategory,
  deleteCategory,
  upload,
};
