const User = require("../models/userSchema"); 

const isLogin = async (req, res, next) => {
  try {
    if (req.session.user) {
      // Check if user is blocked
      const user = await User.findById(req.session.user.id);
      if (user && user.isBlocked) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(403).json({ 
            success: false,
            message: 'Your account has been blocked'
          });
        }
        return res.redirect("/login");
      }
      next();
    } else {
      // Check if the request is an API request
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ 
          success: false,
          message: 'Please login to continue',
          requiresLogin: true
        });
      }
      // For regular page requests, redirect to login
      res.redirect("/login");
    }
  } catch (error) {
    console.error('Error in isLogin middleware:', error);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ 
        success: false,
        message: 'Internal server error'
      });
    }
    res.status(500).send("Internal server error in isLogin");
  }
};

const userAuth = async (req, res, next) => {
  try {
    if (req.session.user) {
      const user = await User.findById(req.session.user.id);
      if (user && !user.isBlocked) {
        next();
      } else {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(403).json({ 
            success: false,
            message: 'Your account has been blocked'
          });
        }
        res.redirect("/login");
      }
    } else {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ 
          success: false,
          message: 'Please login to continue',
          requiresLogin: true
        });
      }
      res.redirect("/login");
    }
  } catch (error) {
    console.error('Error in userAuth:', error);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ 
        success: false,
        message: 'Internal server error'
      });
    }
    res.status(500).send("Internal server error in userAuth");
  }
};

const adminAuth = async (req, res, next) => {
  try {
    if (!req.session.admin) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ 
          success: false,
          message: 'Please login as admin to continue'
        });
      }
      return res.redirect("/admin/login");
    }

    const admin = await User.findOne({ isAdmin: true });
    if (admin) {
      next();
    } else {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ 
          success: false,
          message: 'Admin access required'
        });
      }
      res.redirect("/admin/login");
    }
  } catch (error) {
    console.error('Error in adminAuth:', error);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ 
        success: false,
        message: 'Internal server error'
      });
    }
    res.status(500).send("Error in adminAuth");
  }
};

module.exports = {
  userAuth,
  adminAuth,
  isLogin
};