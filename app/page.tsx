"use client";
import {useMemo,useState} from "react";

type Booth={id:number;name:string;address:string;window:string,status:"live"|"scheduled"|"closed";lead:string;boxes:number;revenue:number;low:number};
const booths:Booth[]=[
 {id:1,name:"Bristol Food City",address:"1201 Virginia Ave · Bristol, VA",window:"Today · 10:00 AM–2:00 PM",status:"live",lead:"Morgan Lee",boxes:148,revenue:888,low:2},
 {id:2,name:"State Street Market",address:"620 State St · Bristol, TN",window:"Today · 12:00–4:00 PM",status:"live",lead:"Jamie Reed",boxes:96,revenue:576,low:1},
 {id:3,name:"Highlands Shopping Center",address:"Exit 7 · Bristol, VA",window:"Tomorrow · 9:00 AM–1:00 PM",status:"scheduled",lead:"Taylor Kim",boxes:0,revenue:0,low:0},
 {id:4,name:"Community Center",address:"Anderson St · Bristol, TN",window:"Jul 22 · Closed",status:"closed",lead:"Chris Gammon",boxes:211,revenue:1266,low:0},
];
const flavors=[["Thin Mints",16,42],["Samoas",8,38],["Tagalongs",19,36],["Trefoils",27,30],["Do-Si-Dos",22,30],["Adventurefuls",13,24],["Lemon-Ups",20,24],["Toffee-tastic",5,12],["ExploreMores",18,24]];

export default function Home(){
 const [selected,setSelected]=useState<Booth|null>(null);const [role,setRole]=useState("Organization admin");
 const totals=useMemo(()=>({active:booths.filter(b=>b.status==="live").length,boxes:booths.reduce((a,b)=>a+b.boxes,0),revenue:booths.reduce((a,b)=>a+b.revenue,0)}),[]);
 if(selected)return <main><header><button className="back" onClick={()=>setSelected(null)}>← All booths</button><div className="brand">COOKIE BOOTH <b>COMMAND CENTER</b></div><div className="avatar">CG</div></header>
  <section className="boothHero"><div><p className="eyebrow">LIVE BOOTH · {selected.window}</p><h1>{selected.name}</h1><p>{selected.address} · Lead: {selected.lead}</p></div><div className="live">● Live and syncing</div></section>
  <section className="scan"><label>SCAN COOKIE BARCODE</label><div><input autoFocus placeholder="Scanner ready…" /><button>Record sale</button></div><small>Transactions receive a unique ID and are written to an append-only audit ledger.</small></section>
  <section className="stats"><article><span>Boxes sold</span><strong>{selected.boxes}</strong></article><article><span>Gross sales</span><strong>${selected.revenue.toLocaleString()}</strong></article><article><span>Low inventory</span><strong>{selected.low}</strong></article><article><span>Connected devices</span><strong>3</strong></article></section>
  <div className="sectionHead"><div><p className="eyebrow">BOOTH INVENTORY</p><h2>Live counts</h2></div><button>Close & reconcile booth</button></div>
  <section className="inventory">{flavors.map(([name,left,start],i)=><article className={Number(left)<=8?"warning":""} key={String(name)}><i className={`chip c${i%5}`}>{String(name).slice(0,2).toUpperCase()}</i><div><h3>{name}</h3><small>{start} opening · {Number(start)-Number(left)} sold</small></div><strong>{left}<small> left</small></strong></article>)}</section>
 </main>;
 return <main><header><div className="brand">COOKIE BOOTH <b>COMMAND CENTER</b></div><nav><button>Reports</button><button>People & roles</button><div className="avatar">CG</div></nav></header>
  <section className="welcome"><div><p className="eyebrow">TROOP OPERATIONS · ADULT VOLUNTEERS ONLY</p><h1>Good morning, Chris.</h1><p>Two booths are live. Inventory is healthy, with three low-stock alerts requiring attention.</p></div><button className="primary">＋ Create booth</button></section>
  <section className="stats"><article><span>Live booths</span><strong>{totals.active}</strong><small>of 4 scheduled</small></article><article><span>Boxes sold</span><strong>{totals.boxes}</strong><small>across all locations</small></article><article><span>Gross sales</span><strong>${totals.revenue.toLocaleString()}</strong><small>before reconciliation</small></article><article><span>Inventory alerts</span><strong>3</strong><small>across 2 booths</small></article></section>
  <div className="toolbar"><div><p className="eyebrow">BOOTH DIRECTORY</p><h2>Select a booth to operate</h2></div><select value={role} onChange={e=>setRole(e.target.value)} aria-label="Role preview"><option>Organization admin</option><option>Booth lead</option><option>Volunteer</option><option>Auditor</option></select></div>
  <section className="booths">{booths.map(b=><button className="booth" key={b.id} onClick={()=>setSelected(b)}><div><span className={`pill ${b.status}`}>{b.status}</span><h3>{b.name}</h3><p>{b.address}</p><small>{b.window}</small></div><dl><div><dt>Lead</dt><dd>{b.lead}</dd></div><div><dt>Boxes</dt><dd>{b.boxes}</dd></div><div><dt>Sales</dt><dd>${b.revenue.toLocaleString()}</dd></div></dl><footer>{b.status==="live"?"Open command center":b.status==="scheduled"?"Review setup":"View reconciliation"} <b>→</b></footer></button>)}</section>
  <aside><b>Privacy boundary</b><span>This system tracks adult operators, booth inventory, and transactions. Scout identities and individual sale-credit allocation are intentionally out of scope.</span></aside>
 </main>
}
