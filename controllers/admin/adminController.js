const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Order = require('../../models/orderSchema');

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
      return res.render("admin-login", {
        message: "Invalid Credentials",
      });
    }

    req.session.admin = {
      id: admin._id,
      email: admin.email,
      isAdmin: true,
    };

    res.redirect("/admin/dashboard");
  } catch (error) {
    console.log(error);
  }
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
    // Get total customers (excluding admins)
    const totalCustomers = await User.countDocuments({ isAdmin: false });

    // Get total products
    const totalProducts = await Product.countDocuments();

    // Get total orders and calculate revenue
    const orders = await Order.find();
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + (order.finalAmount || 0), 0);

    // Get recent orders (last 5)
    const recentOrders = await Order.find()
      .sort({ createdOn: -1 })
      .limit(5)
      .select('_id status createdOn')
      .lean();

    // Format recent orders
    const formattedRecentOrders = recentOrders.map(order => ({
      orderNumber: order._id.toString().slice(-6).toUpperCase(),
      status: order.status || 'Pending',
      createdOn: order.createdOn
    }));

    res.render('admin/dashboard', {
      totalCustomers,
      totalProducts,
      totalOrders,
      totalRevenue,
      recentOrders: formattedRecentOrders
    });
  } catch (error) {
    console.error('Error in loadDashboard:', error);
    res.status(500).render('error', { message: 'Error loading dashboard' });
  }
};

module.exports = {
  loadLogin,
  login,
  loadDashboard,
  pageError,
  logout,
};
