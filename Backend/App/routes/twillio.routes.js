const express=require('express')
const app=express.Router();
const twillocontroller=require("../controllers/twilio.controller")

app.post("/incoming-call",twillocontroller.handleIncomingCall)
app.post("/call-status",twillocontroller.handlecallstatus)
module.exports = app;

