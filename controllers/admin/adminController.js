const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Order = require('../../models/orderSchema');
const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const moment = require('moment');


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











const loadSalesreport = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    let dateQuery = {};
    let previousPeriodStart, previousPeriodEnd;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDate = now.getDate();

    const createDateWithTime = (year, month, date, hours, minutes, seconds, ms) => {
      const d = new Date(year, month, date, hours, minutes, seconds, ms);
      return d;
    };

    if (period === 'daily') {
      const start = createDateWithTime(currentYear, currentMonth, currentDate, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setDate(start.getDate() - 1);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setDate(end.getDate() - 1);
    } else if (period === 'weekly') {
      const start = createDateWithTime(currentYear, currentMonth, currentDate - 7, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setDate(start.getDate() - 7);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setDate(end.getDate() - 7);
    } else if (period === 'monthly') {
      const start = createDateWithTime(currentYear, currentMonth - 1, 1, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setMonth(start.getMonth() - 1);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setMonth(end.getMonth() - 1);
    } else if (period === 'yearly') {
      const start = createDateWithTime(currentYear - 1, currentMonth, currentDate, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
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
      previousPeriodEnd.setTime(previousPeriodEnd.getTime() - 1);
    } else {
      const start = createDateWithTime(currentYear, currentMonth, currentDate, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
      previousPeriodStart = new Date(start);
      previousPeriodStart.setDate(start.getDate() - 1);
      previousPeriodEnd = new Date(end);
      previousPeriodEnd.setDate(end.getDate() - 1);
    }

    console.log('Current period query:', {
      start: dateQuery.createdOn.$gte,
      end: dateQuery.createdOn.$lte
    });

    const orders = await Order.find(dateQuery)
      .populate('userId', 'name')
      .sort({ createdOn: 1 });
      if (!orders || orders.length === 0) {
  return res.render('admin/sales-report', {
    totalCustomers: await User.countDocuments({ isAdmin: false }),
    totalProducts: await Product.countDocuments(),
    totalOrders: 0,
    totalRevenue: 0,
    recentOrders: [],
    noData: true, 
    salesData: {
      summary: {
        totalOrders: { value: 0, change: 0 },
        totalSales: { value: 0, change: 0 },
        totalDiscounts: { value: 0, change: 0 },
        totalCoupons: { value: 0, change: 0 },
        tableData: []
      },
      chartData: { labels: [], datasets: [] },
      tableData: []
    }
  });
}

    console.log('Found orders:', orders.length);
    if (orders.length > 0) {
      console.log('First order date:', orders[0].createdOn);
      console.log('Last order date:', orders[orders.length - 1].createdOn);
    }

    const filteredOrders = orders.filter(order => order.status !== 'Cancelled' && order.status !== 'Returned');

    const totalOrders = filteredOrders.length;
    const totalSales = filteredOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const totalDiscounts = filteredOrders.reduce((sum, order) => 
      sum + (order.couponDiscount || 0) + (order.offerDiscount || 0), 0);
    const totalCoupons = filteredOrders.filter(order => order.usedCoupon).length;
    console.log('userd cpn',totalCoupons);

    console.log('Summary data:', {
        totalOrders,
        totalSales,
        totalDiscounts,
        totalCoupons
    });

    const previousOrders = await Order.find({
        createdOn: { $gte: previousPeriodStart, $lte: previousPeriodEnd }
    }).populate('userId', 'name');

    console.log('Previous period query:', {
        start: previousPeriodStart,
        end: previousPeriodEnd
    });
    console.log('Previous period orders:', previousOrders.length);

    const previousTotalOrders = previousOrders.length;
    const previousTotalSales = previousOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const previousTotalDiscounts = previousOrders.reduce((sum, order) => 
      sum + (order.couponDiscount || 0) + (order.offerDiscount || 0), 0);
    const previousTotalCoupons = previousOrders.filter(order => order.usedCoupon).length;

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

    const chartData = filteredOrders.reduce((acc, order) => {
      const date = new Date(order.createdOn).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = {
          grossSales: 0,
          discounts: 0,
          netSales: 0
        };
      }
      const orderGross = (order.items || []).reduce((sum, item) => {
        return sum + (item.originalPrice || (item.price * item.quantity) || 0);
      }, 0);
      const orderDiscounts = (order.couponDiscount || 0) + (order.offerDiscount || 0);
      acc[date].grossSales += orderGross;
      acc[date].discounts += orderDiscounts;
      acc[date].netSales += orderGross - orderDiscounts;
      return acc;
    }, {});

    const tableData = Object.entries(chartData).map(([date, data]) => ({
      date,
      orders: filteredOrders.filter(order => new Date(order.createdOn).toLocaleDateString() === date).length,
      grossSales: data.grossSales,
      discounts: data.discounts,
      coupons: filteredOrders.filter(order => 
        order.usedCoupon && 
        new Date(order.createdOn).toLocaleDateString() === date
      ).length,
      netSales: data.netSales,
      status: 'Active'
    }));

    const sortedTableData = tableData.sort((a, b) => {
  return new Date(b.date) - new Date(a.date); 
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

    res.render('admin/sales-report', {
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
    console.error('Error in report', error);
    res.status(500).render('error', { message: 'Error loading dashboard' });
  }
};

const downloadReport = async (req, res) => {
  try {
    const { period, format, startDate, endDate } = req.query;
    let dateQuery = {};

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDate = now.getDate();

    const createDateWithTime = (year, month, date, hours, minutes, seconds, ms) => {
      const d = new Date(year, month, date, hours, minutes, seconds, ms);
      return d;
    };

    if (period === 'daily') {
      const start = createDateWithTime(currentYear, currentMonth, currentDate, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
    } else if (period === 'weekly') {
      const start = createDateWithTime(currentYear, currentMonth, currentDate - 7, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
    } else if (period === 'monthly') {
      const start = createDateWithTime(currentYear, currentMonth - 1, 1, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
    } else if (period === 'yearly') {
      const start = createDateWithTime(currentYear - 1, currentMonth, currentDate, 0, 0, 0, 0);
      const end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
    } else if (period === 'custom' && startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateQuery = { createdOn: { $gte: start, $lte: end } };
    }

    console.log('Report date query:', {
      start: dateQuery.createdOn.$gte,
      end: dateQuery.createdOn.$lte
    });

    const orders = await Order.find(dateQuery)
      .populate('userId', 'name')
      .sort({ createdOn: 1 });
 if (!orders || orders.length === 0) {
  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sales Report');

    worksheet.addRow(['LEMO Sales Report']);
    worksheet.addRow([]);
    worksheet.addRow(['⚠️ No data available for the selected period.']);

    worksheet.getRow(1).font = { bold: true, size: 16 };
    worksheet.getRow(1).alignment = { horizontal: 'center' };
    worksheet.mergeCells('A1:C1');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=sales-report.xlsx');
    await workbook.xlsx.write(res);
    return res.end();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({
      size: [900, 600],
      margin: 30
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=sales-report.pdf');

    doc.pipe(res);

    doc.rect(0, 0, doc.page.width, 100).fill('#2d2d2d');

    doc.fontSize(28).fillColor('#c5a267').text('LEMO', { align: 'left', x: 40, y: 40 });
    doc.fontSize(24).fillColor('#ffffff').text('Sales Report', { align: 'center', y: 40 });
    doc.fontSize(12).fillColor('#dac6a4').text(`Period: ${period}`, { align: 'center', y: 70 });

    doc.moveDown(4);
    doc.fontSize(22).fillColor('#e74c3c').text('⚠️ No data available for the selected period', {
      align: 'center'
    });

    const footerText = `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`;
    doc.fontSize(10).fillColor('#b3b3b3').text(footerText, { align: 'center', y: doc.page.height - 50 });

    doc.end();
    return;
  }

  return res.status(200).send('No data available for the selected period');
}

    console.log('Found orders for report:', orders.length);
    if (orders.length > 0) {
      console.log('First order date:', orders[0].createdOn);
      console.log('Last order date:', orders[orders.length - 1].createdOn);
    }

    const filteredOrders = orders.filter(order => order.status !== 'Cancelled' && order.status !== 'Returned');

    const reportData = filteredOrders.map(order => {
      const grossSales = (order.items || []).reduce((sum, item) => {
        return sum + (item.originalPrice || (item.price * item.quantity) || 0);
      }, 0);
      const discounts = (order.couponDiscount || 0) + (order.offerDiscount || 0);
      const netSales = grossSales - discounts;
      return {
        date: new Date(order.createdOn).toLocaleDateString(),
        orderId: order._id.toString().slice(-6).toUpperCase(),
        customer: order.userId ? order.userId.name : 'N/A',
        grossSales: grossSales,
        discounts: discounts,
        netSales: netSales,
        status: order.status || 'Pending',
        paymentMethod: order.paymentMethod || 'N/A'
      };
    });

    console.log('prcessed report', reportData.length); 

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Sales Report');

      worksheet.columns = [
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Order ID', key: 'orderId', width: 15 },
        { header: 'Customer', key: 'customer', width: 20 },
        { header: 'Gross Sales (₹)', key: 'grossSales', width: 15 },
        { header: 'Discounts (₹)', key: 'discounts', width: 15 },
        { header: 'Net Sales (₹)', key: 'netSales', width: 15 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Payment Method', key: 'paymentMethod', width: 15 }
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDAC6A4' }
      };

      reportData.forEach(row => {
        const dataRow = worksheet.addRow({
          date: row.date,
          orderId: row.orderId,
          customer: row.customer,
          grossSales: row.grossSales,
          discounts: row.discounts,
          netSales: row.netSales,
          status: row.status,
          paymentMethod: row.paymentMethod
        });

        dataRow.getCell('grossSales').numFmt = '₹#,##0.00';
        dataRow.getCell('discounts').numFmt = '₹#,##0.00';
        dataRow.getCell('netSales').numFmt = '₹#,##0.00';
      });

      const totalGrossSales = reportData.reduce((sum, row) => sum + row.grossSales, 0);
      const totalDiscount = reportData.reduce((sum, row) => sum + row.discounts, 0);
      const totalNetSales = reportData.reduce((sum, row) => sum + row.netSales, 0);

      const summaryRow = worksheet.addRow({
        date: 'TOTAL',
        orderId: '',
        customer: '',
        grossSales: totalGrossSales,
        discounts: totalDiscount,
        netSales: totalNetSales,
        status: '',
        paymentMethod: ''
      });

      summaryRow.font = { bold: true };
      summaryRow.getCell('grossSales').numFmt = '₹#,##0.00';
      summaryRow.getCell('discounts').numFmt = '₹#,##0.00';
      summaryRow.getCell('netSales').numFmt = '₹#,##0.00';

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=sales-report.xlsx');

      await workbook.xlsx.write(res);
      res.end();

    } else if (format === 'pdf') {
      const doc = new PDFDocument({
        size: [900, 1200],
        margin: 30
      });
      
      doc.registerFont('Aboreto', 'public/fonts/Aboreto-Regular.ttf');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=sales-report.pdf');

      doc.pipe(res);

      doc.rect(0, 0, doc.page.width, 100).fill('#2d2d2d');
      
      doc.font('Aboreto').fontSize(28).fillColor('#c5a267').text('LEMO', { align: 'left', x: 40, y: 40 });
      
      
      doc.fontSize(24)
         .fillColor('#ffffff')
         .text('Sales Report', { align: 'center', y: 40 });

      doc.fontSize(12)
         .fillColor('#dac6a4')
         .text(`Period: ${period.charAt(0).toUpperCase() + period.slice(1)}`, { align: 'center', y: 70 });
      
      doc.moveDown(2);

      const tableTop = 150;
      const tableLeft = 30;
      const columnWidth = 120; 
      const rowHeight = 35; 

      doc.rect(tableLeft, tableTop - 20, 900 - 60, rowHeight)
         .fill('#dac6a4');

      const headers = ['Date', 'Order ID', 'Customer', 'Gross Sales', 'Discounts', 'Net Sales', 'Status'];
      headers.forEach((header, i) => {
        doc.fillColor('#1a1a1a')
           .fontSize(12)
           .text(header, tableLeft + (i * columnWidth), tableTop);
      });

      let y = tableTop + rowHeight;
      reportData.forEach((row, index) => {
        if (y > 1100) {
          doc.addPage();
          y = 50;
        }
        const rowColor = index % 2 === 0 ? '#2d2d2d' : '#353535';
        doc.rect(tableLeft, y - 20, 900 - 60, rowHeight)
           .fill(rowColor);
        
        doc.fillColor('#ffffff')
           .fontSize(10)
           .text(row.date, tableLeft, y)
           .text(row.orderId, tableLeft + columnWidth, y)
           .text(row.customer, tableLeft + (columnWidth * 2), y)
           .text(`Rs.${row.grossSales.toFixed(2)}`, tableLeft + (columnWidth * 3), y)
           .text(`Rs.${row.discounts.toFixed(2)}`, tableLeft + (columnWidth * 4), y)
           .text(`Rs.${row.netSales.toFixed(2)}`, tableLeft + (columnWidth * 5), y);

        let statusColor = '#ffffff'; 
        switch (row.status) {
          case 'Delivered':
            statusColor = '#2ecc71'; 
            break;
          case 'Cancelled':
          case 'Failed':
            statusColor = '#e74c3c'; 
            break;
          case 'Shipped':
            statusColor = '#3498db';
            break;
          case 'Pending':
          case 'Return Requested':
            statusColor = '#f39c12'; 
            break;
        }
        doc.fillColor(statusColor).text(row.status, tableLeft + (columnWidth * 6), y);

        y += rowHeight;
      });

      doc.moveDown(2);
      doc.rect(tableLeft, y, 900 - 60, 140)
         .fill('#1a1a1a');

      doc.fillColor('#dac6a4')
         .fontSize(16)
         .text('Summary', tableLeft + 20, y + 20);

      const totalGrossSales = reportData.reduce((sum, row) => sum + row.grossSales, 0);
      const totalDiscount = reportData.reduce((sum, row) => sum + row.discounts, 0);
      const totalNetSales = reportData.reduce((sum, row) => sum + row.netSales, 0);

      doc.fillColor('#ffffff')
         .fontSize(12)
         .text(`Total Gross Sales: Rs.${totalGrossSales.toFixed(2)}`, tableLeft + 20, y + 50)
         .text(`Total Discounts: Rs.${totalDiscount.toFixed(2)}`, tableLeft + 20, y + 75)
         .text(`Total Net Sales: Rs.${totalNetSales.toFixed(2)}`, tableLeft + 20, y + 100);

      const footerText = `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`;
      doc.fontSize(10)
         .fillColor('#b3b3b3')
         .text(footerText, { align: 'center', y: doc.page.height - 50 });

      doc.end();
    } else {
      res.status(400).send('Invalid format specified');
    }
  } catch (error) {
    console.error('Error in downloadReport:', error);
    res.status(500).send('Error generating report');
  }
};

const loadDashboard = async (req, res) => {
  try {
    const { period = 'monthly', startDate, endDate } = req.query;
    let dateQuery = {};
    let previousPeriodQuery = {};
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDate = now.getDate();

    const createDateWithTime = (year, month, date, hours, minutes, seconds, ms) => {
      return new Date(year, month, date, hours, minutes, seconds, ms);
    };

    let start, end, prevStart, prevEnd;
    if (period === 'daily') {
      start = createDateWithTime(currentYear, currentMonth, currentDate, 0, 0, 0, 0);
      end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      prevStart = new Date(start); prevStart.setDate(start.getDate() - 1);
      prevEnd = new Date(end); prevEnd.setDate(end.getDate() - 1);
    } else if (period === 'weekly') {
      start = createDateWithTime(currentYear, currentMonth, currentDate - 6, 0, 0, 0, 0);
      end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      prevStart = new Date(start); prevStart.setDate(start.getDate() - 7);
      prevEnd = new Date(end); prevEnd.setDate(end.getDate() - 7);
    } else if (period === 'monthly') {
      start = createDateWithTime(currentYear, currentMonth, 1, 0, 0, 0, 0);
      end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      prevStart = new Date(start); prevStart.setMonth(start.getMonth() - 1);
      prevEnd = new Date(end); prevEnd.setMonth(end.getMonth() - 1);
    } else if (period === 'yearly') {
      start = createDateWithTime(currentYear, 0, 1, 0, 0, 0, 0);
      end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      prevStart = new Date(start); prevStart.setFullYear(start.getFullYear() - 1);
      prevEnd = new Date(end); prevEnd.setFullYear(end.getFullYear() - 1);
    } else if (period === 'custom' && startDate && endDate) {
      start = new Date(startDate); start.setHours(0, 0, 0, 0);
      end = new Date(endDate); end.setHours(23, 59, 59, 999);
      const duration = end - start;
      prevStart = new Date(start.getTime() - duration);
      prevEnd = new Date(start.getTime() - 1);
    } else {
      start = createDateWithTime(currentYear, currentMonth, 1, 0, 0, 0, 0);
      end = createDateWithTime(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
      prevStart = new Date(start); prevStart.setMonth(start.getMonth() - 1);
      prevEnd = new Date(end); prevEnd.setMonth(end.getMonth() - 1);
    }
    dateQuery = { createdOn: { $gte: start, $lte: end } };
    previousPeriodQuery = { createdOn: { $gte: prevStart, $lte: prevEnd } };

    const orders = await Order.find(dateQuery).populate('items.productId').lean();
    const prevOrders = await Order.find(previousPeriodQuery).lean();

    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const prevRevenue = prevOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const revenueChange = prevRevenue === 0 ? 100 : ((totalRevenue - prevRevenue) / prevRevenue) * 100;

    const totalOrders = orders.length;
    const prevTotalOrders = prevOrders.length;
    const ordersChange = prevTotalOrders === 0 ? 100 : ((totalOrders - prevTotalOrders) / prevTotalOrders) * 100;

    const newCustomers = await User.countDocuments({ isAdmin: false, createdOn: { $gte: start, $lte: end } });
    const prevNewCustomers = await User.countDocuments({ isAdmin: false, createdOn: { $gte: prevStart, $lte: prevEnd } });
    const customersChange = prevNewCustomers === 0 ? 100 : ((newCustomers - prevNewCustomers) / prevNewCustomers) * 100;

    const conversionRate = newCustomers === 0 ? 0 : (totalOrders / newCustomers) * 100;
    const prevConversionRate = prevNewCustomers === 0 ? 0 : (prevTotalOrders / prevNewCustomers) * 100;
    const conversionChange = prevConversionRate === 0 ? 100 : ((conversionRate - prevConversionRate) / prevConversionRate) * 100;

    const chartData = {};
    orders.forEach(order => {
      const date = new Date(order.createdOn).toLocaleDateString();
      if (!chartData[date]) chartData[date] = 0;
      chartData[date] += order.totalAmount || 0;
    });

    const productSales = {};
    orders.forEach(order => {
      order.items.forEach(item => {
        const productId = item.productId?._id?.toString();
        if (productId) {
          if (!productSales[productId]) {
            productSales[productId] = { name: item.productId.productName, count: 0, revenue: 0 };
          }
          productSales[productId].count += item.quantity;
          productSales[productId].revenue += item.finalPrice 
  ? item.finalPrice 
  : (item.price || 0) * item.quantity;

        }
      });
    });
   const bestSellingProducts = Object.keys(productSales)
  .sort((a, b) => productSales[b].count - productSales[a].count) 
  .slice(0, 10) 
  .map(id => ({
    productId: id,
    name: productSales[id].name,
    count: productSales[id].count,
    revenue: productSales[id].revenue
  }));


    const categorySales = {};
    orders.forEach(order => {
      order.items.forEach(item => {
        const category = item.productId?.category;
        if (category) {
          const catId = category.toString();
          if (!categorySales[catId]) {
            categorySales[catId] = { name: '', count: 0, revenue: 0 };
          }
          categorySales[catId].count += item.quantity;
          categorySales[catId].revenue += (item.price || 0) * item.quantity;
        }
      });
    });
    const categoryIds = Object.keys(categorySales);
    const categories = await Category.find({ _id: { $in: categoryIds } });
    categories.forEach(cat => {
      if (categorySales[cat._id.toString()]) {
        categorySales[cat._id.toString()].name = cat.name;
      }
    });
   const bestSellingCategories = Object.keys(categorySales)
  .sort((a, b) => categorySales[b].count - categorySales[a].count) 
  .slice(0, 4) 
  .map(id => ({
    categoryId: id,
    name: categorySales[id].name,
    count: categorySales[id].count,
    revenue: categorySales[id].revenue
  }));


    res.render('admin/dashboard', {
      chartData,
      bestSellingProducts,
      bestSellingCategories,
      period,
      startDate,
      endDate,
      totalRevenue,
      revenueChange,
      totalOrders,
      ordersChange,
      newCustomers,
      customersChange,
      conversionRate,
      conversionChange
    });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    res.status(500).render('error', { message: 'Error loading dashboard' });
  }
};

module.exports = {
  loadLogin,
  login,
  
  loadSalesreport,
  pageError,
  logout,
  downloadReport,
  loadDashboard
};
