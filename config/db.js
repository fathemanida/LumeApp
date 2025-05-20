const mongoose=require("mongoose");
const env=require('dotenv').config();


const connectDB=async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('db connect');
    } catch (error) {
        console.log("DB could not Connect,",error.message);
        process.exit(1)
    }
}
module.exports=connectDB