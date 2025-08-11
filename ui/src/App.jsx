import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import artifact from "./abi/SensorRegistryV2.json";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import "./app.css";

const ABI = artifact.abi;
const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
const CONTRACT = import.meta.env.VITE_CONTRACT_ADDR || "";
const GW = import.meta.env.VITE_GATEWAY_URL || "http://localhost:3001";

// -------- utils
const maskToText = (m) => {
  const bits = Number(m);
  const a = [];
  if (bits & 1) a.push("DHT22");
  if (bits & 2) a.push("BH1750");
  if (bits & 4) a.push("Rain");
  return a.join(" + ") || "—";
};

function toRow(it) {
  return {
    ...it,
    seq: Number(it.seq),
    deviceTs: Number(it.deviceTs),
    blockTs: Number(it.blockTs),
    sensorMask: Number(it.sensorMask),
    tempCx10: it.tempCx10 != null ? Number(it.tempCx10) : null,
    humPctx10: it.humPctx10 != null ? Number(it.humPctx10) : null,
    lux: it.lux != null ? Number(it.lux) : null,
    rain: typeof it.rain === "boolean" ? it.rain : null,
  };
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [device, setDevice] = useState("all");
  const [windowH, setWindowH] = useState(6);
  const seen = useRef(new Set());

  async function fetchRecent(limit = 500) {
    const r = await fetch(`${GW}/recent?limit=${limit}`);
    if (!r.ok) return [];
    const j = await r.json();
    return j.items || [];
  }
  async function fetchClear(hash) {
    try {
      const r = await fetch(`${GW}/reading/${hash}`);
      if (!r.ok) return null;
      return (await r.json()).reading;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (!CONTRACT) {
      console.error("VITE_CONTRACT_ADDR manquant dans .env");
      return;
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const c = new ethers.Contract(CONTRACT, ABI, provider);

    async function initialLoad() {
      const evs = await c.queryFilter("ReadingStored", 0, "latest");
      const base = evs.map(e => ({
        dataHash: e.args.dataHash,
        deviceId: e.args.deviceId,
        seq: Number(e.args.seq),
        deviceTs: Number(e.args.deviceTs),
        blockTs: Number(e.args.blockTs),
        sensorMask: Number(e.args.sensorMask),
        submitter: e.args.submitter,
      })).sort((a,b)=>b.blockTs-a.blockTs).slice(0, 600);

      const recent = await fetchRecent(800);
      const mapRecent = new Map(recent.map(r => [r.dataHash.toLowerCase(), r]));
      const joined = base.map(b => {
        const r = mapRecent.get(String(b.dataHash).toLowerCase());
        return toRow(r ? { ...b, ...r } : b);
      });

      seen.current = new Set(joined.map(i => i.dataHash));
      setRows(joined);
    }

    function onNew(dataHash, deviceId, seq, deviceTs, blockTs, sensorMask, submitter) {
      (async () => {
        if (seen.current.has(dataHash)) return;
        seen.current.add(dataHash);
        const clear = await fetchClear(dataHash);
        const it = toRow({ dataHash, deviceId, seq, deviceTs, blockTs, sensorMask, submitter, ...(clear || {}) });
        setRows(prev => [it, ...prev].slice(0, 1000));
      })();
    }

    initialLoad();
    c.on("ReadingStored", onNew);
    return () => c.off("ReadingStored", onNew);
  }, []);

  const devices = useMemo(() => {
    const set = new Set(rows.map(r => r.deviceId));
    return ["all", ...Array.from(set)];
  }, [rows]);

  const filtered = useMemo(() => {
    const now = Date.now() / 1000;
    const minTs = now - windowH * 3600;
    return rows
      .filter(r => (device === "all" || r.deviceId === device))
      .filter(r => r.deviceTs >= minTs)
      .sort((a,b)=> a.deviceTs - b.deviceTs);
  }, [rows, device, windowH]);

  const series = useMemo(() => filtered.map(r => ({
    t: new Date(r.deviceTs * 1000).toLocaleTimeString(),
    temp: r.tempCx10 != null ? r.tempCx10 / 10 : null,
    hum: r.humPctx10 != null ? r.humPctx10 / 10 : null,
    lux: r.lux,
    rain: r.rain === true ? 1 : 0
  })), [filtered]);

  const stats = useMemo(() => {
    if (filtered.length === 0) return null;
    const last = filtered[filtered.length - 1];
    const avg = (arr) => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
    const temps = filtered.map(r => r.tempCx10).filter(v => v!=null).map(v=>v/10);
    const hums  = filtered.map(r => r.humPctx10).filter(v => v!=null).map(v=>v/10);
    const luxs  = filtered.map(r => r.lux).filter(v => v!=null);
    const rains = filtered.map(r => r.rain===true?1:0);
    return {
      lastTemp: last.tempCx10!=null ? (last.tempCx10/10).toFixed(1) : "—",
      lastHum:  last.humPctx10!=null ? (last.humPctx10/10).toFixed(1) : "—",
      lastLux:  last.lux!=null ? last.lux : "—",
      rainRate: (avg(rains)*100).toFixed(0) + "%",
      avgTemp: temps.length ? avg(temps).toFixed(1) : "—",
      avgHum:  hums.length ? avg(hums).toFixed(1) : "—",
      maxLux:  luxs.length ? Math.max(...luxs) : "—",
    };
  }, [filtered]);

  return (
    <div className="wrap">
      <header>
        <h1>Votre Météo Locale - Fiable & Transparente</h1>
        <p className="muted">Contrat: {CONTRACT}</p>
      </header>

      <section className="controls">
        <label>
          Appareil :
          <select value={device} onChange={e=>setDevice(e.target.value)}>
            {devices.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>
          Fenêtre :
          <select value={windowH} onChange={e=>setWindowH(Number(e.target.value))}>
            {[1,3,6,12,24,48].map(h => <option key={h} value={h}>{h} h</option>)}
          </select>
        </label>
        <span className="muted">{filtered.length} points</span>

        {/* bouton CSV */}
        <a className="btn" href={`${GW}/export.csv?limit=2000`} target="_blank" rel="noreferrer">
          Télécharger CSV
        </a>
      </section>

      {stats && (
        <section className="cards">
          <div className="card"><div className="k">Temp (dernière)</div><div className="v">{stats.lastTemp} °C</div></div>
          <div className="card"><div className="k">Hum (dernière)</div><div className="v">{stats.lastHum} %</div></div>
          <div className="card"><div className="k">Lux (dernier)</div><div className="v">{stats.lastLux}</div></div>
          <div className="card"><div className="k">Pluie (ratio)</div><div className="v">{stats.rainRate}</div></div>
          <div className="card"><div className="k">Temp (moy.)</div><div className="v">{stats.avgTemp} °C</div></div>
          <div className="card"><div className="k">Hum (moy.)</div><div className="v">{stats.avgHum} %</div></div>
          <div className="card"><div className="k">Lux (max)</div><div className="v">{stats.maxLux}</div></div>
        </section>
      )}

      <section className="grid">
        <div className="panel">
          <h3>Température (°C)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" minTickGap={20}/>
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="temp" name="°C" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h3>Humidité (%)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" minTickGap={20}/>
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="hum" name="%" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h3>Lux</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" minTickGap={20}/>
              <YAxis />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="lux" name="lux" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h3>Pluie (1 = oui)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" minTickGap={20}/>
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="rain" name="rain" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <h2 style={{marginTop: 24}}>Dernières lectures</h2>
      <table className="tbl">
        <thead>
          <tr>
            <th>Seq</th><th>Device</th><th>Device time</th><th>Block time</th><th>Capteurs</th>
            <th>Temp (°C)</th><th>Hum (%)</th><th>Lux</th><th>Pluie</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0,150).map((r, i) => (
            <tr key={r.dataHash + i}>
              <td>{r.seq}</td>
              <td className="mono">{r.deviceId}</td>
              <td>{new Date(r.deviceTs * 1000).toLocaleString()}</td>
              <td>{new Date(r.blockTs * 1000).toLocaleString()}</td>
              <td>{maskToText(r.sensorMask)}</td>
              <td>{r.tempCx10!=null ? (r.tempCx10/10).toFixed(1) : "—"}</td>
              <td>{r.humPctx10!=null ? (r.humPctx10/10).toFixed(1) : "—"}</td>
              <td>{r.lux!=null ? r.lux : "—"}</td>
              <td>{r.rain===true ? "Oui" : r.rain===false ? "Non" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}



