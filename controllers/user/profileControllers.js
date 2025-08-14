const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const env = require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/uploads/user");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed!"));
  },
}).single("profileImage");

///////forgot password///////

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
      from: `"Lume Elegence" <${process.env.NODEMAILER_EMAIL}>`,
      to: email,
      subject: "Your OTP for Password Reset",
      text: `Hi there,\n\nYour OTP for password reset is: ${otp}\n\nIf you didn’t request this, please ignore the email.`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h3>Password Reset OTP</h3>
          <p>Your OTP is:</p>
          <h2 style="color:#333;">${otp}</h2>
          <p>If you did not request this, please ignore this email.</p>
        </div>
      `,
    };

    const info = await transport.sendMail(mailOptions);
    console.log(`OTP email sent to: ${email}`);
    return info.accepted.length > 0;
  } catch (error) {
    console.log("Error in sending email:", error);
    return false;
  }
}

module.exports = sendVerificationEmail;


const getForgotPasspage = async (req, res) => {
  try {
    res.render("forgot-emailCheck");
  } catch (error) {}
};

const forgotEmailValid = async (req, res) => {
  try {
    const { email } = req.body;
    const findUser = await User.findOne({ email });
    if(!findUser){
     res.render('forgot-emailCheck',{
      message:`User not found.Please provide valid email`
     })
    }
    console.log(findUser);
    if (findUser) {
      const otp = generateOtp();
      const emailSent = await sendVerificationEmail(email, otp);
      if (emailSent) {
        req.session.userOtp = otp;
        req.session.email = email;
        req.session.save(() => {
          res.render("forgotPass-otp");
          console.log("OTP:", otp);
        });
      } else {
        res.json({
          seccess: false,
          message: "Failed to send OTP,Please try again",
        });
      }
    } else {
      console.log("user entered to otp page");
      res.render("forgotPass-otp", {
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
    res
      .status(500)
      .json({
        success: false,
        message: "error in verify otp for reser password",
      });
  }
};

const forgotresendOtp = async (req, res) => {
  try {
    const email = req.session.email;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email not fond in session" });
    }
    const otp = generateOtp();
    req.session.userOtp = otp;
    console.log("resending otp", email);

    const emailSent = await sendVerificationEmail(email, otp);
    if (emailSent) {
      console.log("Resend OTP:", otp);
      res
        .status(200)
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
};
const getResetPassword = async (req, res) => {
  try {
    res.render("reset-password");
  } catch (error) {
    res.redirect("/pageError");
  }
};

const checkNewPassword = async (req, res) => {
  try {
    console.log("reached reset password");
    const { password, Cpassword } = req.body;
    const email = req.session.email;

    if (password === Cpassword) {
      const passwordHash = await securePassword(password);
      await User.updateOne({ email }, { $set: { password: passwordHash } });

      return res.redirect("/login");
    } else {
      return res.render("reset-password", {
        message: "Passwords do not match",
      });
    }
  } catch (error) {
    console.log("Error in reset password:", error);
    return res.render("pageError");
  }
};
const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.session.user.id;

    const existingUser = await User.findOne({ email, _id: { $ne: userId } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "This email is already registered",
      });
    }

    const otp = generateOtp();
    req.session.otp = otp;
    req.session.otpGeneratedAt = new Date();
    req.session.pendingEmail = email;
    console.log("otp generated", otp);

    const emailSent = await sendVerificationEmail(email, otp);
    if (emailSent) {
      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP",
      });
    }
  } catch (error) {
    console.error("Error in sendOtp:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const OTP_EXPIRY_SECONDS = 300;

    if (
      !req.session.otp ||
      !req.session.otpGeneratedAt ||
      !req.session.pendingEmail
    ) {
      return res.status(400).json({
        success: false,
        message: "No active OTP found. Please request a new one.",
      });
    }

    const currentTime = Date.now();
    const otpExpiryTime =
      new Date(req.session.otpGeneratedAt).getTime() +
      OTP_EXPIRY_SECONDS * 1000;

    if (currentTime > otpExpiryTime) {
      req.session.otp = null;
      req.session.otpGeneratedAt = null;
      req.session.pendingEmail = null;

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one.",
      });
    }

    if (otp === req.session.otp) {
      req.session.emailVerified = true;
      req.session.verifiedEmail = req.session.pendingEmail;

      req.session.otp = null;
      req.session.otpGeneratedAt = null;
      req.session.pendingEmail = null;

      return res.json({
        success: true,
        message: "Email verified successfully",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please try again.",
      });
    }
  } catch (error) {
    console.error("Error in verifyOtp:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

///////profile///////

const profile = async (req, res) => {
  try {
   


const userId = req.session.user.id;
const userData = await User.findById(userId).lean();

console.log('user====',  userData);



    res.render("profile", {
      users: userData,
    });
  } catch (error) {
    console.log("error in profile getting", error);
    res.redirect("/page404");
  }
};

const editProfile = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }
    const userId = req.session.user.id;
    const userData = await User.findById(userId);

    if (!userData) {
      return res.redirect("/login");
    }

    res.render("profile-edit", {
      users: userData,
    });
  } catch (error) {
    console.error("Error in editProfile:", error);
    res.redirect("/page404");
  }
};



const getEditProfile = async (req, res) => {
  try {
  

    if (!req.session.user) {
      return res.redirect("/login");
    }

    const userId = req.session.user.id;
    const updates = {};

    if (req.file) {
      updates.profileImage = req.file.filename;
    }

    if (req.body.name) {
      updates.name = req.body.name;
    }
    if (req.body.phone) {
      updates.phone = req.body.phone;
    }

    if (req.body.email && req.body.email !== req.session.user.email) {
      console.log('email change');
      if (!req.session.emailVerified) {
        console.log('email not verified');
        return res.status(400).json({
          success: false,
          message: "Please verify your new email address first",
        });
      }
      updates.email = req.body.email;
    }

    try {
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true }
      );

      if (!updatedUser) {
        console.log('user not found in db');
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      console.log('updated user successfully:', updatedUser);
      req.session.user = {
        ...req.session.user,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        profileImage: updatedUser.profileImage,
      };

      delete req.session.emailVerified;

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
      });
    } catch (error) {
      console.error("profile update error", error);
      return res.status(500).json({
        success: false,
        message: "Error updating profile",
      });
    }
  } catch (error) {
    console.error("Error in getEditProfile:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating profile",
    });
  }
};

/////  ADDRESS  /////

const address = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }
    const userId = req.session.user.id;
    const addresses = await Address.find({ userId }).sort({ isDefault: -1 });
    
    res.render("address", {
      user: req.session.user,
      addresses: addresses
    });
  } catch (error) {
    console.log("error in address page", error);
    res.redirect("/pageError");
  }
};

const getAddAdress = async (req, res) => {
  try {
    const from = req.query.from;
    res.render("address-add", { from });
  } catch (error) {
    console.log("error in get add address", error);
    res.redirect("/pageError");
  }
};

const addAddress = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { 
      name, 
      houseNo, 
      roadArea, 
      city, 
      state, 
      pincode, 
      phone,
      altPhone,
      addressType = 'home' 
    } = req.body;
    const from = req.query.from;

    console.log('new address', {
      userId,
      name,
      houseNo,
      roadArea,
      city,
      state,
      pincode,
      phone,
      altPhone,
      addressType
    });

    const newAddress = new Address({
      userId,
      name,
      houseNo,
      roadArea,
      city,
      state,
      pincode,
      phone,
      altPhone,
      addressType,
      isDefault: false
    });

    await newAddress.save();

    if (req.xhr || req.headers.accept.includes('application/json')) {
      return res.status(200).json({
        success: true,
        message: 'Address added successfully'
      });
    }

    if (from === 'address') {
      res.redirect('/addresst');
    } else {
      res.redirect('/checkout');
    }
  } catch (error) {
    console.error("error in addAddress", error);
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      if (req.xhr || req.headers.accept.includes('application/json')) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validationErrors
        });
      }
      req.flash('error', validationErrors.join(', '));
      return res.redirect('/add-address');
    }
    if (req.xhr || req.headers.accept.includes('application/json')) {
      return res.status(500).json({
        success: false,
        message: 'Failed to add address'
      });
    }
    req.flash('error', 'Failed to add address');
    res.redirect("/pageError");
  }
};

const getEditAddress = async (req, res) => {
  try {
    const addressId = req.params.id;
    const from = req.query.from;
    
    const address = await Address.findById(addressId);
    
    if (!address) {
      return res.redirect('/address');
    }

    console.log('Address found', address);
    
    const formattedAddress = {
      _id: address._id,
      name: address.name,
      phone: address.phone,
      altPhone: address.altPhone || '',
      pincode: address.pincode,
      state: address.state,
      city: address.city,
      houseNo: address.houseNo || '',
      roadArea: address.roadArea || '',
      addressType: address.addressType || 'home'
    };

    res.render("address-edit", { 
      address: formattedAddress, 
      from,
      user: req.session.user 
    });
  } catch (error) {
    console.log("Error in getEditAddress:", error);
    res.redirect("/pageError");
  }
};

const updateAddress = async (req, res) => {
  try {
    const addressId = req.params.id;
    const from = req.query.from;
    const { 
      name, 
      houseNo, 
      roadArea, 
      city, 
      state, 
      pincode, 
      phone,
      altPhone,
      addressType 
    } = req.body;

    console.log('updating address', {
      addressId,
      name,
      houseNo,
      roadArea,
      city,
      state,
      pincode,
      phone,
      altPhone,
      addressType
    });

    const updatedAddress = await Address.findByIdAndUpdate(
      addressId,
      {
        name,
        houseNo,
        roadArea,
        city,
        state,
        pincode,
        phone,
        altPhone,
        addressType
      },
      { new: true }
    );

    if (!updatedAddress) {
      console.log('Address not found ');
      return res.status(404).json({ 
        success: false, 
        message: 'Address not found' 
      });
    }

    console.log('Address updated successfully:', updatedAddress);

    if (from === 'checkout') {
      res.redirect('/checkout');
    } else {
      res.redirect('/address');
    }
  } catch (error) {
    console.log("Error in updateAddress", error);
    res.redirect("/pageError");
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const { addressId } = req.body;
    const userId = req.session.user.id;

    console.log('Setting default address:', { addressId, userId });

    if (!addressId) {
      return res.status(400).json({
        success: false,
        message: 'Address ID is required'
      });
    }

    await Address.updateMany(
      { userId },
      { $set: { isDefault: false } }
    );

    const updatedAddress = await Address.findOneAndUpdate(
      { _id: addressId, userId },
      { $set: { isDefault: true } },
      { new: true }
    );

    if (!updatedAddress) {
      return res.status(404).json({ 
        success: false, 
        message: 'Address not found or does not belong to user' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Default address updated successfully' 
    });
  } catch (error) {
    console.error("Error in setDefaultAddress:", error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update default address' 
    });
  }
};

const resendOtp = async (req, res) => {
  try {
    const pendingEmail = req.session.pendingEmail;
    if (!pendingEmail) {
      return res.status(400).json({
        success: false,
        message: "No pending email verification found",
      });
    }

    const otp = generateOtp();
    req.session.otp = otp;
    req.session.otpGeneratedAt = new Date();
    console.log("resendotp", otp);

    const emailSent = await sendVerificationEmail(pendingEmail, otp);
    if (emailSent) {
      return res.status(200).json({
        success: true,
        message: "OTP resent successfully",
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Failed to resend OTP",
      });
    }
  } catch (error) {
    console.error("Error in resendOtp:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const removeAddress = async (req, res) => {
  try {
    const { addressId } = req.body;
    const userId = req.session.user.id;


    const addressCount = await Address.countDocuments({ userId });
    if (addressCount <= 1) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot remove the last address. Please add another address first.' 
      });
    }

    const address = await Address.findById(addressId);
    if (!address) {
      console.log('Address not found');
      return res.status(404).json({ 
        success: false, 
        message: 'Address not found' 
      });
    }

    if (address.isDefault) {
      console.log('Removing default address, finding new default');
      const anotherAddress = await Address.findOne({ 
        userId, 
        _id: { $ne: addressId } 
      });
      
      if (anotherAddress) {
        anotherAddress.isDefault = true;
        await anotherAddress.save();
        console.log('New default address set:', anotherAddress._id);
      }
    }

    await Address.findByIdAndDelete(addressId);

    res.json({ 
      success: true, 
      message: 'Address removed successfully' 
    });
  } catch (error) {
    console.error("Error in removeAddress:", error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove address' 
    });
  }
};


const getChangePassword=async (req,res) => {
  try {
    if(!req.session.user){
     return res.status(400).json({success:false,message:'login required'})
    }

    res.render('change-password')
  } catch (error) {
    console.log('error getting chnage password page',error);
    res.rnder('page404')
  }
}


const changePassword = async (req, res) => {
  try {
    if (!req.session.user) {
  return res.status(401).json({ success: false, message: 'please log in' });
}

    
    console.log('Req body:', req.body);
    const userId = req.session.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        success: false, 
        message: "All password fields are required" 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: "Current password is incorrect" 
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        success: false, 
        message: "New passwords do not match" 
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    return res.status(200).json({ 
      success: true, 
      message: "Password changed successfully" 
    });

  } catch (error) {
    console.error("change password error", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
}

module.exports = {
  getForgotPasspage,
  forgotEmailValid,
  verifypassOTP,
  getResetPassword,
  forgotresendOtp,
  checkNewPassword,
  profile,
  editProfile,
  getEditProfile,
  address,
  getEditAddress,
  sendOtp,
  verifyOtp,
  resendOtp,
  getAddAdress,
  addAddress,
  getEditAddress,
  updateAddress,
  setDefaultAddress,
  removeAddress,
  getChangePassword,
  changePassword
};
