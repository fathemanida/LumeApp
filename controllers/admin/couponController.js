const Coupon = require('../../models/couponSchema');

const listCoupons = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 6;
    const search = req.query.search || '';

    const searchQuery = {
      $or: [
        { code: { $regex: new RegExp(search, 'i') } },
        { description: { $regex: new RegExp(search, 'i') } }
      ]
    };

    const totalItems = await Coupon.countDocuments(searchQuery);
    const totalPages = Math.ceil(totalItems / limit);

    const coupons = await Coupon.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.render('admin/coupons', {
      coupons,
      currentPage: page,
      totalPages,
      totalItems,
      limit,
      search
    });
  } catch (error) {
    console.error('Error listing coupons:', error);
    res.status(500).send('Internal Server Error');
  }
};

const showAddForm = (req, res) => {
  res.render('admin/add-coupon', { coupon: null });
};

const createCoupon = async (req, res) => {
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      expiryDate,
      fromDate,
      minOrderAmount,
      maxDiscount,
      isActive
    } = req.body;

    if (!code || !discountType || !discountValue || !expiryDate || !fromDate || !minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }
    if(discountValue>=65){
      return res.status(400).json({
        success:false,
        message:"maximium 65% can give"
      })
    }
    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }
    const couponCode = code.toUpperCase();
if (couponCode.length < 5 || couponCode.length > 8) {
  return res.status(400).json({
    success: false,
    message: 'Coupon code must be between 5 and 8 characters'
  });
}
    const coupon = new Coupon({
      code: code.toUpperCase(),
      description,
      discountType,
      discountValue: Number(discountValue),
      expiryDate: new Date(expiryDate),
      createdAt: new Date(fromDate),
      minOrderAmount: Number(minOrderAmount),
      maxDiscount: discountType === 'PERCENTAGE' ? Number(maxDiscount) : undefined,
      isActive: isActive === 'true' || isActive === true
    });

    await coupon.save();

    res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      coupon
    });
  } catch (error) {
    console.error('Error creating coupon:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating coupon',
      error: error.message
    });
  }
};

const showEditForm = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return res.redirect('/admin/coupons');
    }
    res.render('admin/edit-coupons', { coupon });
  } catch (error) {
    console.error('Error fetching coupon:', error);
    res.status(500).send('Internal Server Error');
  }
};

const updateCoupon = async (req, res) => {
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      expiryDate,
      fromDate,
      minOrderAmount,
      maxDiscount,
      isActive
    } = req.body;

    if (!code || !discountType || !discountValue || !expiryDate || !fromDate || !minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    const existing = await Coupon.findOne({ 
      code: code.toUpperCase(), 
      _id: { $ne: req.params.id } 
    });
    
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }

    const updateData = {
      code: code.toUpperCase(),
      description,
      discountType,
      discountValue: Number(discountValue),
      expiryDate: new Date(expiryDate),
      createdAt: new Date(fromDate),
      minOrderAmount: Number(minOrderAmount),
      isActive: isActive === 'on' || isActive === true || isActive === 'true'
    };

    if (discountType === 'PERCENTAGE') {
      if (!maxDiscount) {
        return res.status(400).json({
          success: false,
          message: 'Maximum discount is required for percentage discount'
        });
      }
      updateData.maxDiscount = Number(maxDiscount);
    } else {
      updateData.maxDiscount = undefined;
    }

    const updatedCoupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedCoupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Coupon updated successfully',
      coupon: updatedCoupon
    });
  } catch (error) {
    console.error('Error updating coupon:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating coupon',
      error: error.message
    });
  }
};

const deleteCoupon = async (req, res) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({ message: 'Error deleting coupon' });
  }
};

const toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    coupon.isActive = isActive;
    await coupon.save();

    res.json({ 
      message: `Coupon ${isActive ? 'activated' : 'deactivated'} successfully`,
      coupon 
    });
  } catch (error) {
    console.error('Error toggling coupon status:', error);
    res.status(500).json({ 
      message: 'Error updating coupon status',
      error: error.message 
    });
  }
};

module.exports = {
  listCoupons,
  showAddForm,
  createCoupon,
  showEditForm,
  updateCoupon,
  deleteCoupon,
  toggleStatus
};