const Banner=require('../../models/bannerSchema');
const fs = require('fs');
const path = require('path');


const getBanner=async (req,res) => {
    try {
      const page=parseInt(req.query.page)||1;
      const limit=4;
      const skip=(page-1)*limit;
     

      const totalBanners=await Banner.countDocuments();
      const totalPages=Math.ceil(totalBanners/limit);
       const banners=await Banner.find()
       .sort({createdAt:-1})
       .skip(skip)
       .limit(limit)

    res.render('admin/banner',{
        banners,
        totalBanners,
        totalPages,
        page,

    })

    } catch (error) {
        console.error('Error fetching Banners:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching banner'
    }); 
    }
}
const loadAddbanner=async (req,res) => {
    try {
        if(!req.session.admin){
            return res.render('admin/login');
        }
        res.render('admin/add-banner');
    } catch (error) {
        res.status(500).render('admin/pageError', { message: error.message || 'Error loading add banner page' });
    }
}

const addBanner = async (req, res) => {
    try {
        const { name, subtitle } = req.body;
        if (!name || !subtitle || !req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'All fields and at least one image are required'
            });
        }
        if (req.files.length > 5) {
            req.files.forEach(file => fs.unlinkSync(file.path));
            return res.status(400).json({
                success: false,
                message: 'You can upload a maximum of 5 images'
            });
        }
        const existingBanner = await Banner.findOne({ name });
        if (existingBanner) {
            req.files.forEach(file => fs.unlinkSync(file.path));
            return res.status(400).json({
                success: false,
                message: 'A Banner with this name already exists'
            });
        }
        const imageFilenames = req.files.map(file => file.filename);
        const newBanner = new Banner({
            name,
            subtitle,
            images: imageFilenames
        });
        await newBanner.save();
        res.status(201).json({
            success: true,
            message: 'Banner added successfully',
            banner: newBanner
        });
    } catch (error) {
        console.error('Error adding banner:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error adding banner'
        });
    }
};

const getEditBanner = async (req, res) => {
    try {
        const bannerId = req.params.id;
        const banner = await Banner.findById(bannerId);
        if (!banner) {
            return res.status(404).render('admin/pageError', { message: 'Banner not found' });
        }
        res.render('admin/edit-banner', { banner });
    } catch (error) {
        console.error('Error loading edit banner:', error);
        res.status(500).render('admin/pageError', { message: error.message || 'Error loading banner for edit' });
    }
};

const postEditBanner = async (req, res) => {
    try {
        const bannerId = req.params.id;
        const { name, subtitle } = req.body;
        const banner = await Banner.findById(bannerId);
        if (!banner) {
            return res.status(404).json({
                success: false,
                message: 'Banner not found'
            });
        }
        if (req.files && req.files.length > 0) {
            if (banner.images && banner.images.length > 0) {
                banner.images.forEach(img => {
                    const oldImagePath = path.join(__dirname, '../../public/uploads/banner/', img);
                    if (fs.existsSync(oldImagePath)) {
                        fs.unlinkSync(oldImagePath);
                    }
                });
            }
            if (req.files.length > 5) {
                req.files.forEach(file => fs.unlinkSync(file.path));
                return res.status(400).json({
                    success: false,
                    message: 'You can upload a maximum of 5 images'
                });
            }
            banner.images = req.files.map(file => file.filename);
        }
        banner.name = name;
        banner.subtitle = subtitle;
        await banner.save();
        res.status(200).json({
            success: true,
            message: 'Banner updated successfully',
            banner
        });
    } catch (error) {
        console.error('Error editing banner:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error editing banner'
        });
    }
};


module.exports={
    getBanner,
    loadAddbanner,
    addBanner,
    getEditBanner,
    postEditBanner,

}