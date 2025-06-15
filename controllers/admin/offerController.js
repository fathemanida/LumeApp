const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');

const getAllOffers = async (req, res) => {
  try {
    const productOffers = await Product.find({
      'productOffer.active': true
    }).populate('category');

    const categoryOffers = await Category.find({
      'offer.active': true
    });

    res.render('admin/offers', {
      productOffers,
      categoryOffers,
      title: 'Offers Management'
    });
  } catch (error) {
    console.error('Error fetching offers:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching offers',
      error: error.message
    });
  }
};

module.exports = {
  getAllOffers
}; 