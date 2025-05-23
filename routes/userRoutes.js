const express=require('express');
const router=express.Router();
const userController=require('../controllers/user/userController');
const passport = require('passport');
const profileController=require('../controllers/user/profileControllers');
//const { userAuth } = require('../middleware/auth');
const productController=require("../controllers/user/profileControllers")



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

module.exports=router;