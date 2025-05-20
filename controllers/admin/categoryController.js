const Category=require("../../models/categorySchema")
const fs=require("fs")
const path=require("path")

const multer=require("multer")


const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = 'public/uploads/category';
        
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Not an image! Please upload an image.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 
    }
});

const categoryInfo = async (req, res) => {
    try {
        let search = "";
        if (req.query.search) {
            search = req.query.search;
        }
        
        const page = parseInt(req.query.page) || 1;
        const limit = 6;
        const skip = (page - 1) * limit;

        const categoryName = await Category.find({
            name: { $regex: ".*" + search + ".*", $options: 'i' }
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);

        const totalCategory = await Category.countDocuments();
        const totalPages = Math.ceil(totalCategory / limit);

        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.json({
                success: true,
                categories: categoryName,
                currentPage: page,
                totalPages,
                totalCategory
            });
        }

        res.render("admin/category", {
            cat: categoryName,
            currentPage: page,
            totalPages,
            totalCategory,
            search
        });
        
    } catch (error) {
        console.error('Error in categoryInfo:', error);
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
        res.redirect("/admin/pageError");
    }
};

const loadAddCategory=async (req,res)=>{
  try {
      
      if(req.session.admin){
          return res.render("category-add")
      }else{
          return res.redirect("/pageError")
      }
     
      
  }catch (error) {
      res.redirect("/pageError")
      console.log('error in load add category', error);
  }
     
}

const addCategory = async (req, res) => {
    try {
        const { name, description } = req.body;
        
        if (!name || !description || !req.file) {
            return res.status(400).json({
                success: false,
                message: 'Name, description, and image are required'
            });
        }

        const existingCategory = await Category.findOne({
            name: new RegExp(`^${name}$`, 'i')
        });

        if (existingCategory) {
        
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: 'Category already exists'
            });
        }

        const imagePath = req.file.path.replace('public', '');

        const newCategory = new Category({
            name,
            description,
            image: imagePath
        });

        await newCategory.save();

        res.status(200).json({
            success: true,
            message: 'Category added successfully'
        });

    } catch (error) {
        
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Error adding category:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

const getListcategory = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id || id === 'null' || id === 'undefined') {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID provided"
            });
        }

        console.log(`getListCategory called for ID: ${id}`);

        const category = await Category.findById(id);
        if (!category) {
            console.log('Category not found:', id);
            return res.status(404).json({
                success: false,
                message: "Category not found"
            });
        }

        if (category.isListed) {
            console.log('Category is already listed:', id);
            return res.status(200).json({
                success: false,
                message: "Category is already listed"
            });
        }

        await Category.findByIdAndUpdate(id, { isListed: true });
        console.log('Category listed successfully:', id);
        
        return res.status(200).json({
            success: true,
            message: "Category listed successfully"
        });
        
    } catch (error) {
        console.error('Error listing category:', error);
        return res.status(500).json({
            success: false,
            message: "Server error, please try again later"
        });
    }
};

const getUnlistcategory = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`getUnlistCategory called for ID: ${id}`);

        const category = await Category.findById(id);
        if (!category) {
            console.log('Category not found:', id);
            return res.status(404).json({
                success: false,
                message: "Category not found"
            });
        }

        if (!category.isListed) {
            console.log('Category is already unlisted:', id);
            return res.status(200).json({
                success: false,
                message: "Category is already unlisted"
            });
        }

        await Category.findByIdAndUpdate(id, { isListed: false });
        console.log('Category unlisted successfully:', id);
        
        return res.status(200).json({
            success: true,
            message: "Category unlisted successfully"
        });
        
    } catch (error) {
        console.error('Error unlisting category:', error);
        return res.status(500).json({
            success: false,
            message: "Server error, please try again later"
        });
    }
};

const getEditCategory = async (req, res) => {
  try {
    const id = req.query.id;
    const category = await Category.findById(id);
    if (!category) {
      return res.render('error', { message: 'Category not found' });
    }
    res.render('category-edit', { category });
  } catch (error) {
    console.error('Error in getEditCategory:', error);
    res.render('error', { message: 'Server error, please try again later' });
  }
};

const editCategory = async (req, res) => {
    try {
        const id = req.params.id;
        const { categoryName, description } = req.body;
        
        if (!categoryName || !description) {
            return res.status(400).json({
                success: false,
                message: 'Name and description are required'
            });
        }

        const existingCategory = await Category.findOne({
            name: { $regex: `^${categoryName}$`, $options: 'i' },
            _id: { $ne: id }
        });

        if (existingCategory) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: 'Category name already exists'
            });
        }

        const updateData = {
            name: categoryName.trim(),
            description: description.trim()
        };

        if (req.file) {
           
            const oldCategory = await Category.findById(id);
            if (oldCategory && oldCategory.imagePath) {
                const oldImagePath = path.join('public', oldCategory.imagePath);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            updateData.imagePath = req.file.path.replace('public', '');
        }

        const updatedCategory = await Category.findByIdAndUpdate(
            id,
            updateData,
            { new: true }
        );

        if (!updatedCategory) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Category updated successfully'
        });

    } catch (error) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Error in editCategory:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

const deleteCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      req.flash('error', 'No category ID provided');
      return res.redirect("/admin/category");
    }
    
    const deleted = await Category.findByIdAndDelete(id);
    if (!deleted) {
      req.flash('error', 'Category not found');
      return res.redirect("/admin/category");
    }
    
    req.flash('success', 'Category deleted successfully');
    res.redirect("/admin/category");
  } catch (error) {
    console.error('Error in deleteCategory:', error);
    req.flash('error', 'Failed to delete category');
    res.redirect("/admin/category");
  }
}

module.exports={
    categoryInfo,
    loadAddCategory,
    addCategory,
    editCategory,
    getEditCategory,
    getListcategory,
    getUnlistcategory,
    deleteCategory,
    upload
}