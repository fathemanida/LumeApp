const express=require("express");
const app=express();
const path = require("path");
const env = require("dotenv").config();
const session = require("express-session");
const flash = require('express-flash');
const passport = require("./config/passport");
const db = require("./config/db");
const userRoutes = require("./routes/userRoutes");
const adminRouters = require("./routes/adminRoutes");
//const { adminNoCache, userNoCache } = require("./middleware/auth");
const nocache = require("nocache");
const { allowedNodeEnvironmentFlags } = require("process");

//const adminRoutes = require('./routes/admin'); 

//const userRoutes = require('./routes/user/userRoutes');


db();

app.set("view engine", "ejs");
app.set("views",[
    path.join(__dirname,"views"),
    path.join(__dirname,"views/user"),
    path.join(__dirname,"views/admin")
]);

app.use(express.static(path.join(__dirname,"public")));
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(nocache());

app.use(session({
    secret:process.env.SESSION_SECRET,
 
    resave:false,
    saveUninitialized:false,
    cookie:{
        maxAge: 1000 * 60 * 60 * 24, 
    }
}));

app.use(flash());


app.use(passport.initialize());
app.use(passport.session());

app.use('/', userRoutes);     
app.use('/admin', adminRouters); 


const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
