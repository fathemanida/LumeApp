const express = require('express');
const router = express.Router();
const adminController = require("../controllers/admin/adminController");
const customerController = require("../controllers/admin/customerController");
const categoryController = require("../controllers/admin/categoryController");
const productController = require("../controllers/admin/productController");
const orderController = require("../controllers/admin/orderController");
const {userAuth, adminAuth} = require("../middleware/auth");
const walletController = require('../controllers/user/walletController');
const couponController=require('../controllers/admin/couponController')
const offerController = require('../controllers/admin/offerController');
const multer = require('multer');
const path = require('path');

// Multer config for banner images
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/uploads/banner'));
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Admin authentication routes
router.get('/pageError', adminController.pageError);
router.get("/login", adminController.loadLogin);
router.post("/login", adminController.login);
router.get("/logout", adminController.logout);
router.get('/sales-report', adminAuth, adminController.loadSalesreport);
router.get('/download-report', adminAuth, adminController.downloadReport);
router.get('/dashboard', adminAuth, adminController.loadDashboard);

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

// Order management routes
router.get("/orders", adminAuth, orderController.getOrders);
router.get("/orders/:orderId", adminAuth, orderController.getOrderDetails);
router.put("/orders/:orderId/status", adminAuth, orderController.updateOrderStatus);
router.put("/orders/:orderId/items/:itemId/status", adminAuth, orderController.updateOrderItemStatus);
router.post("/orders/:orderId/return", adminAuth, orderController.handleOrderReturn);
router.post("/orders/:orderId/items/:itemId/return", adminAuth, orderController.handleOrderItemReturn);
router.get("/order-address", adminAuth, orderController.getOrderAddress);
router.post('/orders/:orderId/status', adminAuth, orderController.updateOrderStatus);

// Return processing route
router.post('/orders/:orderId/process-return', adminAuth, walletController.processReturnRefund);

// Offers routes
router.get('/offers', adminAuth, offerController.getAllOffers);
router.get('/add-offer', adminAuth, offerController.getAddOffer);
router.post('/add-offer', adminAuth, offerController.createOffer);
router.get('/edit-offer/:id', adminAuth, offerController.getEditOffer);
router.put('/edit-offer/:id', adminAuth, offerController.updateOffer);
router.delete('/delete-offer/:id', adminAuth, offerController.deleteOffer);

router.get('/coupons', adminAuth, couponController.listCoupons);
router.get('/coupons/add', adminAuth, couponController.showAddForm);
router.post('/coupons', adminAuth, couponController.createCoupon);
router.get('/coupons/edit/:id', adminAuth, couponController.showEditForm);
router.put('/coupons/:id', adminAuth, couponController.updateCoupon);
router.delete('/coupons/:id', adminAuth, couponController.deleteCoupon);
router.put('/coupons/:id/toggle-status', adminAuth, couponController.toggleStatus);






module.exports = router;