import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import JsBarcode from 'jsbarcode';
import { createWorker } from 'tesseract.js';
import Operations from './Operations';
import { Activity, ArrowDownRight, ArrowUpRight, Box, ChevronLeft, ChevronRight, CircleUserRound, ClipboardPlus, Clock3, Container, History, Layers3, LogOut, MapPin, MapPinned, PackageCheck, Pencil, Plus, Printer, RefreshCw, Search, ShieldCheck, Truck, Users, X } from 'lucide-react';
import './style.css';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api' });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('yard_admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
const roleLabels = { yard_operator: 'Yard operator', gate_operator: 'Gate operator', shipment_operator: 'Shipment operator', supervisor: 'Supervisor', viewer: 'Viewer', admin: 'Administrator' };
const errorText = (error) => error?.response?.data?.error || 'Could not connect to the yard server.';
const dateText = (value) => value ? new Date(value).toLocaleString() : '—';
function containerNumberFromText(text) {
  const compact=String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const fixes={O:'0',Q:'0',D:'0',I:'1',L:'1',Z:'2',S:'5',G:'6',B:'8'};
  for(let i=0;i<=compact.length-11;i++){
    const owner=compact.slice(i,i+4);if(!/^[A-Z]{4}$/.test(owner))continue;
    const serial=compact.slice(i+4,i+11).replace(/[A-Z]/g,ch=>fixes[ch]||ch);
    if(/^\d{7}$/.test(serial))return owner+serial;
  }
  return '';
}

function Login({ onLogin }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const { data } = await api.post('/auth/login', { email, password });
      if (!['admin', 'supervisor'].includes(data.user.role)) throw new Error('The admin panel is for supervisors and administrators.');
      localStorage.setItem('yard_admin_token', data.token); onLogin(data.user);
    } catch (err) { setError(err.message || errorText(err)); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark"><Container size={30}/></div><p className="eyebrow">CONTAINER YARD</p><h1>Operations panel</h1><p className="muted">Sign in to view yard records and activity.</p>
    {error && <div className="error-box">{error}</div>}
    <label>Email<input autoComplete="username" type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="name@yard.com" /></label>
    <label>Password<input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Your password" /></label>
    <button className="primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ChevronRight size={18}/></button>
  </form></main>;
}

function App() {
  const [user, setUser] = useState(null); const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState('records'); const [records, setRecords] = useState([]); const [historyRows, setHistoryRows] = useState([]);
  const [opsTab,setOpsTab]=useState('yards');
  const [overview, setOverview] = useState({ total: 0, inYard: 0, shipped: 0, todayEvents: 0 });
  const [page, setPage] = useState(1); const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('');
  const [actionType, setActionType] = useState('');
  const [selected, setSelected] = useState(null); const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [gates,setGates]=useState([]);
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState({ displayName: '', email: '', password: '', role: 'yard_operator', yardIds: [],gateIds:[] });
  const [manualEntry, setManualEntry] = useState({ originalBarcode: '', containerNumber:'',sizeCode:'40ft',typeCode:'general',isoCode:'',shippingLine:'',sealNumber:'',conditionCode:'good',yardId:'',gateId:'',assignedTo:'' });
  const [createdEntry, setCreatedEntry] = useState(null);
  const [entryPhoto,setEntryPhoto]=useState(null);const [entryPhotoPreview,setEntryPhotoPreview]=useState('');const [entryPhotoBusy,setEntryPhotoBusy]=useState(false);const [entryOcrLocked,setEntryOcrLocked]=useState(false);
  const [photoUploadTarget,setPhotoUploadTarget]=useState(null);
  const [yardOperators,setYardOperators]=useState([]);
  const [newLocation, setNewLocation] = useState({ zoneName: '', blockName: '', rowName: '', bayName:'01', tierName:'01', positionName: '', capacity:'1', status:'available', compatibleTypes:'' });
  const [yards, setYards] = useState([]);
  const pageCount = Math.max(1, Math.ceil(total / 25));

  useEffect(() => {
    const token = localStorage.getItem('yard_admin_token');
    if (!token) { setAuthReady(true); return; }
    api.get('/auth/me').then(({data}) => {
      if (!['admin', 'supervisor'].includes(data.user.role)) throw new Error('Account does not have admin panel access.');
      setUser(data.user);
    }).catch(() => localStorage.removeItem('yard_admin_token')).finally(() => setAuthReady(true));
  }, []);

  useEffect(() => { if(user){api.get(user.role==='admin'?'/admin/yards':'/yards').then(({data})=>{setYards(data);if(data.length){setNewUser(x=>({...x,yardIds:x.yardIds.length?x.yardIds:[Number(data[0].id)]}));setManualEntry(x=>({...x,yardId:x.yardId||String(data[0].id)}));}}).catch(e=>setError(errorText(e)));api.get('/gates').then(({data})=>setGates(data)).catch(e=>setError(errorText(e)));} }, [user]);

  async function loadData() {
    if (!user) return;
    setBusy(true); setError('');
    try {
      if (view === 'history') {
        const { data } = await api.get('/admin/history', { params: { page, limit: 25, search, actionType } });
        setHistoryRows(data.rows); setTotal(data.total);
      } else if (view === 'records') {
        const [{data: summary}, {data: list}] = await Promise.all([
          api.get('/admin/overview'), api.get('/admin/containers', { params: { page, limit: 25, search, status } }),
        ]);
        setOverview(summary); setRecords(list.rows); setTotal(list.total);
      }
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  useEffect(() => { loadData(); }, [user, view, page, search, status, actionType]);
  useEffect(() => { if (user && view === 'users' && user.role === 'admin') api.get('/admin/users').then(({data})=>setUsers(data)).catch(e=>setError(errorText(e))); }, [user, view]);
  useEffect(() => { if (user && ['manual', 'locations'].includes(view)) api.get('/admin/locations',{params:view==='manual'&&manualEntry.yardId?{yardId:manualEntry.yardId}:{}}).then(({data})=>setLocations(data)).catch(e=>setError(errorText(e))); }, [user, view, manualEntry.yardId]);
  useEffect(() => { if(user&&view==='manual'&&manualEntry.yardId){api.get('/yard-operators',{params:{yardId:manualEntry.yardId}}).then(({data})=>{setYardOperators(data);setManualEntry(x=>({...x,assignedTo:data.some(y=>String(y.id)===String(x.assignedTo))?x.assignedTo:(data[0]?String(data[0].id):'')}));}).catch(e=>{setYardOperators([]);setError(errorText(e));});}},[user,view,manualEntry.yardId]);

  async function showRecord(record) {
    try { const [{data},photos] = await Promise.all([api.get(`/admin/containers/${record.id}`),api.get(`/containers/${record.id}/photos`)]); setSelected({...data,photos:photos.data,transactions:(data.events||[]).map(e=>({...e,fromLocation:[e.fromZone,e.fromBlock,e.fromRow].filter(Boolean).join(' / '),toLocation:[e.toZone,e.toBlock,e.toRow].filter(Boolean).join(' / ')}))}); }
    catch (err) { setError(errorText(err)); }
  }
  async function createUser(event) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/admin/users', { ...newUser, yardIds: newUser.role==='admin'?[]:newUser.yardIds.map(Number),gateIds:newUser.gateIds.map(Number) }); setNewUser({ displayName: '', email: '', password: '', role: 'yard_operator', yardIds: yards[0]?.id?[Number(yards[0].id)]:[],gateIds:[] });
      const {data} = await api.get('/admin/users'); setUsers(data); setNotice('User account created.');
    } catch (err) { setError(errorText(err)); }
  }
  async function setActive(account) {
    try { await api.patch(`/admin/users/${account.id}/active`, { isActive: !account.isActive });
      const {data} = await api.get('/admin/users'); setUsers(data); setNotice('User access updated.');
    } catch (err) { setError(errorText(err)); }
  }
  async function updateRole(account,role){try{const yardIds=role==='admin'?[]:(account.yardIds?.length?account.yardIds:[Number(yards[0]?.id)].filter(Boolean));const gateIds=(account.gateIds||[]).filter(id=>role==='admin'||yardIds.includes(Number(gates.find(g=>Number(g.id)===Number(id))?.yardId)));await api.patch(`/admin/users/${account.id}`,{displayName:account.displayName,email:account.email,role,yardIds,gateIds,isActive:account.isActive});const {data}=await api.get('/admin/users');setUsers(data);setNotice('User role and access updated.');}catch(err){setError(errorText(err));}}
  async function updateYards(account,selected){try{const yardIds=selected.map(Number);const gateIds=(account.gateIds||[]).filter(id=>yardIds.includes(Number(gates.find(g=>Number(g.id)===Number(id))?.yardId)));await api.patch(`/admin/users/${account.id}`,{displayName:account.displayName,email:account.email,role:account.role,yardIds,gateIds,isActive:account.isActive});const {data}=await api.get('/admin/users');setUsers(data);setNotice('User yard access updated.');}catch(err){setError(errorText(err));}}
  async function updateGates(account,selected){try{await api.patch(`/admin/users/${account.id}`,{displayName:account.displayName,email:account.email,role:account.role,yardIds:account.yardIds||[],gateIds:selected.map(Number),isActive:account.isActive});const {data}=await api.get('/admin/users');setUsers(data);setNotice('User gate access updated.');}catch(err){setError(errorText(err));}}
  async function submitManualEntry(event) {
    event.preventDefault(); setError(''); setNotice(''); setCreatedEntry(null);
    let geo = {};
    if (navigator.geolocation) {
      try { const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 }));
        geo = { geoLat: position.coords.latitude, geoLong: position.coords.longitude };
      } catch { /* Manual entry may be recorded without a browser location. */ }
    }
    try {
      const {data} = await api.post('/admin/containers', { ...manualEntry, yardId:Number(manualEntry.yardId),gateId:Number(manualEntry.gateId)||undefined,assignedTo:Number(manualEntry.assignedTo), ...geo });
      setCreatedEntry(data);
      setManualEntry(x=>({...x,originalBarcode:'',containerNumber:'',sealNumber:''}));setEntryOcrLocked(false);
      if(entryPhoto){setPhotoUploadTarget(data.containerId);try{await uploadGatePhoto(data.containerId,entryPhoto);setPhotoUploadTarget(null);setEntryPhoto(null);setEntryPhotoPreview('');setNotice('Gate Entry and container photo saved. Put-away is assigned.');}catch{setError('Gate Entry was saved, but its photo did not upload. Tap Retry photo upload.');}}
      else setNotice('Gate Entry saved. Put-away is assigned to the selected Yard Operator.');
    } catch (err) { setError(errorText(err)); }
  }
  async function readEntryPhoto(file){
    if(!file)return;setEntryPhoto(file);setEntryPhotoPreview(URL.createObjectURL(file));setEntryPhotoBusy(true);setError('');
    let worker;
    try{worker=await createWorker('eng');const {data}=await worker.recognize(file);const number=containerNumberFromText(data.text);
      if(number){setManualEntry(x=>({...x,originalBarcode:number,containerNumber:number}));setEntryOcrLocked(true);setNotice('Container number read: '+number+'. Check it or tap Edit.');}
      else setError('Could not read a container number. Retake the photo or enter the number manually.');
    }catch{setError('Photo reading failed. Enter the container number manually.');}
    finally{await worker?.terminate();setEntryPhotoBusy(false);}
  }
  async function uploadGatePhoto(containerId,file){
    const form=new FormData();form.append('photo',file);
    return api.post('/containers/'+containerId+'/photos',form,{headers:{'Content-Type':'multipart/form-data'}});
  }
  async function retryGatePhotoUpload(){if(!photoUploadTarget||!entryPhoto)return;try{await uploadGatePhoto(photoUploadTarget,entryPhoto);setPhotoUploadTarget(null);setEntryPhoto(null);setEntryPhotoPreview('');setError('');setNotice('Container photo uploaded to Gate Entry.');}catch(err){setError(errorText(err));}}
  async function submitLocation(event) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/admin/locations', { ...newLocation, yardId: Number(newLocation.yardId||yards[0]?.id), capacity:Number(newLocation.capacity), compatibleTypes:newLocation.compatibleTypes.split(',').map(x=>x.trim()).filter(Boolean) }); setNewLocation({ zoneName: '', blockName: '', rowName: '', bayName:'01', tierName:'01', positionName: '', capacity:'1', status:'available', compatibleTypes:'' });
      const {data} = await api.get('/admin/locations'); setLocations(data); setNotice('Yard location created.');
    } catch (err) { setError(errorText(err)); }
  }
  async function setLocationActive(location) {
    try {
      await api.patch(`/admin/locations/${location.id}/active`, { isActive: !location.isActive });
      const {data} = await api.get('/admin/locations'); setLocations(data); setNotice('Location availability updated.');
    } catch (err) { setError(errorText(err)); }
  }
  function signOut() { localStorage.removeItem('yard_admin_token'); setUser(null); setSelected(null); }

  if (!authReady) return <div className="loading">Loading panel…</div>;
  if (!user) return <Login onLogin={setUser}/>;
  return <div className="shell">
    <aside className="sidebar">
      <div className="side-brand"><div className="brand-mark small"><Container size={22}/></div><div><b>Yard Tracker</b><span>OPERATIONS</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${view==='records'?'selected':''}`} onClick={()=>{setView('records');setPage(1);}}><Box size={18}/> Container records</button>
      <button className={`nav-item ${view==='history'?'selected':''}`} onClick={()=>{setView('history');setPage(1);}}><History size={18}/> Activity history</button>
      {user.role === 'admin' && <button className={`nav-item ${view==='manual'?'selected':''}`} onClick={()=>{setView('manual');setCreatedEntry(null);}}><ClipboardPlus size={18}/> Gate Entry</button>}
      {user.role === 'admin' && <button className={`nav-item ${view==='locations'?'selected':''}`} onClick={()=>setView('locations')}><MapPinned size={18}/> Location master</button>}
      {user.role === 'admin' && <button className={`nav-item ${view==='operations'&&opsTab==='yards'?'selected':''}`} onClick={()=>{setView('operations');setOpsTab('yards');}}>🏗️ Yards & gates</button>}
      {user.role === 'admin' && <button className={`nav-item ${view==='operations'&&opsTab==='shipments'?'selected':''}`} onClick={()=>{setView('operations');setOpsTab('shipments');}}><Truck size={18}/> Shipments</button>}
      {user.role === 'admin' && <button className={`nav-item ${view==='operations'&&opsTab==='reports'?'selected':''}`} onClick={()=>{setView('operations');setOpsTab('reports');}}>📊 Reports</button>}
      {user.role === 'admin' && <button className={`nav-item ${view==='operations'&&opsTab==='audit'?'selected':''}`} onClick={()=>{setView('operations');setOpsTab('audit');}}><ShieldCheck size={18}/> Security audit</button>}
      {user.role === 'admin' && <button className={`nav-item ${view==='users'?'selected':''}`} onClick={()=>setView('users')}><Users size={18}/> User access</button>}
      <div className="side-bottom"><div className="signed-user"><CircleUserRound size={20}/><div><b>{user.name}</b><span>{roleLabels[user.role]}</span></div></div><button className="signout" onClick={signOut}><LogOut size={17}/> Sign out</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">YARD MANAGEMENT</span><h1>{{records:'Container records',history:'Activity history',manual:'Gate Entry',locations:'Location master',users:'User access',operations:{yards:'Yards & gates',shipments:'Shipment management',reports:'Reports & exports',audit:'Security audit log'}}[view]?.[opsTab]||({records:'Container records',history:'Activity history',manual:'Gate Entry',locations:'Location master',users:'User access'}[view])}</h1></div><div className="top-meta"><span className="online-dot"/> API connected <button className="icon-button" title="Refresh" onClick={view==='records'||view==='history'?loadData:view==='locations'||view==='manual'?()=>api.get('/admin/locations').then(({data})=>setLocations(data)):()=>api.get('/admin/users').then(({data})=>setUsers(data))}><RefreshCw size={17}/></button></div></header>
      {error && <div className="error-box page-error">{error}<button onClick={()=>setError('')}><X size={16}/></button></div>}
      {notice && <div className="notice-box">{notice}<button onClick={()=>setNotice('')}><X size={16}/></button></div>}
      {view==='records' ? <>
        <section className="metrics">
          <Metric icon={<Container/>} label="TOTAL CONTAINERS" value={overview.total} tint="violet"/>
          <Metric icon={<PackageCheck/>} label="IN THE YARD" value={overview.inYard} tint="green"/>
          <Metric icon={<Truck/>} label="SHIPPED" value={overview.shipped} tint="blue"/>
          <Metric icon={<Activity/>} label="ACTIONS TODAY" value={overview.todayEvents} tint="orange"/>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><h2>All containers</h2><p>Search records and open a container to see its full audit trail.</p></div><span className="record-count">{total.toLocaleString()} records</span></div>
          <div className="filters"><div className="searchbox"><Search size={18}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search barcode…" /></div>
            <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All active statuses</option><option value="awaiting_putaway">Awaiting put-away</option><option value="in-yard">In yard</option><option value="reserved_for_shipment">Reserved</option><option value="ready_for_gate_out">Ready for gate-out</option><option value="dispatched">Dispatched</option></select>
          </div>
          <div className="table-wrap"><table><thead><tr><th>CONTAINER</th><th>TRACKING BARCODE</th><th>LOCATION</th><th>STATUS</th><th>GATE IN</th><th></th></tr></thead><tbody>
            {busy && !records.length ? <tr><td className="empty" colSpan="6">Loading records…</td></tr> : records.map(r=><tr key={r.id} onClick={()=>showRecord(r)} className="click-row">
              <td><div className="cell-main"><span className="mini-icon"><Container size={16}/></span><b>{r.originalBarcode}</b></div></td><td className="code-cell">{r.trackingBarcode}</td><td>{r.locationName || <span className="muted">—</span>}</td><td><Status status={r.status}/></td><td>{dateText(r.createdAt)}</td><td><ChevronRight size={17} className="row-arrow"/></td>
            </tr>)}
            {!busy && !records.length && <tr><td className="empty" colSpan="6">No containers match these filters.</td></tr>}
          </tbody></table></div>
          <div className="pagination"><span>Showing {total ? (page-1)*25+1 : 0}–{Math.min(page*25,total)} of {total}</span><div><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={17}/></button><span>Page {page} of {pageCount}</span><button disabled={page>=pageCount} onClick={()=>setPage(p=>p+1)}><ChevronRight size={17}/></button></div></div>
        </section>
      </> : view==='history' ? <section className="panel">
        <div className="panel-heading"><div><h2>Yard activity</h2><p>Every gate entry, put-away, move, and exit in time order.</p></div><span className="record-count">{total.toLocaleString()} events</span></div>
        <div className="filters"><div className="searchbox"><Search size={18}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search container or tracking code…" /></div>
          <select value={actionType} onChange={e=>{setActionType(e.target.value);setPage(1);}}><option value="">All actions</option>{['Gate In','Put Away','Move','Gate Out'].map(a=><option key={a}>{a}</option>)}</select>
        </div><div className="table-wrap"><table><thead><tr><th>WHEN</th><th>ACTION</th><th>CONTAINER</th><th>LOCATION CHANGE</th><th>USER</th></tr></thead><tbody>
          {busy&&!historyRows.length?<tr><td className="empty" colSpan="5">Loading activity…</td></tr>:historyRows.map(row=><tr key={row.id} className="click-row" onClick={()=>showRecord({id:row.containerId})}><td>{dateText(row.timestamp)}</td><td><span className={`action-pill ${row.actionType.toLowerCase().replace(' ','-')}`}>{row.actionType}</span></td><td><b>{row.originalBarcode}</b><div className="code-cell">{row.trackingBarcode}</div></td><td>{row.fromLocation||'Gate'} <span className="route-arrow">→</span> {row.toLocation||'Gate'}</td><td>{row.userName||'—'}<div className="muted">{roleLabels[row.userRole]||''}</div></td></tr>)}
          {!busy&&!historyRows.length&&<tr><td className="empty" colSpan="5">No activity matches this search.</td></tr>}
        </tbody></table></div><Pagination page={page} pageCount={pageCount} total={total} onPage={setPage}/>
      </section> : view==='manual' ? <section className="master-grid">
        <form className="panel master-form" onSubmit={submitManualEntry}><div className="panel-heading"><div><h2>Gate Entry</h2><p>Scan, photograph, or enter the container number. Assign the Yard Operator who will put it away.</p></div><div className="panel-icon green"><ClipboardPlus size={20}/></div></div>
          <label>Yard<select required value={manualEntry.yardId||yards[0]?.id||''} onChange={e=>setManualEntry({...manualEntry,yardId:e.target.value,gateId:'',assignedTo:''})}><option value="">Choose yard</option>{yards.filter(y=>y.isActive).map(y=><option key={y.id} value={y.id}>{y.yardName}</option>)}</select></label>
          <label>Entry gate<select required value={manualEntry.gateId} onChange={e=>setManualEntry({...manualEntry,gateId:e.target.value})}><option value="">Choose entry gate</option>{gates.filter(g=>Number(g.yardId)===Number(manualEntry.yardId||yards[0]?.id)&&['in','both'].includes(g.direction)).map(g=><option key={g.id} value={g.id}>{g.gateName}</option>)}</select></label>
          <label>Container number<input required autoFocus value={manualEntry.originalBarcode} onChange={e=>setManualEntry({...manualEntry,originalBarcode:e.target.value.toUpperCase(),containerNumber:e.target.value.toUpperCase()})} placeholder="Scan barcode or enter container number" readOnly={entryOcrLocked}/></label>
          {entryOcrLocked&&<button type="button" className="link-button edit-ocr" onClick={()=>setEntryOcrLocked(false)}><Pencil size={14}/> Edit read number</button>}
          <label className="photo-picker">📷 Capture / upload container photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>readEntryPhoto(e.target.files?.[0])}/></label>
          {entryPhotoBusy&&<div className="helper-note">Reading the container number from this photo…</div>}
          {entryPhotoPreview&&<div className="entry-photo-preview"><img src={entryPhotoPreview} alt="Container entry photo"/><span>{photoUploadTarget?'Photo upload pending':'Photo will be saved with this Gate Entry'}</span>{photoUploadTarget?<button type="button" onClick={retryGatePhotoUpload}>Retry upload</button>:<button type="button" onClick={()=>{setEntryPhoto(null);setEntryPhotoPreview('');}}>Remove</button>}</div>}
          <label>Put-away assigned to · Yard Operator<select required value={manualEntry.assignedTo} onChange={e=>setManualEntry({...manualEntry,assignedTo:e.target.value})}><option value="">Choose Yard Operator</option>{yardOperators.map(x=><option key={x.id} value={x.id}>{x.displayName}</option>)}</select></label>
          {!yardOperators.length&&<div className="helper-note">No active Yard Operators are assigned to this yard. Create or assign a Yard Operator in User access before saving Gate Entry.</div>}
          <div className="form-pair"><label>Size<select value={manualEntry.sizeCode} onChange={e=>setManualEntry({...manualEntry,sizeCode:e.target.value})}><option>20ft</option><option>40ft</option><option>45ft</option></select></label><label>Type<select value={manualEntry.typeCode} onChange={e=>setManualEntry({...manualEntry,typeCode:e.target.value})}>{['general','reefer','open_top','flat_rack','tank'].map(x=><option key={x}>{x}</option>)}</select></label></div>
          <div className="form-pair"><label>ISO code<input value={manualEntry.isoCode} onChange={e=>setManualEntry({...manualEntry,isoCode:e.target.value})} placeholder="Optional"/></label><label>Condition<select value={manualEntry.conditionCode} onChange={e=>setManualEntry({...manualEntry,conditionCode:e.target.value})}><option value="good">Good</option><option value="damaged">Damaged</option><option value="inspection_required">Needs inspection</option><option value="unknown">Unknown</option></select></label></div>
          <div className="form-pair"><label>Shipping line<input value={manualEntry.shippingLine} onChange={e=>setManualEntry({...manualEntry,shippingLine:e.target.value})}/></label><label>Seal number<input value={manualEntry.sealNumber} onChange={e=>setManualEntry({...manualEntry,sealNumber:e.target.value})}/></label></div>
          <div className="helper-note"><MapPin size={16}/> Browser GPS is captured when permission is available. The assigned Yard Operator chooses an available slot in the mobile app.</div>
          <button className="primary full" disabled={entryPhotoBusy||!yardOperators.length}><Plus size={18}/> Save Gate Entry & Assign Put-away</button>
          {createdEntry&&<div className="created-code"><div className="check-mark">✓</div><div className="created-code-content"><span>ENTRY SAVED · CODE 128 TRACKING</span><b>{createdEntry.trackingBarcode}</b><BarcodeLabel value={createdEntry.trackingBarcode}/><small>Print or attach this code to the container. The event is in the audit history.</small></div></div>}
        </form><div className="panel help-panel"><div className="panel-heading"><div><h2>Gate Entry → Yard Put-away</h2><p>Two role-separated steps for every new container.</p></div></div><ol className="steps"><li><b>Gate Operator or admin records entry</b><span>Container number, GPS and optional photo are saved. A unique Code 128 tracking barcode is created.</span></li><li><b>Yard Operator receives the task</b><span>The selected operator sees the assigned task in the mobile Put-away screen.</span></li><li><b>Operator stores the container</b><span>Only available, compatible slots are offered. The app records the put-away event and location.</span></li></ol></div>
      </section> : view==='locations' ? <section className="master-grid">
        <form className="panel master-form" onSubmit={submitLocation}><div className="panel-heading"><div><h2>Add yard position</h2><p>Build the exact slot from zone, block, row, and position.</p></div><div className="panel-icon blue"><MapPinned size={20}/></div></div>
          <label>Yard<select value={newLocation.yardId||yards[0]?.id||''} onChange={e=>setNewLocation({...newLocation,yardId:e.target.value})}>{yards.map(y=><option key={y.id} value={y.id}>{y.yardName}</option>)}</select></label>
          <label>Zone / yard area<input required value={newLocation.zoneName} onChange={e=>setNewLocation({...newLocation,zoneName:e.target.value})} placeholder="North Yard"/></label>
          <div className="form-pair"><label>Block<input required value={newLocation.blockName} onChange={e=>setNewLocation({...newLocation,blockName:e.target.value})} placeholder="A"/></label><label>Row<input required value={newLocation.rowName} onChange={e=>setNewLocation({...newLocation,rowName:e.target.value})} placeholder="01"/></label></div>
          <div className="form-pair"><label>Bay<input required value={newLocation.bayName} onChange={e=>setNewLocation({...newLocation,bayName:e.target.value})}/></label><label>Tier<input required value={newLocation.tierName} onChange={e=>setNewLocation({...newLocation,tierName:e.target.value})}/></label></div>
          <div className="form-pair"><label>Position<input required value={newLocation.positionName} onChange={e=>setNewLocation({...newLocation,positionName:e.target.value})} placeholder="01"/></label><label>Capacity<input type="number" min="1" max="100" value={newLocation.capacity} onChange={e=>setNewLocation({...newLocation,capacity:e.target.value})}/></label></div>
          <div className="form-pair"><label>Slot status<select value={newLocation.status} onChange={e=>setNewLocation({...newLocation,status:e.target.value})}><option value="available">Available</option><option value="reserved">Reserved</option><option value="blocked">Blocked</option></select></label><label>Compatible types<input value={newLocation.compatibleTypes} onChange={e=>setNewLocation({...newLocation,compatibleTypes:e.target.value})} placeholder="20GP, 40HC or blank"/></label></div>
          <div className="helper-note"><Layers3 size={16}/> Location barcode ID is generated from these fields.</div>
          <button className="primary full"><Plus size={18}/> Create location</button>
        </form>
        <div className="panel location-list"><div className="panel-heading"><div><h2>Location master</h2><p>Available positions appear in the mobile location picker.</p></div><span className="record-count">{locations.length} positions</span></div>
          <div className="location-items">{locations.map(loc=><div className="location-item" key={loc.id}><span className="location-icon"><MapPin size={17}/></span><div className="location-copy"><b>{loc.label}</b><span>{loc.barcodeId} · {loc.status} · capacity {loc.capacity}</span></div><span className={`access ${loc.isActive?'active':'inactive'}`}>{loc.isActive?'Active':'Inactive'}</span><button className="link-button" onClick={()=>setLocationActive(loc)}>{loc.isActive?'Disable':'Enable'}</button></div>)}{!locations.length&&<p className="empty">No locations yet.</p>}</div>
        </div>
      </section> : view==='users' ? <section className="users-layout">
        <div className="panel users-panel"><div className="panel-heading"><div><h2>Team accounts</h2><p>Access follows each person's application role.</p></div><span className="record-count">{users.length} users</span></div>
          <div className="table-wrap"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>YARD ACCESS</th><th>GATE ACCESS</th><th>ACCESS</th><th></th></tr></thead><tbody>{users.map(account=><tr key={account.id}><td><b>{account.displayName}</b></td><td>{account.email}</td><td><select value={account.role} disabled={account.id===user.id} onChange={e=>updateRole(account,e.target.value)}>{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></td><td>{account.role==='admin'?'All yards':<select multiple className="yard-access-select" value={(account.yardIds||[]).map(String)} onChange={e=>updateYards(account,Array.from(e.target.selectedOptions).map(o=>o.value))}>{yards.map(y=><option key={y.id} value={y.id}>{y.yardName}</option>)}</select>}</td><td>{account.role==='admin'?'All gates':<select multiple className="yard-access-select" value={(account.gateIds||[]).map(String)} onChange={e=>updateGates(account,Array.from(e.target.selectedOptions).map(o=>o.value))}>{gates.filter(g=>!account.yardIds?.length||account.yardIds.includes(Number(g.yardId))).map(g=><option key={g.id} value={g.id}>{g.gateName}</option>)}</select>}</td><td><span className={`access ${account.isActive?'active':'inactive'}`}>{account.isActive?'Active':'Disabled'}</span></td><td><button className="link-button" onClick={()=>setActive(account)}>{account.isActive?'Disable':'Enable'}</button></td></tr>)}</tbody></table></div>
          <div className="role-note"><ShieldCheck size={18}/><span><b>Role permissions</b> · Gate operators handle entry and exit. Yard workers put away and move containers. Supervisors can view all records and perform yard actions. Administrators also manage user access.</span></div>
        </div>
        <form className="panel create-user" onSubmit={createUser}><div className="panel-heading"><div><h2>Add team member</h2><p>Create an account for the mobile app or panel.</p></div></div>
          <label>Full name<input required value={newUser.displayName} onChange={e=>setNewUser({...newUser,displayName:e.target.value})} placeholder="Name"/></label>
          <label>Email<input required type="email" value={newUser.email} onChange={e=>setNewUser({...newUser,email:e.target.value})} placeholder="name@yard.com"/></label>
          <label>Temporary password<input required minLength="10" type="password" value={newUser.password} onChange={e=>setNewUser({...newUser,password:e.target.value})} placeholder="At least 10 characters"/></label>
          <label>Application role<select value={newUser.role} onChange={e=>setNewUser({...newUser,role:e.target.value})}>{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          {newUser.role!=='admin'&&<label>Assigned yard(s)<select required multiple value={newUser.yardIds.map(String)} onChange={e=>setNewUser({...newUser,yardIds:Array.from(e.target.selectedOptions).map(o=>Number(o.value))})}>{yards.map(y=><option key={y.id} value={y.id}>{y.yardName}</option>)}</select><small>Hold Ctrl or Command to select more than one yard.</small></label>}
          {newUser.role!=='admin'&&<label>Assigned gate(s), optional<select multiple value={newUser.gateIds.map(String)} onChange={e=>setNewUser({...newUser,gateIds:Array.from(e.target.selectedOptions).map(o=>Number(o.value))})}>{gates.filter(g=>!newUser.yardIds.length||newUser.yardIds.includes(Number(g.yardId))).map(g=><option key={g.id} value={g.id}>{g.gateName}</option>)}</select><small>No gate selection means all gates in the selected yards.</small></label>}
          <button className="primary full">Create account <ChevronRight size={18}/></button>
        </form>
      </section> : <Operations tab={opsTab} setError={setError} setNotice={setNotice}/>}
      <footer>Container Yard Management <span>·</span> Signed in as {user.name}</footer>
    </main>
    {selected && <Detail record={selected} editable={user.role==='admin'} onClose={()=>setSelected(null)} onSaved={showRecord}/>}
  </div>;
}

function Metric({icon,label,value,tint}) { return <div className="metric"><div className={`metric-icon ${tint}`}>{icon}</div><div><span>{label}</span><b>{value.toLocaleString()}</b></div></div>; }
function Status({status}) { const labels={awaiting_putaway:'Awaiting put-away','in-yard':'In yard',reserved_for_shipment:'Reserved',ready_for_gate_out:'Ready for exit',dispatched:'Dispatched',shipped:'Dispatched'}; return <span className={`status ${status==='in-yard'?'in-yard':status==='dispatched'||status==='shipped'?'shipped':'awaiting'}`}><i/>{labels[status]||status}</span>; }
function Pagination({page,pageCount,total,onPage}) { return <div className="pagination"><span>Showing {total ? (page-1)*25+1 : 0}–{Math.min(page*25,total)} of {total}</span><div><button disabled={page<=1} onClick={()=>onPage(page-1)}><ChevronLeft size={17}/></button><span>Page {page} of {pageCount}</span><button disabled={page>=pageCount} onClick={()=>onPage(page+1)}><ChevronRight size={17}/></button></div></div>; }
function BarcodeLabel({value}) { const ref=useRef(null); useEffect(()=>{if(ref.current)JsBarcode(ref.current,value,{format:'CODE128',height:54,displayValue:false,margin:4,lineColor:'#15232d'});},[value]); return <svg ref={ref} className="barcode-label" aria-label="Code 128 tracking barcode"/>; }

function Detail({record,onClose,editable,onSaved}) {
  const [editing,setEditing]=useState(false);const [draft,setDraft]=useState({});const [saving,setSaving]=useState(false);const [barcodeOpen,setBarcodeOpen]=useState(false);
  const [photoUrls,setPhotoUrls]=useState([]);
  useEffect(()=>setDraft({containerNumber:record.containerNumber||'',sizeCode:record.sizeCode||'',typeCode:record.typeCode||'',isoCode:record.isoCode||'',shippingLine:record.shippingLine||'',sealNumber:record.sealNumber||'',conditionCode:record.conditionCode||'unknown',remarks:record.remarks||''}),[record]);
  useEffect(()=>{let active=true;const urls=[];(async()=>{for(const photo of record.photos||[]){try{const response=await api.get('/container-photos/'+photo.id,{responseType:'blob'});const url=URL.createObjectURL(response.data);urls.push(url);}catch{}}if(active)setPhotoUrls(urls);else urls.forEach(URL.revokeObjectURL);})();return()=>{active=false;urls.forEach(URL.revokeObjectURL);};},[record.id,record.photos]);
  async function saveDetails(e){e.preventDefault();setSaving(true);try{await api.patch(`/admin/containers/${record.id}`,draft);setEditing(false);await onSaved({id:record.id});}catch(err){alert(errorText(err));}finally{setSaving(false);}}
  useEffect(()=>{const onKey=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><aside className="drawer">
    <div className="drawer-head"><div><span className="eyebrow">CONTAINER #{record.id}</span><h2>Record details</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <div className="detail-card"><div className="detail-title"><span className="mini-icon"><Container size={18}/></span><div><b>{record.originalBarcode}</b><span>Original barcode</span></div></div>
      <div className="detail-grid"><div><span>Tracking barcode</span><button className="tracking-barcode-link" onClick={()=>setBarcodeOpen(true)} title="Show tracking barcode"><b className="code-cell">{record.trackingBarcode}</b><small>Click to view / print</small></button></div><div><span>Status</span><Status status={record.status}/></div><div><span>Current location</span><b>{record.locationName || 'Not assigned'}</b></div><div><span>Gate-in date</span><b>{dateText(record.createdAt)}</b></div><div><span>Put-away operator</span><b>{record.putawayAssignedToName || (record.status==='awaiting_putaway'?'Unassigned':'—')}</b></div></div>
    </div>
    {editable&&<div className="panel"><div className="panel-heading"><div><h2>Container master</h2><p>Edit identification and condition details.</p></div><button className="link-button" onClick={()=>setEditing(v=>!v)}>{editing?'Cancel':'Edit'}</button></div>{editing?<form onSubmit={saveDetails} className="master-form">{[['containerNumber','Container number'],['sizeCode','Size code'],['typeCode','Container type'],['isoCode','ISO code'],['shippingLine','Shipping line'],['sealNumber','Seal number'],['remarks','Remarks']].map(([key,label])=><label key={key}>{label}<input value={draft[key]||''} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}<label>Condition<select value={draft.conditionCode} onChange={e=>setDraft({...draft,conditionCode:e.target.value})}><option value="good">Good</option><option value="damaged">Damaged</option><option value="inspection_required">Needs inspection</option><option value="unknown">Unknown</option></select></label><button className="primary full" disabled={saving}>{saving?'Saving…':'Save details'}</button></form>:<div className="detail-grid"><div><span>Size / type</span><b>{record.sizeCode||'—'} / {record.typeCode||'—'}</b></div><div><span>ISO code</span><b>{record.isoCode||'—'}</b></div><div><span>Shipping line</span><b>{record.shippingLine||'—'}</b></div><div><span>Seal / condition</span><b>{record.sealNumber||'—'} / {record.conditionCode||'unknown'}</b></div></div>}</div>}
    {barcodeOpen&&<div className="barcode-overlay" onMouseDown={e=>e.target===e.currentTarget&&setBarcodeOpen(false)}><section className="barcode-dialog"><div className="barcode-dialog-head"><div><h2>TRACKING BARCODE</h2><p>Code 128 · Container {record.originalBarcode}</p></div><button className="icon-button" onClick={()=>setBarcodeOpen(false)} aria-label="Close"><X size={18}/></button></div><div className="barcode-print-area"><BarcodeLabel value={record.trackingBarcode}/><b>{record.trackingBarcode}</b></div><button className="primary barcode-print-button" onClick={()=>window.print()}><Printer size={17}/> Print barcode</button></section></div>}
    {!!photoUrls.length&&<section className="detail-photos"><div><b>Gate entry photos</b><span>{photoUrls.length} saved</span></div><div className="detail-photo-grid">{photoUrls.map((src,index)=><img key={src} src={src} alt={'Container gate entry '+(index+1)}/>)}</div></section>}
    <div className="timeline-title"><div><h3>Activity history</h3><p>{record.transactions.length} recorded actions</p></div><Clock3 size={19}/></div>
    <div className="timeline">{record.transactions.map((tx,i)=><div className="event" key={tx.id}><div className={`event-dot ${i===0?'latest':''}`}/><div className="event-content"><div className="event-top"><b>{tx.actionType}</b><span>{dateText(tx.timestamp)}</span></div>
      <div className="event-route">{tx.fromLocation && <span><ArrowUpRight size={14}/>{tx.fromLocation}</span>}{tx.toLocation && <span><ArrowDownRight size={14}/>{tx.toLocation}</span>}{!tx.fromLocation&&!tx.toLocation&&<span><MapPin size={14}/>Gate</span>}</div>
      <div className="event-meta">{tx.userName ? `${tx.userName} · ${roleLabels[tx.userRole] || tx.userRole}` : 'User record unavailable'}{tx.geoLat!=null&&tx.geoLong!=null&&` · ${Number(tx.geoLat).toFixed(5)}, ${Number(tx.geoLong).toFixed(5)}`}</div>
    </div></div>)}</div>
  </aside></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
