const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Offer = require('../../models/offerSchema');

const getAllOffers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    // Get total count of offers
    const totalOffers = await Offer.countDocuments();
    const totalPages = Math.ceil(totalOffers / limit);

    // Fetch offers with pagination
    const offers = await Offer.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('categories', 'name')
      .populate('products', 'productName');

    res.render('admin/offers', {
      offers,
      currentPage: page,
      totalPages,
      totalOffers
    });
  } catch (error) {
    console.error('Error fetching offers:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching offers'
    });
  }
};

const getAddOffer = async (req, res) => {
  try {
    // Get all categories and products for selection
    const categories = await Category.find({ isListed: true });
    const products = await Product.find({ isListed: true }).populate('category');

    res.render('admin/add-offer', {
      categories,
      products,
      title: 'Add New Offer'
    });
  } catch (error) {
    console.error('Error loading add offer page:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading add offer page',
      error: error.message
    });
  }
};

const createOffer = async (req, res) => {
  try {
    const {
      name,
      code,
      discountType,
      discountValue,
      startDate,
      endDate,
      applicableOn,
      categories,
      products
    } = req.body;

    // Validate required fields
    if (!name || !code || !discountType || !discountValue || !startDate || !endDate || !applicableOn) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    // Check if offer code already exists
    const existingOffer = await Offer.findOne({ code: code.toUpperCase() });
    if (existingOffer) {
      return res.status(400).json({
        success: false,
        message: 'Offer code already exists'
      });
    }

    // Create new offer
    const newOffer = new Offer({
      name,
      code: code.toUpperCase(),
      discountType,
      discountValue,
      startDate,
      endDate,
      applicableOn,
      categories: applicableOn === 'categories' ? categories : [],
      products: applicableOn === 'products' ? products : [],
      isActive: true
    });

    // Save the offer
    await newOffer.save();

    // If applicable on categories, update category offers
    if (applicableOn === 'categories' && categories.length > 0) {
      await Category.updateMany(
        { _id: { $in: categories } },
        { 
          $set: { 
            categoryOffer: {
              active: true,
              discountType,
              discountValue,
              startDate,
              endDate
            }
          }
        }
      );
    }

    // If applicable on products, update product offers
    if (applicableOn === 'products' && products.length > 0) {
      await Product.updateMany(
        { _id: { $in: products } },
        { 
          $set: { 
            offer: {
              active: true,
              discountType,
              discountValue,
              startDate,
              endDate
            }
          }
        }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Offer created successfully',
      offer: newOffer
    });
  } catch (error) {
    console.error('Error creating offer:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating offer'
    });
  }
};

const getEditOffer = async (req, res) => {
    try {
        const offerId = req.params.id;
        const offer = await Offer.findById(offerId);

        if (!offer) {
            return res.status(404).json({
                success: false,
                message: 'Offer not found'
            });
        }

        res.render('admin/edit-offer', { offer });
    } catch (error) {
        console.error('Error fetching offer:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error fetching offer'
        });
    }
};

const updateOffer = async (req, res) => {
    try {
        const offerId = req.params.id;
        const {
            name,
            code,
            discountType,
            discountValue,
            startDate,
            endDate,
            applicableOn,
            categories,
            products
        } = req.body;

        // Validate required fields
        if (!name || !code || !discountType || !discountValue || !startDate || !endDate || !applicableOn) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be provided'
            });
        }

        // Check if offer code already exists (excluding current offer)
        const existingOffer = await Offer.findOne({ 
            code: code.toUpperCase(),
            _id: { $ne: offerId }
        });
        
        if (existingOffer) {
            return res.status(400).json({
                success: false,
                message: 'Offer code already exists'
            });
        }

        // Find the current offer
        const currentOffer = await Offer.findById(offerId);
        if (!currentOffer) {
            return res.status(404).json({
                success: false,
                message: 'Offer not found'
            });
        }

        // Update the offer
        const updatedOffer = await Offer.findByIdAndUpdate(
            offerId,
            {
                name,
                code: code.toUpperCase(),
                discountType,
                discountValue,
                startDate,
                endDate,
                applicableOn,
                categories: applicableOn === 'categories' ? categories : [],
                products: applicableOn === 'products' ? products : []
            },
            { new: true }
        );

        // Remove offer from previously selected categories
        if (currentOffer.applicableOn === 'categories' && currentOffer.categories.length > 0) {
            await Category.updateMany(
                { _id: { $in: currentOffer.categories } },
                { $unset: { categoryOffer: 1 } }
            );
        }

        // Remove offer from previously selected products
        if (currentOffer.applicableOn === 'products' && currentOffer.products.length > 0) {
            await Product.updateMany(
                { _id: { $in: currentOffer.products } },
                { $unset: { offer: 1 } }
            );
        }

        // Update new categories if applicable
        if (applicableOn === 'categories' && categories.length > 0) {
            await Category.updateMany(
                { _id: { $in: categories } },
                { 
                    $set: { 
                        categoryOffer: {
                            active: true,
                            discountType,
                            discountValue,
                            startDate,
                            endDate
                        }
                    }
                }
            );
        }

        // Update new products if applicable
        if (applicableOn === 'products' && products.length > 0) {
            await Product.updateMany(
                { _id: { $in: products } },
                { 
                    $set: { 
                        offer: {
                            active: true,
                            discountType,
                            discountValue,
                            startDate,
                            endDate
                        }
                    }
                }
            );
        }

        res.status(200).json({
            success: true,
            message: 'Offer updated successfully',
            offer: updatedOffer
        });

    } catch (error) {
        console.error('Error updating offer:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error updating offer'
        });
    }
};

module.exports = {
  getAllOffers,
  getAddOffer,
  createOffer,
  getEditOffer,
  updateOffer
}; 