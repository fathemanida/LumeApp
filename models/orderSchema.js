const mongoose=require("mongoose")
const {Schema}=mongoose;
const {v4:uuidv4}=require("uuid");

const orderSchema=new Schema({
    
    orderId:{
         type:String,
         default:()=>uuidv4(),
         unique:true 
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    razorpayOrderId: {
        type: String
    },
    orderItems:[{
        productId:{
            type:Schema.Types.ObjectId,
            ref:"Product",
            required:true
        },
        quantity:{
            type:Number,
            required:true
        },
        price:{
            type:Number,
            required:true
        }
    }],
    totalPrice:{
        type:Number,
        required:true
    },
    discount:{
        type:Number,
        default:0
    },
    finalAmount:{
        type:Number,
        required:true
    },
    address:{
        type:Schema.Types.ObjectId,
        ref:"Address",
        required:true
    },
    paymentMethod: {
        type: String,
        required: true
    },
    paymentDetails: {
        type: Object
    },
    invoiceData:{
        type:Date
    },
    status:{
        type:String,
        enum:["Pending","Processing","Shipped","Delivered","Cancelled","Return Requested","Return Accepted","Return Rejected","Returned"],
        default:"Pending"
    },
    returnRequest: {
        type: {
            requestedAt: Date,
            reason: String,
            description: String,
            items: [{
                productId: {
                    type: Schema.Types.ObjectId,
                    ref: "Products"
                },
                quantity: Number
            }],
            status: {
                type: String,
                enum: ['Pending', 'Accepted', 'Rejected'],
                default: 'Pending'
            },
            adminResponse: String,
            respondedAt: Date
        },
        required: false,
        default: null
    },
    createdOn:{
        type:Date,
        default:Date.now,
        required:true
    },
    couponApplied:{
        type:Boolean,
        default:false
    },
    estimatedDelivery: {
        type: Date
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const Order=mongoose.model("Order",orderSchema);
module.exports = Order;