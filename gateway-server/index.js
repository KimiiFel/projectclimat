// gateway-server/index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// ---- config env ----
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const PRIVKEY = process.env.PRIVATE_KEY;               // clé d'un compte Hardhat
const CONTRACT_ADDR = process.env.CONTRACT_ADDR;       // adresse du contrat
const PORT = Number(process.env.PORT || 3001);

// ---- ethers (v6) ----
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVKEY, provider);
const abi = require("./abi/SensorRegistryV2.json").abi;
const contract = new ethers.Contract(CONTRACT_ADDR, abi, wallet);

// ---- petite "DB" persistance disque ----
const DB_PATH = path.join(__dirname, "db.json"); // fichier JSON
const store = new Map(); // dataHash (lowercase) -> record clair { ... , dataHash, tx }
const order = [];        // ordre d'arrivée (liste des hashes)
const MAX = 2000;        // ne garder que les N derniers

function loadDb() {
  if (!fs.existsSync(DB_PATH)) return;
  try {
    const arr = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    for (const rec of arr) {
      const h = String(rec.dataHash).toLowerCase();
      if (!store.has(h)) {
        store.set(h, rec);
        order.push(h);
      }
    }
    console.log("loaded", arr.length, "records from db.json");
  } catch (e) {
    console.warn("db load failed:", e.message);
  }
}
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const arr = order.map(h => store.get(h));
      fs.writeFileSync(DB_PATH, JSON.stringify(arr, null, 2));
    } catch (e) {
      console.warn("db save failed:", e.message);
    }
  }, 300);
}
function keep(record) {
  const h = String(record.dataHash).toLowerCase();
  if (!store.has(h)) {
    store.set(h, record);
    order.push(h);
    if (order.length > MAX) {
      const rm = order.shift();
      store.delete(rm);
    }
    scheduleSave();
  }
}
loadDb();

// ---- util: hash canonique du payload clair ----
function computeHash(p) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const enc = coder.encode(
    ["bytes16", "uint64", "int16", "uint16", "uint32", "bool", "uint8"],
    [
      p.deviceId,   // "0x" + 32 hex (bytes16)
      p.deviceTs,   // secondes epoch (uint64)
      p.tempCx10,   // 23.4°C -> 234  (int16)
      p.humPctx10,  // 65.1%  -> 651  (uint16)
      p.lux,        // (uint32)
      p.rain,       // (bool)
      p.sensorMask  // (uint8) bits: 1 DHT22, 2 BH1750, 4 Rain
    ]
  );
  return ethers.keccak256(enc);
}

// ---- server ----
const app = express();
app.use(cors());
app.use(express.json());

// sanity logs
wallet.getAddress().then(addr => {
  console.log("gateway wallet:", addr);
  console.log("contract addr :", CONTRACT_ADDR);
});

// health
app.get("/health", (_, res) => res.json({ ok: true }));

// lire 1 mesure claire par hash
app.get("/reading/:hash", (req, res) => {
  const h = String(req.params.hash || "").toLowerCase();
  const r = store.get(h);
  if (!r) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, reading: r });
});

// dernières mesures claires (nouveaux -> anciens)
app.get("/recent", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 1000);
  const arr = order.slice(-limit).reverse().map(h => store.get(h));
  res.json({ ok: true, items: arr });
});

// export CSV (nouveaux -> anciens)
app.get("/export.csv", (req, res) => {
  const limit = Math.min(Number(req.query.limit || 1000), 5000);
  const arr = order.slice(-limit).reverse().map(h => store.get(h));
  const header = [
    "dataHash","deviceId","deviceTs","blockTs","sensorMask",
    "tempCx10","humPctx10","lux","rain"
  ];
  const lines = [header.join(",")].concat(
    arr.map(r => [
      r.dataHash, r.deviceId, r.deviceTs, r.blockTs, r.sensorMask,
      r.tempCx10, r.humPctx10, r.lux, (r.rain===true?1:0)
    ].join(","))
  );
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.send(lines.join("\n"));
});

// enregistrer UNE mesure
app.post("/reading", async (req, res) => {
  try {
    const p = req.body;
    const h = computeHash(p);
    const tx = await contract.storeReading(p.deviceId, h, p.deviceTs, p.sensorMask);
    const rcp = await tx.wait();

    keep({ ...p, dataHash: h, blockTs: Math.floor(Date.now()/1000), tx: rcp.hash });
    res.json({ ok: true, tx: rcp.hash, dataHash: h });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// enregistrer un batch
app.post("/readings", async (req, res) => {
  try {
    const { deviceId, items } = req.body;
    const hs = [], ts = [], masks = [];
    for (const it of items) {
      const h = computeHash({ ...it, deviceId });
      hs.push(h);
      ts.push(it.deviceTs);
      masks.push(it.sensorMask);
      keep({ ...it, deviceId, dataHash: h, blockTs: Math.floor(Date.now()/1000), tx: null });
    }
    const tx = await contract.storeBatch(deviceId, hs, ts, masks);
    const rcp = await tx.wait();
    res.json({ ok: true, tx: rcp.hash, hashes: hs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log("gateway listening on", PORT));
