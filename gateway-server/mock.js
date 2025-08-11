require("dotenv").config();
const axios = require("axios");
function rnd(a,b){ return Math.random()*(b-a)+a; }
async function tick(){
  const p = {
    deviceId:"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    deviceTs: Math.floor(Date.now()/1000),
    tempCx10: Math.round(rnd(18,35)*10),
    humPctx10: Math.round(rnd(30,95)*10),
    lux: Math.round(rnd(50,80000)),
    rain: Math.random()<0.2,
    sensorMask: 7
  };
  try{
    const r = await axios.post("http://localhost:3001/reading", p);
    console.log("OK", r.data);
  }catch(e){
    console.error(e.response?.data || e.message);
  }
}
setInterval(tick, 5000);
