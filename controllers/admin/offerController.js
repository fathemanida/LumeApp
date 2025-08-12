const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Offer = require('../../models/offerSchema');

const getAllOffers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status;
    const type = req.query.type;
    const limit = 6;
    const skip = (page - 1) * limit;

    let query = {};
    
    if (status === 'active') {
      query.isActive = true;
      query.endDate = { $gte: new Date() };
    } else if (status === 'inactive') {
      query.$or = [
       
        { endDate: { $lt: new Date() } } 
      ];
    }

    if (type === 'category') {
      query.applicableOn = 'categories';
    } else if (type === 'product') {
      query.applicableOn = 'products';
    }

    const totalOffers = await Offer.countDocuments(query);
    const totalPages = Math.ceil(totalOffers / limit);

    const offers = await Offer.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('categories', 'name')
      .populate('products', 'productName');



      console.log('==totao,current',totalPages,page);
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
    
    if (!name || !code || !discountType || !discountValue || !startDate || !endDate || !applicableOn) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided'
      });
    }

    const existingOffer = await Offer.findOne({ code: { $regex: `^${code}$`, $options: 'i' } });

if (existingOffer) {
  return res.status(400).json({
    success: false,
    message: 'Offer code already exists',
  });
}


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

    await newOffer.save();

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

        if (!name || !code || !discountType || !discountValue || !startDate || !endDate || !applicableOn) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be provided'
            });
        }

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

        const currentOffer = await Offer.findById(offerId);
        if (!currentOffer) {
            return res.status(404).json({
                success: false,
                message: 'Offer not found'
            });
        }

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

        if (currentOffer.applicableOn === 'categories' && currentOffer.categories.length > 0) {
            await Category.updateMany(
                { _id: { $in: currentOffer.categories } },
                { $unset: { categoryOffer: 1 } }
            );
        }

      if (currentOffer.applicableOn === 'products' && currentOffer.products.length > 0) {
            await Product.updateMany(
                { _id: { $in: currentOffer.products } },
                { $unset: { offer: 1 } }
            );
        }

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

const deleteOffer = async (req, res) => {
    try {
        const offerId = req.params.id;
        console.log('offerid',offerId);
        
        const offer = await Offer.findById(offerId);
        if (!offer) {
            return res.status(404).json({
                success: false,
                message: 'Offer not found'
            });
        }

        if (offer.applicableOn === 'categories' && offer.categories.length > 0) {
            await Category.updateMany(
                { _id: { $in: offer.categories } },
                { $unset: { categoryOffer: 1 } }
            );
        }

        if (offer.applicableOn === 'products' && offer.products.length > 0) {
            await Product.updateMany(
                { _id: { $in: offer.products } },
                { $unset: { offer: 1 } }
            );
        }

        await Offer.findByIdAndDelete(offerId);
        console.log('offer deleted succesfully');

        res.status(200).json({
            success: true,
            message: 'Offer deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting offer:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error deleting offer'
        });
    }
};


  


module.exports = {
  getAllOffers,
  getAddOffer,
  createOffer,
  getEditOffer,
  updateOffer,
  deleteOffer
}; 