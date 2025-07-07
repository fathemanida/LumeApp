const nodemailer = require('nodemailer');

const faq=async (req,res) => {
    try {
        res.render('faq')
    } catch (error) {
        console.log('error to render faq',error);
    }
}


const privacyPolicy=async (req,res) => {
    try {
        res.render('privacy-policy')
    } catch (error) {
        
    }
}

const shippingReturn=async (req,res) => {
    try {
        res.render('shipping-returns')
    } catch (error) {
        console.log('error in render shippin and return');
    }
}
const refundPolicy=async (req,res) => {
    try {
        res.render('refund-policy')
    } catch (error) {
        console.log('error in render Refund Plicy');
    }
}

const contact=async (req,res) => {
    try {
        res.render('contact')
    } catch (error) {
        console.log('error in render shippin and return');
    }
}

const contactPost = async (req, res) => {
  try {
    const { name, email, phone, comment } = req.body;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.ADMIN_EMAIL,
        pass: process.env.ADMIN_EMAIL_PASS
      }
    });

    const mailOptions = {
      from: email,
      to: process.env.ADMIN_EMAIL,
      subject: 'New Contact Form Submission',
      html: `
        <h3>New Contact Form Submission</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Comment:</strong><br>${comment}</p>
      `
    };

    await transporter.sendMail(mailOptions);
    res.render('contact', { success: true, name });
  } catch (error) {
    console.log('Error handling contact form:', error);
    res.render('contact', { error: 'Something went wrong. Please try again.' });
  }
};

module.exports={
    faq,
    privacyPolicy,
    shippingReturn,
    refundPolicy,
    contact,
    contactPost,
}