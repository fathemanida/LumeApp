const express=require('express');
const router=express.Router();
const userController=require('../controllers/user/userController');
const passport = require('passport');
const profileController=require('../controllers/user/profileControllers');
const cartController=require('../controllers/user/cartController')
const userAuth=require("../middleware/auth")
const multer = require('multer');
const path = require('path');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
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

router.get('/login',userController.loadLogin);
router.post("/login",userController.login);
router.get('/logout',userController.logout)
router.get('/signup',userController.loadSignup);
router.post('/signup',userController.signup);
router.post("/verify-otp",userController.verifyOtp)
router.post("/resend-otp",userController.resendOtp)



router.get('/auth/google',passport.authenticate('google',{scope:['profile','email']}));
router.get('/auth/google/callback',passport.authenticate('google',{failureRedirect:'/signup'}),(req,res)=>{
    req.session.user=req.user
    res.redirect("/")
});

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




router.get('/profile', userAuth.isLogin, profileController.profile);
router.get('/profile/update', userAuth.isLogin, profileController.editProfile);
router.post('/profile/update', userAuth.isLogin, upload.single('profileImage'), profileController.getEditProfile);
router.post('/profile/send-otp', userAuth.isLogin, profileController.sendOtp);
router.post('/profile/verify-otp', userAuth.isLogin, profileController.verifyOtp);
router.post('/profile/resend-otp', userAuth.isLogin, profileController.resendOtp);

router.get('/address',userAuth.isLogin,profileController.address);
router.get('/add-address',userAuth.isLogin,profileController.getAddAdress);
router.post('/add-address',userAuth.isLogin,profileController.addAddress);
router.get('/address/update',userAuth.isLogin,profileController.getEditAddress);
router.post('/address/update',userAuth.isLogin,profileController.updateAddress);


router.get('/cart', userAuth.isLogin, cartController.cart);
router.post('/cart/add', userAuth.isLogin, cartController.addToCart);
router.put('/cart/update/:itemId', userAuth.isLogin, cartController.updateQuantity);
router.delete('/cart/remove/:itemId', userAuth.isLogin, cartController.removeItem);

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

module.exports=router;