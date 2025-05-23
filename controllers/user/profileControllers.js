const User = require("../../models/userSchema");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");



const securePassword = async (passsword) => {
  const passwordHash = await bcrypt.hash(passsword, 10);
  return passwordHash;
};

function generateOtp() {
  return Math.floor(10000 + Math.random() * 900000).toString();
}
async function sendVerificationEmail(email, otp) {
  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: "Your OTP for Password rest",
      text: `Your OTP is ${otp}`,
      html: `<b4><h4>Your OTP:${otp}</h4></b4>`,
    };

    //console.log("heloooooooooo");
    const info = await transport.sendMail({
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: "Verify your Account",
      text: `Thank you for signing up. Please verify your email address by entering the given OTP: ${otp}`,
      html: `<b>Your OTP: ${otp}</b>`,
    });
    console.log(email);
    return info.accepted.length > 0;
  } catch (error) {
    console.log("error in sending email", error);
    return false;
  }
}

const getForgotPasspage = async (req, res) => {
  try {
    res.render("forgot-emailCheck");
  } catch (error) {}
};

const forgotEmailValid = async (req, res) => {
  try {
    const { email } = req.body;
    const findUser = await User.findOne({ email });
    console.log(findUser);
    if (findUser) {
      const otp = generateOtp();
      const emailSent = await sendVerificationEmail(email, otp);
      if (emailSent) {
        req.session.userOtp = otp;
        req.session.email = email;
        req.session.save(()=>{
            res.render("forgotPass-otp");
        console.log("OTP:", otp);
        })
       
      } else {
        res.json({
          seccess: false,
          message: "Failed to send OTP,Please try again",
        });
      }
    } else {
        console.log('user entered to otp page');
      res.render("forgot-password", {
        message: "Userwith this email does not exists",
      });
    }
  } catch (error) {
    console.log("error in valid email");
    res.redirect("/pageError");
  }
};

const verifypassOTP = async (req, res) => {
  try {
    const { otp } = req.body;
    console.log(otp);
    console.log("Entered OTP:", otp);
    console.log("Stored OTP:", req.session.userOtp);

    if (otp === req.session.userOtp) {
      

      console.log("Did we reach here?");

      return res.json({
        success: true,
        message: "OTP Verified successfully!",
        redirectUrl: "/reset-password",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP, please try again!",
      });
    }
  } catch (error) {
    res.status(500).json({success:false,message:"error in verify otp for reser password"})
  }
};

const forgotresendOtp=async (req,res) => {

  try {
    const email  = req.session.email;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email not fond in session" });
    }
    const otp = generateOtp();
    req.session.userOtp = otp;
    console.log('resending otp',email);

    const emailSent = await sendVerificationEmail(email, otp);
    if (emailSent) {
      console.log("Resend OTP:", otp);
      res.status(200)
        .json({ success: true, message: "OTP Resend successfully" });
    } else {
      res.status(500).json({
        success: false,
        message: "Sorry,Failed to resend OTP.Please try again",
      });
    }
  } catch (error) {
    console.log("error in new password resend", error);
    res.status(500).send("error in resend backend");
  }
}
const getResetPassword=async (req,res) => {


    try {
        res.render("reset-password")
    } catch (error) {
        res.redirect("/pageError")
    }
    
}

const checkNewPassword = async (req, res) => {
  try {
    const { password, Cpassword } = req.body;
    const email = req.session.email;

    if (password === Cpassword) {
      const passwordHash = await securePassword(password);
      await User.updateOne({ email }, { $set: { password: passwordHash } });

      return res.redirect('/login');
    } else {
      return res.render("reset-password", { message: "Passwords do not match" });
    }
  } catch (error) {
    console.log('Error in reset password:', error);
    return res.render("pageError");
  }
};


module.exports = {
  getForgotPasspage,
  forgotEmailValid,
  verifypassOTP,
  getResetPassword,
  forgotresendOtp,
  checkNewPassword
};
