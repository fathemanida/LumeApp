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
    const { period, startDate, endDate } = req.query;
    let dateQuery = {};
    let previousPeriodStart, previousPeriodEnd;

    const now = new Date();
    if (period === 'daily') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setDate(start.getDate() - 1);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setDate(end.getDate() - 1);
    } else if (period === 'weekly') {
      const start = new Date(now);
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setDate(start.getDate() - 7);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setDate(end.getDate() - 7);
    } else if (period === 'monthly') {
      const start = new Date(now);
      start.setMonth(now.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setMonth(start.getMonth() - 1);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setMonth(end.getMonth() - 1);
    } else if (period === 'yearly') {
      const start = new Date(now);
      start.setFullYear(now.getFullYear() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setFullYear(start.getFullYear() - 1);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setFullYear(end.getFullYear() - 1);
    } else if (period === 'custom' && startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      const duration = end - start;
      previousPeriodStart = new Date(start);
      previousPeriodStart.setTime(previousPeriodStart.getTime() - duration);
      previousPeriodEnd = new Date(start);
    } else {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setDate(start.getDate() - 1);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setDate(end.getDate() - 1);
    }

    const orders = await Order.find(dateQuery).sort({ createdOn: 1 });
    console.log('Date query:', dateQuery);
    console.log('Found orders:', orders.length);
    console.log('First order:', orders[0]);

    const totalOrders = orders.length;
    const totalSales = orders.reduce((sum, order) => sum + (order.finalAmount || 0), 0);
    const totalDiscounts = orders.reduce((sum, order) => sum + (order.discount || 0), 0);
    const totalCoupons = orders.filter(order => order.couponCode).length;

    console.log('Summary data:', {
        totalOrders,
        totalSales,
        totalDiscounts,
        totalCoupons
    });

    const previousOrders = await Order.find({
        createdOn: { $gte: previousPeriodStart, $lte: previousPeriodEnd }
    });
    console.log('Previous period query:', {
        start: previousPeriodStart,
        end: previousPeriodEnd
    });
    console.log('Previous period orders:', previousOrders.length);

    const previousTotalOrders = previousOrders.length;
    const previousTotalSales = previousOrders.reduce((sum, order) => sum + (order.finalAmount || 0), 0);
    const previousTotalDiscounts = previousOrders.reduce((sum, order) => sum + (order.discount || 0), 0);
    const previousTotalCoupons = previousOrders.filter(order => order.couponCode).length;

    console.log('Previous period summary:', {
        totalOrders: previousTotalOrders,
        totalSales: previousTotalSales,
        totalDiscounts: previousTotalDiscounts,
        totalCoupons: previousTotalCoupons
    });

    const calculatePercentageChange = (current, previous) => {
      if (previous === 0) return 100;
      return ((current - previous) / previous) * 100;
    };

    const chartData = orders.reduce((acc, order) => {
      const date = new Date(order.createdOn).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = {
          grossSales: 0,
          discounts: 0,
          netSales: 0
        };
      }
      acc[date].grossSales += order.finalAmount || 0;
      acc[date].discounts += order.discount || 0;
      acc[date].netSales += (order.finalAmount || 0) - (order.discount || 0);
      return acc;
    }, {});

    const tableData = Object.entries(chartData).map(([date, data]) => ({
      date,
      orders: orders.filter(order => new Date(order.createdOn).toLocaleDateString() === date).length,
      grossSales: data.grossSales,
      discounts: data.discounts,
      coupons: orders.filter(order => 
        order.couponCode && 
        new Date(order.createdOn).toLocaleDateString() === date
      ).length,
      netSales: data.netSales,
      status: 'Active'
    }));

    const sortedTableData = tableData.sort((a, b) => {
  return new Date(b.date) - new Date(a.date); // newest first
});


    const totalCustomers = await User.countDocuments({ isAdmin: false });

    const totalProducts = await Product.countDocuments();

    const recentOrders = await Order.find()
      .sort({ createdOn: -1 })
      .limit(5)
      .select('_id status createdOn')
      .lean();

    const formattedRecentOrders = recentOrders.map(order => ({
      orderNumber: order._id.toString().slice(-6).toUpperCase(),
      status: order.status || 'Pending',
      createdOn: order.createdOn
    }));

    res.render('admin/dashboard', {
      totalCustomers,
      totalProducts,
      totalOrders,
      totalRevenue: totalSales,
      recentOrders: formattedRecentOrders,
      salesData: {
        summary: {
          totalOrders: {
            value: totalOrders,
            change: calculatePercentageChange(totalOrders, previousTotalOrders)
          },
          totalSales: {
            value: totalSales,
            change: calculatePercentageChange(totalSales, previousTotalSales)
          },
          totalDiscounts: {
            value: totalDiscounts,
            change: calculatePercentageChange(totalDiscounts, previousTotalDiscounts)
          },
          totalCoupons: {
            value: totalCoupons,
            change: calculatePercentageChange(totalCoupons, previousTotalCoupons)
          },
            tableData: sortedTableData

        },
        chartData: {
          labels: Object.keys(chartData),
          datasets: [
            {
              label: 'Gross Sales',
              data: Object.values(chartData).map(d => d.grossSales)
            },
            {
              label: 'Discounts',
              data: Object.values(chartData).map(d => d.discounts)
            },
            {
              label: 'Net Sales',
              data: Object.values(chartData).map(d => d.netSales)
            }
          ]
        },
        tableData
      }
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
  logout
};
