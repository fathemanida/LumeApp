// models/User.js

const mongoose = require('mongoose');
const {Schema}=mongoose
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true  
        
    },
    email: {
        type: String,
        required: true,
        unique: true,  
        lowercase: true  
    },
    phone: {
        type: String,
        required: false,
        unique:false,
        sparse:true,
        default:null,
     },
    
    googleId:{
        type:String,
        unique:true,
        sparse: true 

    }, 
    password: {
        type: String,
        required: false
    },
    isBlocked:{
        type:Boolean,
        default:false
    },
    isAdmin:{
        type:Boolean,
        default:false
    },
    cart:[{
      type:Schema.Types.ObjectId,
      ref:"Cart"
    }],
    wallet:{
        type:Schema.Types.ObjectId
    },
        wishlist:[{
           type:Schema.Types.ObjectId,
           ref:"WishList"
        }],orderHistory:[{
            type:Schema.Types.ObjectId,
            ref:"Order"
        }],
        createdOn:{
            type:Date,
            default:Date.now
        },referalCode:{
            type:String,
        },redeemed:{
            type:Boolean
        },redeemedUsers:[{
            type:Schema.Types.ObjectId,
            ref:"User"
        }],
        searHistory:[{
            category:{
                type:Schema.Types.ObjectId,
                ref:"Category"
            },
            subCategory:{
                type:String
            }
        }],
        searchedOn:{
            type:Date  ,
            default:Date.now
        }
        
    



}, { timestamps: true }); // creates createdAt and updatedAt automatically

const User = mongoose.model('User', userSchema);

module.exports = User;
