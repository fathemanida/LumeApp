
const User = require("../models/userSchema"); 




const userAuth=async (req,res,next) => {
 if(req.session.user){
  User.findById(req.session.user)
  .then(data=>{
    if(data&&!data.isBlocked){
      next();
    }else{
      res.redirect("/login")
    }
  })
  .catch(error=>{
    console.log('Error in userAuth',error);
    res.status(500).send("Internal server error in userAuth")
  })
 }else{
  res.redirect("/login")
 }
}


const adminAuth=async (req,res,next) => {
  const admin=await User.findOne({isAdmin:true})
   if (!req.session.admin) {
      return res.redirect("/admin/login");
    }
  User.findOne({isAdmin:true})
  .then(data=>{
    if(data){
      next();
    }else{
      res.redirect("/admin/login")
    }
  })
  .catch(error=>{
    console.log('Error in adminAuth');
    res.status(500).send("Error in adminAuth");
  })
}
module.exports={
  userAuth,
  adminAuth,
}