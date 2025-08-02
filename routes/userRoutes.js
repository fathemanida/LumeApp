const express=require('express');
const router=express.Router();
const userController=require('../controllers/user/userController');
const passport = require('passport');
const profileController=require('../controllers/user/profileControllers');
const cartController=require('../controllers/user/cartController')
const orderController=require('../controllers/user/orderController.js')
const paymentController=require('../controllers/user/paymentController.js')
const wishlistController=require('../controllers/user/wishlistController.js')
const userAuth=require("../middleware/auth")
const multer = require('multer');
const path = require('path');
const walletController = require('../controllers/user/walletController.js')
const footerController=require('../controllers/user/footerController.js')
const refundController=require('../controllers/user/refundController.js')


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/user');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  }
});


router.get('/check-auth', (req, res) => {
  if (req.session.user) {
    res.json({
      isAuthenticated: true,
      user: {
        id: req.session.user.id,
        name: req.session.user.username,
        email: req.session.user.email
      }
    });
  } else {
    res.json({
      isAuthenticated: false
    });
  }
});
router.get('/hello',userController.hello)
router.get('/login',userController.loadLogin);
router.post("/login",userController.login);
router.get('/logout',userController.logout)
router.get('/signup',userController.loadSignup);
router.post('/signup',userController.signup);
router.post("/verify-otp",userController.verifyOtp)
router.post("/resend-otp",userController.resendOtp)



router.get('/auth/google',passport.authenticate('google',{scope:['profile','email']}));
router.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/signup' }),
  (req, res) => {
   
    req.session.user = {
      id: req.user._id.toString(), 
      name: req.user.name,
      email: req.user.email,
    };
    res.redirect('/');
  }
);

router.get('/',userController.loadHome);
router.get('/shopAll',userController.loadShopAll)
router.get("/filter", userController.filterProduct);
router.get('/new-arrivals',userController.newArrivals)
router.get('/featured',userController.featured)



router.get('/product-details', userController.productDetails)


router.get("/forgot-password",profileController.getForgotPasspage);
router.post("/forgot-password",profileController.forgotEmailValid)
router.post('/verify-passForgot-otp',profileController.verifypassOTP);
router.post("/resend-forgotPass-otp",profileController.forgotresendOtp)
router.get("/reset-password",profileController.getResetPassword)
router.post("/reset-password",profileController.checkNewPassword)



///profile///
router.get('/profile', userAuth.isLogin, profileController.profile);
router.get('/profile/update', userAuth.isLogin, profileController.editProfile);
router.post('/profile/update', userAuth.isLogin, upload.single('profileImage'), profileController.getEditProfile);
router.post('/profile/send-otp', userAuth.isLogin, profileController.sendOtp);
router.post('/profile/verify-otp', userAuth.isLogin, profileController.verifyOtp);
router.post('/profile/resend-otp', userAuth.isLogin, profileController.resendOtp);
router.get('/change-password',userAuth.isLogin,profileController.getChangePassword);
router.post('/change-password',userAuth.isLogin,profileController.changePassword)

///address////

router.get('/address', userAuth.isLogin, profileController.address);
router.get('/add-address', userAuth.isLogin, profileController.getAddAdress);
router.post('/add-address', userAuth.isLogin, profileController.addAddress);
router.get('/update/address/:id', userAuth.isLogin, profileController.getEditAddress);
router.post('/update/address/:id', userAuth.isLogin, profileController.updateAddress);
router.post('/set-default-address', userAuth.isLogin, profileController.setDefaultAddress);
router.post('/remove-address', userAuth.isLogin, profileController.removeAddress);

///cart///
router.get('/cart', userAuth.isLogin, cartController.cart);
router.post('/cart/add', userAuth.isLogin, cartController.addToCart);
router.post('/cart/update-quantity', userAuth.isLogin, cartController.updateQuantity);
router.post('/cart/remove/:itemId', userAuth.isLogin, cartController.removeItem);
///coupon///
router.post('/apply-coupon', cartController.applyCoupon);
router.post('/remove-coupon',userAuth.isLogin, cartController.removeCoupon);

router.get('/checkout',userAuth.isLogin,cartController.getCheckout)

// Payment routes
router.get('/proceed-payment', userAuth.isLogin, paymentController.paymentMethod);
router.post('/create-order', userAuth.isLogin, paymentController.createOrder);
router.post('/payment/process', userAuth.isLogin, paymentController.processPayment);
router.get('/payment-confirmation', userAuth.isLogin, paymentController.paymentConfirmation);
router.post('/verify-payment', userAuth.isLogin, paymentController.verifyPayment);
router.get('/payment-failure', userAuth.isLogin, paymentController.paymentFailure);

// Order routes
router.get('/orders', userAuth.isLogin, orderController.orders);
router.get('/orders/:orderId', userAuth.isLogin, orderController.orderDetails);
router.get('/orders/:orderId/invoice', userAuth.isLogin, orderController.downloadInvoice);

// Order actions
router.post('/orders/:orderId/cancel', userAuth.isLogin, orderController.cancelOrder);
router.post('/orders/:orderId/return', userAuth.isLogin, orderController.returnOrder);
router.post('/orders/:orderId/items/:itemId/cancel', userAuth.isLogin, orderController.cancelOrderItem);
router.post('/orders/:orderId/items/:itemId/return', userAuth.isLogin, orderController.returnOrderItem);

// Wishlist routes
router.post('/wishlist/add', userAuth.isLogin, wishlistController.addToWishlist);
router.get('/wishlist', userAuth.isLogin, wishlistController.getWishlist);

// Wallet routes
router.get('/wallet', userAuth.isLogin, walletController.getWallet);
router.get('/wallet/transactions', userAuth.isLogin, walletController.getTransactions);
router.post('/wallet/refund', userAuth.isLogin, walletController.addRefund);

// Payment routes
router.get('/proceed-payment', userAuth.isLogin, paymentController.paymentMethod);
router.post('/create-order', userAuth.isLogin, paymentController.createOrder);
router.post('/payment/process', userAuth.isLogin, paymentController.processPayment);
router.get('/payment-confirmation', userAuth.isLogin, paymentController.paymentConfirmation);
router.post('/verify-payment', userAuth.isLogin, paymentController.verifyPayment);
router.get('/payment-failure', userAuth.isLogin, paymentController.paymentFailure);
router.get('/payment-failed', userAuth.isLogin, paymentController.paymentFailure); // Alias for payment-failure

// Footer routes
router.get('/faqs', footerController.faq);

// Footer routes
router.get('/privacy-policy', footerController.privacyPolicy);
router.get('/shipping-returns', footerController.shippingReturn);
router.get('/refund-policy', footerController.refundPolicy);
router.get('/contact', footerController.contact);
router.post('/contact', footerController.contactPost);





module.exports=router;