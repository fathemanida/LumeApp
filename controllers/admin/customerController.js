const User =require('../../models/userSchema');

const customerInfo=async (req,res) => {
    try {
     let search="";
     if(req.query.search){
        search=req.query.search
     }
     let page=1;
     if(req.query.page){
        page=parseInt(req.query.page)
     }
     const limit=6;
     const userData=await User.find({isAdmin:false,
        $or:[
            {username:{$regex:".*" +search+".*"}},
            {email:{$regex:".*" +search+".*"}},
        ]
     })
     .sort({createdOn:-1})
     .limit(limit*1)
     .skip((page-1)*limit)
     .exec();

     const count=await User.find({
        isAdmin:false,
        $or:[
            {username:{$regex:".*" +search+".*"}},
            {email:{$regex:".*" +search+".*"}},
        ],
     }).countDocuments()
     console.log('userData', userData);
     return res.render("customer",{
        data: userData,
        currentPage: page,
        totalPages: Math.ceil(count / limit),
      });
      

    } catch (error) {
        res
.status(500).send("error in customer info")
        console.log("error in customer info", error);
    }
}

const customerBlocked=async (req,res) => {
    try {
        let id=req.query.id;
        console.log('user here');
        await User.updateOne({_id:id},{$set:{isBlocked:false}})
        res.redirect("/admin/users")
    } catch (error) {
        res.redirect("/pageError")
    }
}

const customerUnblocked=async (req,res) => {
    try {
        let id=req.query.id;
        console.log('user here');
        await User.updateOne({_id:id},{$set:{isBlocked:true}})
        res.redirect("/admin/users");
    } catch (error) {
        res.redirect("/pageError")  
    }
}
module.exports={
    customerInfo,
    customerBlocked,
    customerUnblocked,
}