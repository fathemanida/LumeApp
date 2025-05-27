const mongoose=require("mongoose");
const { schema } = require("./userSchema");
const {Schema}=mongoose;

const addressSchema= new mongoose.Schema({
    userId:{
       type:Schema.Types.ObjectId,
       ref:"User",
       required:true
    },address:[{
        addressType:{
            type:String,
            required:true
        }
    }],
    name:{
        type:String,
        required:true
    },
    city:{
        type:String,
        required:true,
    },
    landMark:{
        type:String 
        
    },state:{
        type:String,
        required:true
    },pincode:{
        type:Number,
        required:true
    },phone:{
        type:String,
        required:true
    },altPhone:{
        type:String,
        required:true 
    },
    houseNo:{
        type:String,
        required:false
    },roadArea:{
        type:String,
        required:false
    }
}) 
const Address=mongoose.model("Address",addressSchema)
module.exports=Address  