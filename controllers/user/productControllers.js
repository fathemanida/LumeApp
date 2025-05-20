const Product=require('../../models/productSchema');
const Category=require('../../models/categorySchema');
const User=require('../../models/userSchema');

const productDetails=async (req,res) => {
    try {
        const userId=req.session.user;
        const userData=await User.findById(userId)
        const productId=req.query.id;

        const product=await Product.findById(productId).populate('category');
        

        const findCategory=product.category;

        res.render('product-details',{

        })
    } catch (error) {
        console.log('error in product details');
    }
}

module.exports={
    productDetails,
}