const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const pageError = async (req, res) => {
  try {
    return res.render("admin/pageError");
  } catch (error) {
    console.log("error in page 404", error);
    res.status(500).send("page not found");
  }
};

const loadLogin = async (req, res) => {
  try {
    if (req.session.admin) {
      return res.redirect("/admin/dashboard");
    }

    res.render("admin-login");
    console.log("Admin going to login");
  } catch (error) {
    console.log("Error in load AdminLogin");
  }
};

const login = async (req, res) => {
  try {
    console.log("admin here");
    const { email, password } = req.body;
    const admin = await User.findOne({ email });
    if (admin) {
      const userById = await User.findById(admin._id);
      console.log(userById);
    }
    if (!admin || !admin.isAdmin) {
      return res.redirect("/admin/login", {
        message: "Admintrator can Access only",
      });
    }

    const passwordMatch = await bcrypt.compare(password, admin.password);
    if (!passwordMatch) {
      return res.redirect("/admin/login", {
        message: "Invalid Credentials",
      });
    }

    req.session.admin = {
      id: admin._id,
      email: admin.email,
      isAdmin: true,
    };

    res.redirect("/admin/dashboard");
  } catch (error) {}
};

const logout = async (req, res) => {
  try {
    req.session.admin = null;
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
      }

      res.redirect("/admin/login");
    });
  } catch (error) {
    console.log("error in admin logout", error);
    res.render("pageError");
  }
};

const loadDashboard = async (req, res) => {
  try {
    if (!req.session.admin) {
      return res.redirect("/admin/login");
    }

    const adminData = await User.findById(req.session.admin.id);

    const totalUsers = await User.countDocuments({ isAdmin: false });
    const totalProducts = await Product.countDocuments({
      isListed: true,
      status: "Available",
    });
    const totalCategories = await Category.countDocuments({ isListed: true });

    const recentProducts = await Product.find({ isListed: true })
      .sort({ createdOn: -1 })
      .limit(5)
      .populate({
        path: "category",
        select: "name",
        match: { isListed: true },
      });

    const lowStockProducts = await Product.find({
      isListed: true,
      quantity: { $lt: 10 },
    })
      .limit(5)
      .populate({
        path: "category",
        select: "name",
        match: { isListed: true },
      });

    const totalSales = 0;

    const filteredRecentProducts = recentProducts.filter(
      (product) => product.category
    );
    const filteredLowStockProducts = lowStockProducts.filter(
      (product) => product.category
    );

    res.render("admin/dashboard", {
      admin: adminData,
      totalUsers: totalUsers || 0,
      totalProducts: totalProducts || 0,
      totalCategories: totalCategories || 0,
      totalSales: totalSales || 0,
      recentProducts: filteredRecentProducts || [],
      lowStockProducts: filteredLowStockProducts || [],
    });
  } catch (error) {
    console.error("Error in loadDashboard:", error);
    res.redirect("/admin/pageError");
  }
};

module.exports = {
  loadLogin,
  login,
  loadDashboard,
  pageError,
  logout,
};
