exports.handleIncomingCall = async (req, res) => {
  const callSid = req.body.CallSid;
  const phoneNumber = req.body.From;

  console.log("Incoming call:", callSid);

  res.type("text/xml");

  res.send(`
<Response>

  <Start>
    <Stream url="wss://f322-115-241-181-35.ngrok-free.app/audio-stream" />
  </Start>

  <Say>Hello, how can I help you today?</Say>

  <Pause length="60"/>

</Response>
`);
};

exports.handlecallstatus=async(req,res)=>{

}