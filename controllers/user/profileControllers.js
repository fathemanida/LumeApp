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
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: "Your OTP for Password rest",
      text: `Your OTP is ${otp}`,
      html: `<b4><h4>Your OTP:${otp}</h4></b4>`,
    };

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

///////profile///////

const profile = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const userId = req.session.user.id;
    const userData = await User.findById(userId);

    if (!userData) {
      return res.redirect("/login");
    }

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
      user: userData,
    });
  } catch (error) {
    console.error("Error in editProfile:", error);
    res.redirect("/page404");
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
      // Mark email as verified in session
      req.session.emailVerified = true;
      req.session.verifiedEmail = req.session.pendingEmail;

      // Clear OTP session data
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

const getEditProfile = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const userId = req.session.user.id;
    const updates = {};

    if (req.file) {
      updates.profileImage = `/uploads/${req.file.filename}`;
    }

    if (req.body.name) updates.name = req.body.name;
    if (req.body.phone) updates.phone = req.body.phone;

    if (req.body.email && req.body.email !== req.session.user.email) {
      if (!req.session.emailVerified) {
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
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

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
      console.error("Database update error:", error);
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
      res.redirect("/login");
    }
    const user = req.session.user;
    res.render("address", {
      user: user,
    });
  } catch (error) {}
};

const getAddAdress = async (req, res) => {
  try {
     const userId = req.session.user.id;

    const addressData = await Address.findOne({ userId });

    if (!addressData) {
      return res.redirect('address'); 
    }

    res.render("address-add", { address: addressData });
  } catch (error) {
    console.log("error in get add addrss", error);
    res.render("page404");
  }
};

const addAddress = async (req, res) => {
  try {
    const {
      fullName,
      phoneNumber,
      alternatePhoneNumber,
      pincode,
      state,
      city,
      houseNo,
      roadName,
    } = req.body;

    
    console.log(req.body);

  
    if (!fullName || !phoneNumber || !pincode || !state || !city) {
      return res.status(400).json({ message: "All required fields must be filled" });
    }

   
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({ message: "Phone number must be 10 digits" });
    }
    if (alternatePhoneNumber && !phoneRegex.test(alternatePhoneNumber)) {
      return res.status(400).json({ message: "Alternate phone number must be 10 digits if provided" });
    }

    
    const pincodeRegex = /^[0-9]{6}$/;
    if (!pincodeRegex.test(pincode)) {
      return res.status(400).json({ message: "Pincode must be 6 digits" });
    }

    
    const newAddress = new Address({
      userId: req.session.user.id,
      name:fullName,
      phone:phoneNumber,
      altPhone: alternatePhoneNumber || null,
      pincode,
      state,
      city,
      houseNo: houseNo || null,
      roadName: roadName || null,
      
    });

    await newAddress.save();
    console.log("Address saved successfully");
    return res.status(200).json({ message: "Address saved successfully" });
  } catch (error) {
    console.error("Error in addAddress:", error);
    return res.status(500).json({ message: "Server error: " + error.message });
  }
};



const getEditAddress = async (req, res) => {
  try {
    const userId = req.session.user.id;

    const addressData = await Address.findOne({ userId });

    if (!addressData) {
      return res.redirect('address'); 
    }

    res.render("address-edit", { address: addressData });
  } catch (error) {
    console.error("Error loading edit address:", error);
    res.status(500).send("Server error");
  }
};



const updateAddress = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const {
      name,
      phone,
      altPhone,
      pincode,
      state,
      city,
      houseNo,
      roadArea,
      addressType
    } = req.body;

    
    if (!name || !phone || !pincode || !state || !city || !addressType) {
      return res.status(400).json({ message: "All required fields must be filled" });
    }

    
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ message: "Phone number must be 10 digits" });
    }
    if (altPhone && !phoneRegex.test(altPhone)) {
      return res.status(400).json({ message: "Alternate phone number must be 10 digits if provided" });
    }

   
    const pincodeRegex = /^[0-9]{6}$/;
    if (!pincodeRegex.test(pincode)) {
      return res.status(400).json({ message: "Pincode must be 6 digits" });
    }

    const existingAddress = await Address.findOne({ userId });

    if (!existingAddress) {
      return res.status(404).json({ message: 'Address not found' });
    }

    
    existingAddress.name = name;
    existingAddress.phone = phone;
    existingAddress.altPhone = altPhone || null;
    existingAddress.pincode = pincode;
    existingAddress.state = state;
    existingAddress.city = city;
    existingAddress.houseNo = houseNo || null;
    existingAddress.roadArea = roadArea || null;
    existingAddress.addressType= addressType ||null;

   
    if (!existingAddress.address || existingAddress.address.length === 0) {
      existingAddress.address = [{ addressType }];
    } else {
      existingAddress.address[0].addressType = addressType;
    }

    
    await existingAddress.save();

    return res.status(200).json({ message: "Address updated successfully" });
  } catch (err) {
    console.error('Error updating address:', err);
    return res.status(500).json({ message: "Server error: " + err.message });
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
  updateAddress
  
};
