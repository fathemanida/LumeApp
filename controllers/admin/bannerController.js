const Banner=require('../../models/bannerSchema');



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
            res.render('admin/login')
        }
        res.render('admin/banner')
    } catch (error) {
        
    }
}

const addBanner=async (req,res) => {
    try {
       const {name,subtitle}=req.body;
       if(!name||!subtitle||!req.file){
        return res.status(404).json({
            success:false,
            message:'All fields are required'
        })
       }
       const existinBanner=await Banner.findOne({name})
       if(existinBanner){
        if(req.file){
            fs.unlinkSync(req.file.path)
        }
        return res.status(400).json({
            success:false,
        message:"A Banner with name already exists"
        })
       }

    } catch (error) {
        
    }
}


module.exports={
    getBanner,
    loadAddbanner,
    addBanner,

}