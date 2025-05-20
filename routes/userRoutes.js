const express=require('express');
const router=express.Router();
const userController=require('../controllers/user/userController');
const passport = require('passport');
//const { use } = require('passport');
//const passport = require('../config/passport');
//const profileController=require('../controllers/user/profileController');
//const { userAuth } = require('../middleware/auth');
const productController=require("../controllers/user/productControllers")



router.get('/login',userController.loadLogin);
router.post("/login",userController.login);
router.get('/signup',userController.loadSignup);
router.post('/signup',userController.signup);
router.post("/verify-otp",userController.verifyOtp)
router.post("/resend-otp",userController.resendOtp)



router.get('/auth/google',passport.authenticate('google',{scope:['profile','email']}));
router.get('/auth/google/callback',passport.authenticate('google',{failureRedirect:'/signup'}),(req,res)=>{
    res.redirect("/")
});

router.get('/',userController.loadHome);
router.get('/shopAll',userController.loadShopAll)
router.get("/filter", userController.filterProduct);


router.get('/product-details', userController.productDetails)




module.exports=router;