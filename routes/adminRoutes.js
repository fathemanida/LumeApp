const express = require('express');
const router = express.Router();
const adminController = require("../controllers/admin/adminController");
const customerController = require("../controllers/admin/customerController");
const categoryController = require("../controllers/admin/categoryController");
const productController = require("../controllers/admin/productController");
const {userAuth, adminAuth} = require("../middleware/auth");

// Admin authentication routes
router.get('/pageError', adminController.pageError);
router.get("/login", adminController.loadLogin);
router.post("/login", adminController.login);
router.get("/logout", adminController.logout);
router.get('/dashboard', adminController.loadDashboard);

// Customer management routes
router.get("/users", adminAuth, customerController.customerInfo);
router.get("/customerBlocked", adminAuth, customerController.customerBlocked);
router.get("/customerUnblocked", adminAuth, customerController.customerUnblocked);

// Category management routes
router.get("/category", adminAuth, categoryController.categoryInfo);
router.get("/add-category", adminAuth, categoryController.loadAddCategory);
router.post("/add-category", adminAuth, categoryController.upload.single('image'), categoryController.addCategory);
router.get("/edit-category", adminAuth, categoryController.getEditCategory);
router.post("/edit-category/:id", adminAuth, categoryController.upload.single('image'), categoryController.editCategory);
router.get("/list-category/:id", adminAuth, categoryController.getListcategory);
router.get("/unlist-category/:id", adminAuth, categoryController.getUnlistcategory);
router.get("/delete-category/:id", adminAuth, categoryController.deleteCategory);

// Product management routes
router.get('/product', adminAuth, productController.productInfo);
router.get('/add-product', adminAuth, productController.loadAddProduct);
router.post('/add-product', adminAuth, productController.upload.array("images", 3), productController.addProduct);
router.get('/edit-product/:id', adminAuth, productController.getEditProduct);
router.post('/edit-product/:id', adminAuth, productController.upload.array("images", 3), productController.editProduct);
router.get('/list-product/:id', adminAuth, productController.getListProduct);
router.get('/unlist-product/:id', adminAuth, productController.getUnlistProduct);
router.get('/delete-product/:id', adminAuth, productController.deleteProduct);

module.exports = router;