const Wishlist = require('../../models/wishlistSchema');
const User = require('../../models/userSchema');
const Product = require('../../models/productSchema');

const addToWishlist = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { productId } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: "Please Login" });
    }
    if (!productId) {
      return res.status(400).json({ success: false, message: 'Something went Wrong' });
    }

    let wishlist = await Wishlist.findOne({ userId });

    let isAdded = false;
    
    if (!wishlist) {
      wishlist = new Wishlist({
        userId,
        items: [{ productId }]
      });
      isAdded = true;
    } else {
      const index = wishlist.items.findIndex(
        item => item.productId && item.productId.toString() === productId.toString()
      );

      if (index > -1) {
        wishlist.items.splice(index, 1);
        isAdded = false;
      } else {
        wishlist.items.push({ productId });
        isAdded = true;
      }
    }

    await wishlist.save();
    
    // Get the updated wishlist count
    const updatedWishlist = await Wishlist.findOne({ userId });
    const wishlistCount = updatedWishlist ? updatedWishlist.items.length : 0;
    
    res.status(200).json({ 
      success: true, 
      message: isAdded ? 'Added to wishlist' : 'Removed from wishlist',
      wishlistCount
    });

  } catch (err) {
    console.error('Wishlist error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getWishlist = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Find the wishlist and populate the product data
    const wishlist = await Wishlist.findOne({ userId })
      .populate({
        path: 'items.productId',
        model: 'Product',
        select: 'productName productImage regularPrice salePrice isListed quantity',
        match: { isListed: true } // Only include listed products
      });

    if (!wishlist) {
      return res.render('user/wishlist', {
        wishlist: { items: [] },
        user: req.session.user
      });
    }

    // Filter out any items where the product is missing or unlisted
    const validItems = wishlist.items.filter(item => {
      return item.productId && 
             item.productId.isListed !== false &&
             item.productId.productImage && 
             item.productId.productImage.length > 0;
    });

    // Create a new wishlist object with only valid items
    const populatedWishlist = {
      ...wishlist.toObject(),
      items: validItems.map(item => ({
        ...item.toObject(),
        productId: item.productId // Already populated by Mongoose
      }))
    };

    // Update the wishlist in the database to remove any invalid items
    if (validItems.length !== wishlist.items.length) {
      wishlist.items = validItems;
      await wishlist.save();
    }

    res.render('user/wishlist', {
      wishlist: populatedWishlist,
      user: req.session.user
    });
  } catch (err) {
    console.error('Wishlist error:', err);
    res.status(500).render('error', { message: 'Failed to load wishlist' });
  }
};

const removeFromWishlist = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { productId } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Please login" });
    }
    if (!productId) {
      return res.status(400).json({ success: false, message: 'Product ID is required' });
    }

    const wishlist = await Wishlist.findOne({ userId });

    if (!wishlist) {
      return res.status(404).json({ success: false, message: 'Wishlist not found' });
    }

    // Remove the item from the wishlist
    wishlist.items = wishlist.items.filter(
      item => item.productId.toString() !== productId.toString()
    );

    await wishlist.save();
    
    // Get the updated wishlist with product details
    const updatedWishlist = await Wishlist.findOne({ userId })
      .populate('items.productId')
      .lean();

    res.status(200).json({ 
      success: true, 
      message: 'Item removed from wishlist',
      wishlist: updatedWishlist
    });

  } catch (err) {
    console.error('Remove from wishlist error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  addToWishlist,
  getWishlist,
  removeFromWishlist
};
