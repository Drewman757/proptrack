// PropTrack — Multi-user edition with Supabase auth + RLS
// ─────────────────────────────────────────────────────────
// ENV VARS needed (Vercel → Settings → Environment Variables):
//   VITE_SUPABASE_URL      = https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY = eyJ...
//
// Install: npm install @supabase/supabase-js
// ─────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase client ──────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── Supabase Storage helpers ─────────────────────────────────────────────────
const BUCKET = "proptrack-files";

async function uploadFile(file, folder) {
  const ext = file.name.split(".").pop();
  const path = `${folder}/${Math.random().toString(36).slice(2,9)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl, name: file.name };
}

async function deleteFile(path) {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = ["Lawn Care","Pool Service","House Cleaning","HVAC","Plumbing","Electrical","Pest Control","Roofing","Landscaping","General Repair","Insurance","HOA","Taxes","Interest","Other"];
const RECURRING_OPTIONS = [
  { value:"one-time",  label:"One-Time",  color:"#6b7280" },
  { value:"monthly",   label:"Monthly",   color:"#8b5cf6" },
  { value:"quarterly", label:"Quarterly", color:"#0891b2" },
  { value:"annually",  label:"Annually",  color:"#4a7c59" },
];
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const PROPERTY_COLORS = ["#e07b39","#4a7c59","#3b6fa0","#8b5cf6","#d946a8","#e11d48","#0891b2","#b45309"];
const PROJECT_STATUSES = ["Planning","In Progress","On Hold","Complete"];
const PROJECT_STATUS_COLORS = { Planning:"#3b6fa0","In Progress":"#b45309","On Hold":"#6b7280",Complete:"#4a7c59" };
const TASK_TYPES = ["Demo / Removal","Framing","Plumbing","Electrical","Drywall","Flooring","Painting","Cabinetry","Fixtures","Roofing","Landscaping","Inspection","Other"];

// Generic project templates auto-created per property
const GENERIC_PROJECT_TEMPLATES = [
  { name:"Utilities", description:"Recurring utility expenses — electric, water, gas, internet, trash.", defaultCategory:"Other", isGeneric:true },
  { name:"HOA / Taxes / Insurance", description:"HOA fees, property taxes, and insurance premiums.", defaultCategory:"HOA", isGeneric:true },
];

// ─── Utilities ────────────────────────────────────────────────────────────────
const fmt = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n||0);
const uid = () => Math.random().toString(36).slice(2,9);
function leaseStatus(start, end) {
  if (!start||!end) return "unknown";
  const now = new Date(); const e = new Date(end);
  const d = Math.ceil((e-now)/86400000);
  if (d<0) return "expired"; if (d<=60) return "expiring"; return "active";
}
function leaseLabel(s) { return {active:"Active",expiring:"Expiring Soon",expired:"Expired",unknown:"No Dates"}[s]; }
function leaseColor(s) { return {active:"#4a7c59",expiring:"#b45309",expired:"#9b1c1c",unknown:"#374151"}[s]; }

// Returns actual months in a lease (seasonal-aware)
function leaseMonths(start, end) {
  if (!start || !end) return 12;
  const s = new Date(start); const e = new Date(end);
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  return Math.max(1, months);
}
// Total rent over the actual lease term
function leaseTotalRent(t) {
  return Number(t.monthlyRent||0) * leaseMonths(t.leaseStart, t.leaseEnd);
}
// Seasonal = lease shorter than 10 months
function isSeasonal(t) {
  return !!(t.leaseStart && t.leaseEnd && leaseMonths(t.leaseStart, t.leaseEnd) < 10);
}

// ─── Supabase data helpers ────────────────────────────────────────────────────
// Translates snake_case DB rows → camelCase app objects
function rowToProperty(r) {
  return { id:r.id, ownerId:r.owner_id, name:r.name, address:r.address||"", city:r.city||"", state:r.state||"FL", color:r.color||"#e07b39", ownerEmail:r.owner_email, ownerName:r.owner_name };
}
function rowToTenant(r) {
  return { id:r.id, ownerId:r.owner_id, propertyId:r.property_id, name:r.name, email:r.email||"", phone:r.phone||"", unit:r.unit||"", leaseStart:r.lease_start||"", leaseEnd:r.lease_end||"", monthlyRent:r.monthly_rent||"", securityDeposit:r.security_deposit||"", notes:r.notes||"", contractFileName:r.contract_file_name||null };
}
function rowToVendor(r) {
  return { id:r.id, name:r.name, category:r.category, phone:r.phone||"", email:r.email||"", notes:r.notes||"", createdBy:r.created_by };
}
function rowToInvoice(r) {
  return { id:r.id, ownerId:r.owner_id, propertyId:r.property_id||"", vendorId:r.vendor_id||"", projectId:r.project_id||"", category:r.category||CATEGORIES[0], amount:r.amount||"", date:r.date||"", description:r.description||"", fileName:r.file_name||null, fileUrl:r.file_url||null, filePath:r.file_path||null, invoiceNumber:r.invoice_number||null, recurring:r.recurring||"one-time", ownerEmail:r.owner_email, ownerName:r.owner_name };
}
function rowToProject(r) {
  return { id:r.id, ownerId:r.owner_id, propertyId:r.property_id||"", name:r.name, description:r.description||"", status:r.status||"Planning", startDate:r.start_date||"", endDate:r.end_date||"", vendorIds:r.vendor_ids||[], tasks:r.tasks||[], ownerEmail:r.owner_email, ownerName:r.owner_name };
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icon = ({ name, size=16 }) => {
  const icons = {
    home: <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,
    users: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
    tenant: <><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></>,
    receipt: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
    chart: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></>,
    upload: <><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    file: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    phone: <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>,
    mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    wrench: <><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
    check: <polyline points="20 6 9 17 4 12"/>,
    chevronRight: <polyline points="9 18 15 12 9 6"/>,
    arrowLeft: <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
    logout: <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    dollar: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,
    clipboard: <><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(10,12,18,0.82)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }}>
      <div style={{ background:"#14181f",border:"1px solid #2a2f3d",borderRadius:"14px",width:"100%",maxWidth:wide?"660px":"520px",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.55)" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1.25rem 1.5rem",borderBottom:"1px solid #1e2430",position:"sticky",top:0,background:"#14181f",zIndex:10 }}>
          <h3 style={{ margin:0,fontSize:"1rem",fontWeight:600,color:"#e8eaf0" }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#6b7280",cursor:"pointer",padding:"4px",display:"flex" }}><Icon name="x" size={18}/></button>
        </div>
        <div style={{ padding:"1.5rem" }}>{children}</div>
      </div>
    </div>
  );
}
const inputStyle = { width:"100%",background:"#0d1117",border:"1px solid #2a2f3d",borderRadius:"8px",color:"#e8eaf0",padding:"0.55rem 0.75rem",fontSize:"0.875rem",outline:"none",boxSizing:"border-box",fontFamily:"inherit" };
const labelStyle = { display:"block",marginBottom:"0.35rem",fontSize:"0.75rem",fontWeight:600,color:"#8b93a7",textTransform:"uppercase",letterSpacing:"0.05em" };
function Field({ label, children }) { return <div style={{ marginBottom:"1rem" }}><label style={labelStyle}>{label}</label>{children}</div>; }
function Grid2({ children }) { return <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.75rem" }}>{children}</div>; }
function SectionDivider({ label }) {
  return <div style={{ fontSize:"0.7rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"0.75rem",paddingBottom:"0.5rem",borderBottom:"1px solid #1e2430",marginTop:"1rem" }}>{label}</div>;
}
function Badge({ color, label }) {
  return <span style={{ fontSize:"0.68rem",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color,background:color+"22",border:`1px solid ${color}44`,borderRadius:"99px",padding:"2px 8px",whiteSpace:"nowrap" }}>{label}</span>;
}
function BtnPrimary({ onClick, children, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ display:"flex",alignItems:"center",gap:"6px",background:disabled?"#4b3020":"#e07b39",color:disabled?"#6b7280":"#fff",border:"none",borderRadius:"8px",padding:"0.5rem 1rem",cursor:disabled?"not-allowed":"pointer",fontSize:"0.85rem",fontWeight:600 }}>{children}</button>;
}
function BtnDanger({ onClick, children }) {
  return <button onClick={onClick} style={{ background:"#3d1515",color:"#f87171",border:"1px solid #5c1f1f",borderRadius:"8px",padding:"0.5rem 1rem",cursor:"pointer",fontSize:"0.85rem",display:"flex",alignItems:"center",gap:"6px" }}>{children}</button>;
}
function BtnSecondary({ onClick, children }) {
  return <button onClick={onClick} style={{ display:"flex",alignItems:"center",gap:"6px",background:"#1e2430",color:"#94a3b8",border:"1px solid #2a2f3d",borderRadius:"8px",padding:"0.5rem 1rem",cursor:"pointer",fontSize:"0.85rem",fontWeight:500 }}>{children}</button>;
}
function OwnerTag({ email, name }) {
  if (!email) return null;
  return (
    <span style={{ fontSize:"0.65rem",background:"#1a1f2b",color:"#6b7280",border:"1px solid #2a2f3d",borderRadius:"4px",padding:"1px 6px",display:"inline-flex",alignItems:"center",gap:"3px" }}>
      <Icon name="eye" size={9}/>{name||email}
    </span>
  );
}
function Spinner() {
  return <span style={{ display:"inline-block",width:"14px",height:"14px",border:"2px solid #e07b39",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.7s linear infinite" }}/>;
}

// ─── Login / Auth Screen ──────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  async function handleSubmit() {
    setError(null); setMsg(null); setLoading(true);
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.session);
      } else {
        const { error } = await supabase.auth.signUp({ email, password, options:{ data:{ full_name:name } } });
        if (error) throw error;
        setMsg("Check your email to confirm your account, then log in.");
        setMode("login");
      }
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background:"#0a0c12",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:"1rem" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap');*{box-sizing:border-box;}body{margin:0;}input:focus{outline:none;border-color:#e07b39!important;}@keyframes spin{to{transform:rotate(360deg);}}`}</style>
      <div style={{ width:"100%",maxWidth:"400px" }}>
        {/* Logo */}
        <div style={{ display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"2rem",justifyContent:"center" }}>
          <div style={{ width:"36px",height:"36px",background:"#e07b39",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center" }}>
            <Icon name="home" size={18}/>
          </div>
          <span style={{ fontWeight:700,fontSize:"1.2rem",color:"#e8eaf0" }}>PropTrack</span>
        </div>

        <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"16px",padding:"2rem",boxShadow:"0 24px 48px rgba(0,0,0,0.4)" }}>
          <h2 style={{ margin:"0 0 1.5rem",fontSize:"1.1rem",fontWeight:700,color:"#e8eaf0",textAlign:"center" }}>
            {mode==="login"?"Welcome back":"Create account"}
          </h2>

          {error && <div style={{ background:"#1c0808",border:"1px solid #5c1f1f",borderRadius:"8px",padding:"0.75rem 1rem",marginBottom:"1rem",fontSize:"0.82rem",color:"#f87171" }}>{error}</div>}
          {msg && <div style={{ background:"#0c1c10",border:"1px solid #1e4a2a",borderRadius:"8px",padding:"0.75rem 1rem",marginBottom:"1rem",fontSize:"0.82rem",color:"#4ade80" }}>{msg}</div>}

          {mode==="signup" && (
            <Field label="Full Name">
              <input style={inputStyle} value={name} onChange={e=>setName(e.target.value)} placeholder="Jane Smith"/>
            </Field>
          )}
          <Field label="Email">
            <input style={inputStyle} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
          </Field>
          <Field label="Password">
            <input style={inputStyle} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
          </Field>

          <button onClick={handleSubmit} disabled={loading} style={{ width:"100%",background:"#e07b39",color:"#fff",border:"none",borderRadius:"10px",padding:"0.7rem",cursor:loading?"not-allowed":"pointer",fontSize:"0.9rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:"0.5rem",marginTop:"0.5rem" }}>
            {loading && <Spinner/>}
            {mode==="login"?"Sign In":"Create Account"}
          </button>

          <div style={{ textAlign:"center",marginTop:"1.25rem",fontSize:"0.82rem",color:"#6b7280" }}>
            {mode==="login" ? (
              <>No account? <button onClick={()=>{setMode("signup");setError(null);}} style={{ background:"none",border:"none",color:"#e07b39",cursor:"pointer",fontWeight:600,fontSize:"0.82rem" }}>Sign up</button></>
            ) : (
              <>Already have one? <button onClick={()=>{setMode("login");setError(null);}} style={{ background:"none",border:"none",color:"#e07b39",cursor:"pointer",fontWeight:600,fontSize:"0.82rem" }}>Sign in</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Admin: User Switcher Banner ──────────────────────────────────────────────
// Lets admin impersonate / view as another user
function AdminBanner({ profiles, viewingAs, setViewingAs }) {
  return (
    <div style={{ background:"#1a0f05",borderBottom:"1px solid #78350f",padding:"0.5rem 1.5rem",display:"flex",alignItems:"center",gap:"1rem",flexWrap:"wrap" }}>
      <div style={{ display:"flex",alignItems:"center",gap:"0.4rem",fontSize:"0.75rem",color:"#fbbf24",fontWeight:700 }}>
        <Icon name="shield" size={13}/>ADMIN VIEW
      </div>
      <div style={{ display:"flex",gap:"0.4rem",flexWrap:"wrap" }}>
        <button onClick={()=>setViewingAs(null)} style={{ fontSize:"0.72rem",padding:"3px 10px",borderRadius:"6px",border:`1px solid ${!viewingAs?"#e07b39":"#2a2f3d"}`,background:!viewingAs?"#e07b3922":"#1e2430",color:!viewingAs?"#e07b39":"#6b7280",cursor:"pointer",fontWeight:!viewingAs?700:400 }}>
          My Data
        </button>
        {profiles.filter(p=>p.role!=="admin").map(p=>(
          <button key={p.id} onClick={()=>setViewingAs(p)} style={{ fontSize:"0.72rem",padding:"3px 10px",borderRadius:"6px",border:`1px solid ${viewingAs?.id===p.id?"#3b6fa0":"#2a2f3d"}`,background:viewingAs?.id===p.id?"#3b6fa022":"#1e2430",color:viewingAs?.id===p.id?"#3b6fa0":"#6b7280",cursor:"pointer",fontWeight:viewingAs?.id===p.id?700:400 }}>
            <Icon name="eye" size={10}/> {p.full_name||p.email}
          </button>
        ))}
      </div>
      {viewingAs && (
        <span style={{ fontSize:"0.72rem",color:"#b45309",marginLeft:"auto" }}>
          Viewing as <strong>{viewingAs.full_name||viewingAs.email}</strong> — read-only outside their projects
        </span>
      )}
    </div>
  );
}

// ─── Admin: Members Tab ───────────────────────────────────────────────────────
function MembersTab({ profiles, currentUser, onRoleChange }) {
  const [saving, setSaving] = useState(null);

  async function toggleRole(profile) {
    const newRole = profile.role === "admin" ? "member" : "admin";
    if (profile.id === currentUser.id) return; // can't demote self
    setSaving(profile.id);
    const { error } = await supabase.from("profiles").update({ role:newRole }).eq("id", profile.id);
    if (!error) onRoleChange(profile.id, newRole);
    setSaving(null);
  }

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.5rem" }}>
        <h2 style={{ margin:0,fontSize:"1.1rem",fontWeight:700,color:"#e8eaf0" }}>Members</h2>
        <span style={{ fontSize:"0.75rem",color:"#6b7280" }}>Invite users by sharing the app URL — they sign up themselves.</span>
      </div>

      <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",overflow:"hidden" }}>
        {profiles.map((p,i)=>(
          <div key={p.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1rem 1.25rem",borderBottom:i<profiles.length-1?"1px solid #1a1f2b":"none" }}>
            <div>
              <div style={{ fontSize:"0.9rem",fontWeight:600,color:"#e8eaf0",display:"flex",alignItems:"center",gap:"0.5rem" }}>
                {p.full_name||"—"}
                {p.id===currentUser.id && <span style={{ fontSize:"0.65rem",color:"#6b7280" }}>(you)</span>}
              </div>
              <div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{p.email}</div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:"0.75rem" }}>
              <Badge color={p.role==="admin"?"#e07b39":"#3b6fa0"} label={p.role}/>
              {p.id!==currentUser.id && (
                <button onClick={()=>toggleRole(p)} disabled={!!saving} style={{ fontSize:"0.72rem",padding:"3px 10px",borderRadius:"6px",border:"1px solid #2a2f3d",background:"#1e2430",color:"#6b7280",cursor:"pointer" }}>
                  {saving===p.id ? <Spinner/> : p.role==="admin"?"Make member":"Make admin"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop:"1.5rem",background:"#0d1117",border:"1px solid #1e2430",borderRadius:"10px",padding:"1rem 1.25rem",fontSize:"0.8rem",color:"#6b7280",lineHeight:1.6 }}>
        <strong style={{ color:"#94a3b8" }}>Permission summary</strong><br/>
        <strong style={{ color:"#e8eaf0" }}>Members</strong> — see & edit their own properties, tenants, invoices, projects. Can add vendors but not delete them.<br/>
        <strong style={{ color:"#e07b39" }}>Admin</strong> — sees and edits all data, can delete vendors, can promote/demote members.
      </div>
    </div>
  );
}

// ─── AI Invoice Parser ────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=()=>rej(new Error("Read failed")); r.readAsDataURL(file); });
}

// ─── AI Vendor Parser ─────────────────────────────────────────────────────────
async function parseVendorWithAI(file) {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) throw new Error("Only images and PDFs are supported.");
  const b64 = await fileToBase64(file);

  const prompt = `You are a vendor/contractor information extractor. Extract business contact info from this document (invoice, business card, flyer, screenshot, etc). Return ONLY valid JSON, no markdown.

Valid categories: ${CATEGORIES.join(", ")}

Return this exact JSON:
{"name":"","category":"Other","phone":"","email":"","notes":"","confidence":"medium"}

- name: business or contractor name (required)
- category: best matching category from the list
- phone: phone number if found, else ""
- email: email if found, else ""
- notes: website, address, license number, or any other useful info
- confidence: low | medium | high`;

  const body = { model:"claude-sonnet-4-5", max_tokens:500, messages:[{ role:"user", content:[{ type:isPdf?"document":"image", source:{ type:"base64", media_type:file.type, data:b64 } },{ type:"text", text:prompt }] }] };
  const edgeFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dynamic-worker`;
  const resp = await fetch(edgeFnUrl, { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`}, body:JSON.stringify(body) });
  if (!resp.ok) { const errText = await resp.text().catch(()=>""); throw new Error(`API error ${resp.status}${errText?" — "+errText:""}`); }
  const data = await resp.json();
  const text = data.content?.map(c=>c.text||"").join("")||"";
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

async function parseInvoiceWithAI(file, vendors, properties, projects) {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type==="application/pdf";
  if (!isImage&&!isPdf) throw new Error("Only images and PDFs are supported.");
  const b64 = await fileToBase64(file);
  const vendorList = vendors.map(v=>`${v.id}: ${v.name} (${v.category})`).join("\n");
  const propList = properties.map(p=>`${p.id}: ${p.name}`).join("\n");
  const projList = projects.map(p=>`${p.id}: ${p.name}`).join("\n");

  const prompt = `You are an invoice data extractor for a property management app. Return ONLY valid JSON, no markdown.

Known vendors: ${vendorList||"none"}
Known properties: ${propList||"none"}
Known projects: ${projList||"none"}
Valid categories: ${CATEGORIES.join(", ")}

Return this exact JSON:
{"vendorId":null,"vendorNameRaw":"","propertyId":null,"projectId":null,"amount":0,"date":"YYYY-MM-DD","category":"Other","description":"","invoiceNumber":null,"confidence":"medium"}`;

  const body = { model:"claude-sonnet-4-5", max_tokens:800, messages:[{ role:"user", content:[{ type:isPdf?"document":"image", source:{ type:"base64", media_type:file.type, data:b64 } },{ type:"text", text:prompt }] }] };
  const edgeFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dynamic-worker`;
  const resp = await fetch(edgeFnUrl, { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`}, body:JSON.stringify(body) });
  if (!resp.ok) { const errText = await resp.text().catch(()=>""); throw new Error(`API error ${resp.status}${errText?" — "+errText:""}`); }
  const data = await resp.json();
  const text = data.content?.map(c=>c.text||"").join("")||"";
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

function InvoiceDropZone({ vendors, properties, projects, onConfirm }) {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [form, setForm] = useState(null);
  const inputRef = useRef();
  const confidenceColor = { low:"#f87171", medium:"#fbbf24", high:"#4a7c59" };

  async function processFile(f) {
    if (!f) return;
    setFile(f); setError(null); setParsed(null); setForm(null);
    if (f.type.startsWith("image/")) setPreviewUrl(URL.createObjectURL(f)); else setPreviewUrl(null);
    setParsing(true);
    try {
      const result = await parseInvoiceWithAI(f, vendors, properties, projects);
      setParsed(result);
      setForm({ vendorId:result.vendorId||"", vendorNameRaw:result.vendorNameRaw||"", propertyId:result.propertyId||(properties[0]?.id||""), projectId:result.projectId||"", amount:result.amount!=null?String(result.amount):"", date:result.date||new Date().toISOString().slice(0,10), category:CATEGORIES.includes(result.category)?result.category:CATEGORIES[0], description:result.description||"", invoiceNumber:result.invoiceNumber||"", fileName:f.name, recurring:"one-time" });
    } catch(e) { setError(e.message||"Failed to parse invoice."); }
    finally { setParsing(false); }
  }

  function dismiss() { setParsed(null); setForm(null); setFile(null); setPreviewUrl(null); setError(null); }

  return (
    <>
      <div onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)processFile(f);}} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onClick={()=>inputRef.current?.click()}
        style={{ border:`2px dashed ${dragging?"#e07b39":"#2a2f3d"}`,borderRadius:"12px",padding:"1.25rem",textAlign:"center",cursor:"pointer",background:dragging?"#1c1407":"#0d1117",transition:"all 0.15s",marginBottom:"1.25rem" }}>
        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }} onChange={e=>{const f=e.target.files[0];if(f)processFile(f);e.target.value="";}}/>
        {parsing ? (
          <div style={{ color:"#e07b39",fontSize:"0.85rem",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.5rem" }}><Spinner/>Reading invoice with AI…</div>
        ) : (
          <div>
            <div style={{ color:"#4b5563",marginBottom:"0.25rem" }}><Icon name="upload" size={18}/></div>
            <div style={{ fontSize:"0.82rem",color:dragging?"#e07b39":"#6b7280",fontWeight:600 }}>{dragging?"Drop invoice here":"Drag & drop invoice PDF or image"}</div>
            <div style={{ fontSize:"0.7rem",color:"#4b5563",marginTop:"0.2rem" }}>or click to browse · AI extracts vendor, amount, date, category</div>
          </div>
        )}
      </div>
      {error && <div style={{ background:"#1c0808",border:"1px solid #5c1f1f",borderRadius:"8px",padding:"0.75rem 1rem",marginBottom:"1rem",fontSize:"0.82rem",color:"#f87171",display:"flex",justifyContent:"space-between",alignItems:"center" }}>{error}<button onClick={()=>setError(null)} style={{ background:"none",border:"none",color:"#f87171",cursor:"pointer",padding:0 }}><Icon name="x" size={13}/></button></div>}

      {form && (
        <div style={{ position:"fixed",inset:0,background:"rgba(10,12,18,0.85)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }}>
          <div style={{ background:"#14181f",border:"1px solid #2a2f3d",borderRadius:"14px",width:"100%",maxWidth:"660px",maxHeight:"94vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1.25rem 1.5rem",borderBottom:"1px solid #1e2430",position:"sticky",top:0,background:"#14181f",zIndex:10 }}>
              <div>
                <h3 style={{ margin:0,fontSize:"1rem",fontWeight:700,color:"#e8eaf0" }}>Review Extracted Invoice</h3>
                <div style={{ fontSize:"0.72rem",color:"#6b7280",marginTop:"2px" }}>AI confidence: <span style={{ color:confidenceColor[parsed?.confidence]||"#6b7280",fontWeight:700,textTransform:"uppercase" }}>{parsed?.confidence||"—"}</span>{parsed?.invoiceNumber&&<span style={{ marginLeft:"0.75rem",color:"#4b5563" }}>#{parsed.invoiceNumber}</span>}</div>
              </div>
              <button onClick={dismiss} style={{ background:"none",border:"none",color:"#6b7280",cursor:"pointer",padding:"4px",display:"flex" }}><Icon name="x" size={18}/></button>
            </div>
            <div style={{ padding:"1.5rem" }}>
              {previewUrl && <div style={{ marginBottom:"1rem",borderRadius:"8px",overflow:"hidden",border:"1px solid #2a2f3d",maxHeight:"140px",display:"flex",alignItems:"center",justifyContent:"center",background:"#0d1117" }}><img src={previewUrl} alt="" style={{ maxHeight:"140px",maxWidth:"100%",objectFit:"contain" }}/></div>}
              {!previewUrl&&file && <div style={{ marginBottom:"1rem",background:"#0d1117",border:"1px solid #2a2f3d",borderRadius:"8px",padding:"0.6rem 1rem",display:"flex",alignItems:"center",gap:"0.5rem",fontSize:"0.78rem",color:"#6b7280" }}><Icon name="file" size={13}/>{file.name}</div>}

              <SectionDivider label="Vendor"/>
              {form.vendorNameRaw && <div style={{ fontSize:"0.78rem",color:"#94a3b8",marginBottom:"0.5rem",padding:"0.4rem 0.75rem",background:"#0d1117",borderRadius:"6px",border:"1px solid #1e2430" }}>Found on invoice: <strong style={{ color:"#e8eaf0" }}>{form.vendorNameRaw}</strong></div>}
              <Field label="Match to Existing Vendor">
                <select style={inputStyle} value={form.vendorId} onChange={e=>setForm(f=>({...f,vendorId:e.target.value}))}>
                  <option value="">— No match —</option>
                  {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>

              <SectionDivider label="Invoice Details"/>
              <Grid2>
                <Field label="Amount ($)"><input style={inputStyle} type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/></Field>
                <Field label="Date"><input style={inputStyle} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></Field>
              </Grid2>
              <Field label="Category"><select style={inputStyle} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field>
              <Field label="Description"><input style={inputStyle} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Brief description"/></Field>

              <SectionDivider label="Billing Type"/>
              <div style={{ display:"flex",gap:"0.5rem",flexWrap:"wrap",marginBottom:"1rem" }}>
                {RECURRING_OPTIONS.map(r=>(
                  <button key={r.value} onClick={()=>setForm(f=>({...f,recurring:r.value}))}
                    style={{ flex:1,padding:"0.45rem 0.5rem",borderRadius:"7px",border:`1px solid ${form.recurring===r.value?r.color:"#2a2f3d"}`,background:form.recurring===r.value?r.color+"22":"#0d1117",color:form.recurring===r.value?r.color:"#6b7280",cursor:"pointer",fontSize:"0.78rem",fontWeight:form.recurring===r.value?700:400,textAlign:"center",whiteSpace:"nowrap" }}>
                    {r.value!=="one-time"&&"↻ "}{r.label}
                  </button>
                ))}
              </div>

              <SectionDivider label="Assignment"/>
              <Grid2>
                <Field label="Property">
                  <select style={inputStyle} value={form.propertyId} onChange={e=>setForm(f=>({...f,propertyId:e.target.value}))}>
                    <option value="">Select…</option>
                    {properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Project (optional)">
                  <select style={inputStyle} value={form.projectId} onChange={e=>setForm(f=>({...f,projectId:e.target.value}))}>
                    <option value="">— None —</option>
                    {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              </Grid2>

              <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end",marginTop:"0.5rem" }}>
                <BtnSecondary onClick={dismiss}>Discard</BtnSecondary>
                <BtnPrimary onClick={async()=>{
                  let finalForm = {...form};
                  if (file) {
                    try {
                      const uploaded = await uploadFile(file, "invoices");
                      finalForm.fileName = uploaded.name;
                      finalForm.fileUrl = uploaded.url;
                      finalForm.filePath = uploaded.path;
                    } catch(e) { console.error("Upload failed", e); }
                  }
                  onConfirm(finalForm); dismiss();
                }}><Icon name="check" size={13}/>Save Invoice</BtnPrimary>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Chart Components ─────────────────────────────────────────────────────────

// Horizontal bar chart — shows multiple items ranked by value
function HBarChart({ data, colorKey="color", valueKey="value", labelKey="label", height=220, formatVal=fmt }) {
  if (!data||data.length===0) return <div style={{ color:"#4b5563",fontSize:"0.85rem",padding:"1rem 0" }}>No data yet.</div>;
  const max = Math.max(...data.map(d=>d[valueKey]||0), 1);
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"10px",paddingTop:"4px" }}>
      {data.map((d,i)=>(
        <div key={i}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:"4px" }}>
            <span style={{ fontSize:"0.78rem",color:"#cbd5e1",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"65%" }}>{d[labelKey]}</span>
            <span style={{ fontSize:"0.78rem",color:"#e8eaf0",fontFamily:"'DM Mono',monospace",fontWeight:600,flexShrink:0 }}>{formatVal(d[valueKey]||0)}</span>
          </div>
          <div style={{ height:"8px",background:"#1e2430",borderRadius:"99px",overflow:"hidden" }}>
            <div style={{ height:"100%",width:`${Math.max(2,(d[valueKey]||0)/max*100)}%`,background:d[colorKey]||"#e07b39",borderRadius:"99px",transition:"width 0.6s ease" }}/>
          </div>
        </div>
      ))}
    </div>
  );
}

// Grouped bar chart — income vs expense per property
function GroupedBarChart({ data, height=180 }) {
  if (!data||data.length===0) return <div style={{ color:"#4b5563",fontSize:"0.85rem",padding:"1rem 0" }}>No data yet.</div>;
  const max = Math.max(...data.flatMap(d=>[d.income||0,d.expense||0]),1);
  const barW = Math.max(18, Math.min(40, Math.floor(340/data.length/2)-4));
  const gap = barW*0.5;
  const totalW = data.length*(barW*2+gap)+(data.length-1)*16;
  const chartH = height-40;
  return (
    <div style={{ overflowX:"auto" }}>
      <svg width={Math.max(totalW+32,300)} height={height} style={{ display:"block" }}>
        {/* Grid lines */}
        {[0,0.25,0.5,0.75,1].map(pct=>(
          <line key={pct} x1={16} x2={Math.max(totalW+32,300)-8} y1={8+chartH*(1-pct)} y2={8+chartH*(1-pct)} stroke="#1e2430" strokeWidth="1"/>
        ))}
        {data.map((d,i)=>{
          const x = 16+i*(barW*2+gap+16);
          const ih = Math.max(2,((d.income||0)/max)*chartH);
          const eh = Math.max(2,((d.expense||0)/max)*chartH);
          return (
            <g key={i}>
              {/* Income bar */}
              <rect x={x} y={8+chartH-ih} width={barW} height={ih} fill="#4a7c59" rx="3" opacity="0.85"/>
              {/* Expense bar */}
              <rect x={x+barW+3} y={8+chartH-eh} width={barW} height={eh} fill="#e07b39" rx="3" opacity="0.85"/>
              {/* Label */}
              <text x={x+barW} y={height-4} textAnchor="middle" fontSize="9" fill="#6b7280" fontFamily="DM Sans,sans-serif">
                {d.name?.split(" ")[0]||""}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display:"flex",gap:"1rem",marginTop:"4px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:"5px",fontSize:"0.72rem",color:"#6b7280" }}><span style={{ width:"10px",height:"10px",borderRadius:"2px",background:"#4a7c59",display:"inline-block" }}/>Income</div>
        <div style={{ display:"flex",alignItems:"center",gap:"5px",fontSize:"0.72rem",color:"#6b7280" }}><span style={{ width:"10px",height:"10px",borderRadius:"2px",background:"#e07b39",display:"inline-block" }}/>Expenses</div>
      </div>
    </div>
  );
}

// Donut chart
function DonutChart({ data, size=160, thickness=28 }) {
  if (!data||data.length===0) return <div style={{ color:"#4b5563",fontSize:"0.85rem",padding:"1rem 0" }}>No data yet.</div>;
  const total = data.reduce((s,d)=>s+(d.value||0),0);
  if (total===0) return <div style={{ color:"#4b5563",fontSize:"0.85rem",padding:"1rem 0" }}>No data yet.</div>;
  const r = (size/2)-thickness/2-2;
  const cx = size/2; const cy = size/2;
  const circ = 2*Math.PI*r;
  let offset = 0;
  const slices = data.map(d=>{
    const pct = (d.value||0)/total;
    const dash = pct*circ;
    const slice = { ...d, dash, offset, pct };
    offset += dash;
    return slice;
  });
  return (
    <div style={{ display:"flex",alignItems:"center",gap:"1.25rem",flexWrap:"wrap" }}>
      <svg width={size} height={size} style={{ flexShrink:0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2430" strokeWidth={thickness}/>
        {slices.map((s,i)=>(
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color||"#6b7280"} strokeWidth={thickness}
            strokeDasharray={`${s.dash} ${circ-s.dash}`} strokeDashoffset={-s.offset+circ*0.25}
            style={{ transform:"rotate(-90deg)",transformOrigin:`${cx}px ${cy}px` }} opacity="0.9"/>
        ))}
        <text x={cx} y={cy-6} textAnchor="middle" fontSize="13" fontWeight="700" fill="#e8eaf0" fontFamily="DM Mono,monospace">{fmt(total)}</text>
        <text x={cx} y={cy+10} textAnchor="middle" fontSize="9" fill="#6b7280" fontFamily="DM Sans,sans-serif">TOTAL</text>
      </svg>
      <div style={{ display:"flex",flexDirection:"column",gap:"6px",flex:1,minWidth:0 }}>
        {slices.map((s,i)=>(
          <div key={i} style={{ display:"flex",alignItems:"center",gap:"6px" }}>
            <span style={{ width:"8px",height:"8px",borderRadius:"50%",background:s.color||"#6b7280",flexShrink:0 }}/>
            <span style={{ fontSize:"0.75rem",color:"#94a3b8",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{s.label}</span>
            <span style={{ fontSize:"0.75rem",color:"#e8eaf0",fontFamily:"'DM Mono',monospace",fontWeight:600,flexShrink:0 }}>{Math.round(s.pct*100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Sparkline / area chart — monthly trend, supports optional second line
function SparkLine({ invoices, tenants, months=12, color="#e07b39", height=80 }) {
  const now = new Date();
  const buckets = Array.from({length:months},(_,i)=>{
    const d = new Date(now.getFullYear(),now.getMonth()-months+1+i,1);
    return { label:`${d.toLocaleString("default",{month:"short"})} ${d.getFullYear().toString().slice(2)}`, year:d.getFullYear(), month:d.getMonth(), expense:0, income:0 };
  });

  // Expenses — from invoices by date
  (invoices||[]).forEach(inv=>{
    const d = new Date(inv.date);
    const b = buckets.find(b=>b.year===d.getFullYear()&&b.month===d.getMonth());
    if (b) b.expense += Number(inv.amount)||0;
  });

  // Income — spread each active lease's monthly rent across the months it covers
  if (tenants) {
    tenants.forEach(t=>{
      if (!t.monthlyRent||!t.leaseStart||!t.leaseEnd) return;
      const start = new Date(t.leaseStart);
      const end = new Date(t.leaseEnd);
      buckets.forEach(b=>{
        const bDate = new Date(b.year, b.month, 1);
        const bEnd  = new Date(b.year, b.month+1, 0);
        if (bDate <= end && bEnd >= start) b.income += Number(t.monthlyRent)||0;
      });
    });
  }

  const showIncome = !!tenants;
  const max = Math.max(...buckets.flatMap(b=>showIncome?[b.expense,b.income]:[b.expense]),1);
  const w = 600; const h = height;

  function pts(key) {
    return buckets.map((b,i)=>({ x:i/(months-1)*(w-32)+16, y:h-16-((b[key]||0)/max*(h-28)) }));
  }
  function pathStr(points) { return points.map((p,i)=>i===0?`M${p.x},${p.y}`:`L${p.x},${p.y}`).join(" "); }
  function areaStr(points) { return `${pathStr(points)} L${points[points.length-1].x},${h-16} L${points[0].x},${h-16} Z`; }

  const expPts = pts("expense");
  const incPts = showIncome ? pts("income") : [];

  return (
    <div>
      <div style={{ overflowX:"auto" }}>
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display:"block" }}>
          <defs>
            <linearGradient id="grad-exp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e07b39" stopOpacity="0.25"/>
              <stop offset="100%" stopColor="#e07b39" stopOpacity="0.02"/>
            </linearGradient>
            <linearGradient id="grad-inc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a7c59" stopOpacity="0.25"/>
              <stop offset="100%" stopColor="#4a7c59" stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          {/* Grid lines */}
          {[0.25,0.5,0.75,1].map(pct=>(
            <line key={pct} x1={16} x2={w-16} y1={h-16-(pct*(h-28))} y2={h-16-(pct*(h-28))} stroke="#1e2430" strokeWidth="1"/>
          ))}
          {/* Expense area + line — only if invoices provided */}
          {(invoices||[]).some(i=>i.amount>0) && <>
            <path d={areaStr(expPts)} fill="url(#grad-exp)"/>
            <path d={pathStr(expPts)} fill="none" stroke="#e07b39" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
            {expPts.map((p,i)=>(
              <circle key={i} cx={p.x} cy={p.y} r="3" fill="#e07b39" opacity={buckets[i].expense>0?0.9:0}/>
            ))}
          </>}
          {/* Income area + line */}
          {showIncome && <>
            <path d={areaStr(incPts)} fill="url(#grad-inc)"/>
            <path d={pathStr(incPts)} fill="none" stroke="#4a7c59" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
            {incPts.map((p,i)=>(
              <circle key={i} cx={p.x} cy={p.y} r="3" fill="#4a7c59" opacity={buckets[i].income>0?0.9:0}/>
            ))}
          </>}
          {/* X labels */}
          {buckets.map((b,i)=>i%2===0&&(
            <text key={i} x={expPts[i].x} y={h-1} textAnchor="middle" fontSize="8" fill="#4b5563" fontFamily="DM Sans,sans-serif">{b.label}</text>
          ))}
        </svg>
      </div>
      <div style={{ display:"flex",gap:"1rem",marginTop:"6px" }}>
        {(invoices||[]).some(i=>i.amount>0) && <div style={{ display:"flex",alignItems:"center",gap:"5px",fontSize:"0.72rem",color:"#6b7280" }}><span style={{ width:"10px",height:"2px",background:"#e07b39",display:"inline-block",borderRadius:"99px" }}/>Expenses</div>}
        {showIncome && <div style={{ display:"flex",alignItems:"center",gap:"5px",fontSize:"0.72rem",color:"#6b7280" }}><span style={{ width:"10px",height:"2px",background:"#4a7c59",display:"inline-block",borderRadius:"99px" }}/>Income</div>}
      </div>
    </div>
  );
}

// Chart card wrapper
function ChartCard({ title, children, style }) {
  return (
    <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",padding:"1.25rem",...style }}>
      <div style={{ fontSize:"0.7rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"1rem" }}>{title}</div>
      {children}
    </div>
  );
}
function Dashboard({ properties, invoices, vendors, tenants, projects, isAdmin, viewingAs }) {
  const grandExpense = invoices.reduce((s,i)=>s+Number(i.amount),0);
  const activeTenants = tenants.filter(t=>leaseStatus(t.leaseStart,t.leaseEnd)==="active");
  const totalRentIncome = activeTenants.reduce((s,t)=>s+leaseTotalRent(t),0);
  const expiringCount = tenants.filter(t=>leaseStatus(t.leaseStart,t.leaseEnd)==="expiring").length;
  const activeProjects = projects.filter(p=>p.status==="In Progress").length;
  const netIncome = totalRentIncome - grandExpense;

  const propTotals = properties.map(p=>({
    ...p,
    expense: invoices.filter(i=>i.propertyId===p.id).reduce((s,i)=>s+Number(i.amount),0),
    income: tenants.filter(t=>t.propertyId===p.id&&leaseStatus(t.leaseStart,t.leaseEnd)==="active").reduce((s,t)=>s+leaseTotalRent(t),0),
  }));

  const CHART_COLORS = ["#e07b39","#3b6fa0","#4a7c59","#8b5cf6","#0891b2","#d946a8","#b45309","#e11d48","#34d399","#f87171","#60a5fa","#a78bfa","#fbbf24","#6b7280","#94a3b8"];
  const byCategory = CATEGORIES.map((cat,i)=>({
    label:cat, value:invoices.filter(inv=>inv.category===cat).reduce((s,i)=>s+Number(i.amount),0), color:CHART_COLORS[i%CHART_COLORS.length],
  })).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);

  const recent = [...invoices].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  const topVendors = vendors.map(v=>({ label:v.name, value:invoices.filter(i=>i.vendorId===v.id).reduce((s,i)=>s+Number(i.amount),0), color:"#e07b39" })).filter(v=>v.value>0).sort((a,b)=>b.value-a.value).slice(0,6);

  return (
    <div>
      {viewingAs && (
        <div style={{ background:"#0d1520",border:"1px solid #1e3a5f",borderRadius:"10px",padding:"0.75rem 1.25rem",marginBottom:"1.25rem",fontSize:"0.82rem",color:"#3b6fa0",display:"flex",alignItems:"center",gap:"0.5rem" }}>
          <Icon name="eye" size={13}/>Viewing dashboard for <strong>{viewingAs.full_name||viewingAs.email}</strong>
        </div>
      )}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(148px,1fr))",gap:"1rem",marginBottom:"1.5rem" }}>
        {[
          { label:"Total Expenses", value:fmt(grandExpense), accent:"#e07b39" },
          { label:"Rent Income", value:fmt(totalRentIncome), accent:"#4a7c59" },
          { label:"Net Income", value:fmt(netIncome), accent:netIncome>=0?"#4a7c59":"#f87171" },
          { label:"Active Tenants", value:activeTenants.length, accent:"#3b6fa0" },
          { label:"Properties", value:properties.length, accent:"#8b5cf6" },
          { label:"Active Projects", value:activeProjects, accent:"#b45309" },
        ].map(k=>(
          <div key={k.label} style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",padding:"1rem 1.15rem",borderTop:`3px solid ${k.accent}` }}>
            <div style={{ fontSize:"0.68rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"0.4rem" }}>{k.label}</div>
            <div style={{ fontSize:"1.5rem",fontWeight:700,color:"#e8eaf0",fontFamily:"'DM Mono',monospace" }}>{k.value}</div>
          </div>
        ))}
      </div>

      <ChartCard title="Monthly Spend vs. Income — Last 12 Months" style={{ marginBottom:"1.25rem" }}>
        <SparkLine invoices={invoices} tenants={tenants} months={12} height={100}/>
      </ChartCard>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem",marginBottom:"1.25rem" }}>
        <ChartCard title="Income vs. Expenses by Property">
          <GroupedBarChart data={propTotals} height={180}/>
          {propTotals.map(p=>(
            <div key={p.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.3rem 0",borderBottom:"1px solid #1a1f2b" }}>
              <span style={{ display:"flex",alignItems:"center",gap:"6px",fontSize:"0.78rem",color:"#94a3b8" }}><span style={{ width:"6px",height:"6px",borderRadius:"50%",background:p.color,display:"inline-block" }}/>{p.name}</span>
              <span style={{ fontSize:"0.78rem",fontFamily:"'DM Mono',monospace",fontWeight:600,color:p.income-p.expense>=0?"#4a7c59":"#f87171" }}>net {fmt(p.income-p.expense)}</span>
            </div>
          ))}
        </ChartCard>
        <ChartCard title="Expenses by Category">
          <DonutChart data={byCategory.slice(0,8)} size={140} thickness={24}/>
        </ChartCard>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem",marginBottom:"1.25rem" }}>
        <ChartCard title="Top Vendors by Spend">
          <HBarChart data={topVendors} colorKey="color" valueKey="value" labelKey="label"/>
        </ChartCard>
        <ChartCard title="Recent Invoices">
          {recent.length===0 && <div style={{ color:"#4b5563",fontSize:"0.85rem" }}>No invoices yet.</div>}
          {recent.map(inv=>{
            const prop = properties.find(p=>p.id===inv.propertyId);
            const vend = vendors.find(v=>v.id===inv.vendorId);
            return (
              <div key={inv.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0.6rem 0",borderBottom:"1px solid #1a1f2b" }}>
                <div style={{ display:"flex",alignItems:"center",gap:"0.75rem" }}>
                  <div style={{ width:"6px",height:"6px",borderRadius:"50%",background:prop?.color||"#6b7280",flexShrink:0 }}/>
                  <div>
                    <div style={{ fontSize:"0.82rem",color:"#cbd5e1" }}>{vend?.name||"—"}</div>
                    <div style={{ fontSize:"0.7rem",color:"#6b7280" }}>{prop?.name} · {inv.date}</div>
                  </div>
                </div>
                <span style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.88rem",fontWeight:600,color:"#e8eaf0" }}>{fmt(inv.amount)}</span>
              </div>
            );
          })}
        </ChartCard>
      </div>

      {expiringCount>0 && (
        <div style={{ background:"#1c1407",border:"1px solid #78350f",borderRadius:"10px",padding:"0.9rem 1.25rem",display:"flex",alignItems:"center",gap:"0.75rem" }}>
          <Icon name="calendar" size={16}/><span style={{ fontSize:"0.85rem",color:"#fbbf24" }}><strong>{expiringCount} lease{expiringCount>1?"s":""}</strong> expiring within 60 days.</span>
        </div>
      )}
    </div>
  );
}

// ─── AI Property Parser ───────────────────────────────────────────────────────
async function parsePropertyWithAI(file) {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) throw new Error("Only images and PDFs are supported.");
  const b64 = await fileToBase64(file);

  const prompt = `You are a real estate property information extractor. Extract address info from this document (listing, lease, deed, screenshot, photo of a property, etc). Return ONLY valid JSON, no markdown.

Valid US state codes: ${US_STATES.join(", ")}

Return this exact JSON:
{"name":"","address":"","city":"","state":"FL","confidence":"medium"}

- name: a short memorable name for this property (e.g. "Terracina", "Belle View", "Unit 4B Naples") — derive from street name, neighborhood, or complex name
- address: street address only (no city/state)
- city: city name
- state: 2-letter state code
- confidence: low | medium | high`;

  const body = { model:"claude-sonnet-4-5", max_tokens:400, messages:[{ role:"user", content:[{ type:isPdf?"document":"image", source:{ type:"base64", media_type:file.type, data:b64 } },{ type:"text", text:prompt }] }] };
  const edgeFnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dynamic-worker`;
  const resp = await fetch(edgeFnUrl, { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`}, body:JSON.stringify(body) });
  if (!resp.ok) { const errText = await resp.text().catch(()=>""); throw new Error(`API error ${resp.status}${errText?" — "+errText:""}`); }
  const data = await resp.json();
  const text = data.content?.map(c=>c.text||"").join("")||"";
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

// ─── Property Drop Zone ───────────────────────────────────────────────────────
function PropertyDropZone({ onConfirm }) {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [form, setForm] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const inputRef = useRef();
  const confidenceColor = { low:"#f87171", medium:"#fbbf24", high:"#4a7c59" };

  async function processFile(f) {
    if (!f) return;
    setError(null); setParsed(null); setForm(null);
    if (f.type.startsWith("image/")) setPreviewUrl(URL.createObjectURL(f)); else setPreviewUrl(null);
    setParsing(true);
    try {
      const result = await parsePropertyWithAI(f);
      setParsed(result);
      setForm({
        name: result.name||"",
        address: result.address||"",
        city: result.city||"",
        state: US_STATES.includes(result.state) ? result.state : "FL",
        color: PROPERTY_COLORS[0],
      });
    } catch(e) { setError(e.message||"Failed to parse property info."); }
    finally { setParsing(false); }
  }

  function dismiss() { setParsed(null); setForm(null); setPreviewUrl(null); setError(null); }

  return (
    <>
      <div onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)processFile(f);}}
        onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
        onClick={()=>inputRef.current?.click()}
        style={{ border:`2px dashed ${dragging?"#e07b39":"#2a2f3d"}`,borderRadius:"12px",padding:"1.25rem",textAlign:"center",cursor:"pointer",background:dragging?"#1c1407":"#0d1117",transition:"all 0.15s",marginBottom:"1.25rem" }}>
        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }}
          onChange={e=>{const f=e.target.files[0];if(f)processFile(f);e.target.value="";}}/>
        {parsing ? (
          <div style={{ color:"#e07b39",fontSize:"0.85rem",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.5rem" }}><Spinner/>Reading property info with AI…</div>
        ) : (
          <div>
            <div style={{ color:"#4b5563",marginBottom:"0.25rem" }}><Icon name="home" size={18}/></div>
            <div style={{ fontSize:"0.82rem",color:dragging?"#e07b39":"#6b7280",fontWeight:600 }}>{dragging?"Drop file here":"Drag & drop a listing, lease, deed, or screenshot"}</div>
            <div style={{ fontSize:"0.7rem",color:"#4b5563",marginTop:"0.2rem" }}>or click to browse · AI extracts property name, address, city, state</div>
          </div>
        )}
      </div>
      {error && <div style={{ background:"#1c0808",border:"1px solid #5c1f1f",borderRadius:"8px",padding:"0.75rem 1rem",marginBottom:"1rem",fontSize:"0.82rem",color:"#f87171",display:"flex",justifyContent:"space-between",alignItems:"center" }}>{error}<button onClick={()=>setError(null)} style={{ background:"none",border:"none",color:"#f87171",cursor:"pointer",padding:0 }}><Icon name="x" size={13}/></button></div>}

      {form && (
        <div style={{ position:"fixed",inset:0,background:"rgba(10,12,18,0.85)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }}>
          <div style={{ background:"#14181f",border:"1px solid #2a2f3d",borderRadius:"14px",width:"100%",maxWidth:"520px",maxHeight:"94vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1.25rem 1.5rem",borderBottom:"1px solid #1e2430",position:"sticky",top:0,background:"#14181f",zIndex:10 }}>
              <div>
                <h3 style={{ margin:0,fontSize:"1rem",fontWeight:700,color:"#e8eaf0" }}>Review Extracted Property</h3>
                <div style={{ fontSize:"0.72rem",color:"#6b7280",marginTop:"2px" }}>AI confidence: <span style={{ color:confidenceColor[parsed?.confidence]||"#6b7280",fontWeight:700,textTransform:"uppercase" }}>{parsed?.confidence||"—"}</span></div>
              </div>
              <button onClick={dismiss} style={{ background:"none",border:"none",color:"#6b7280",cursor:"pointer",padding:"4px",display:"flex" }}><Icon name="x" size={18}/></button>
            </div>
            <div style={{ padding:"1.5rem" }}>
              {previewUrl && <div style={{ marginBottom:"1rem",borderRadius:"8px",overflow:"hidden",border:"1px solid #2a2f3d",maxHeight:"140px",display:"flex",alignItems:"center",justifyContent:"center",background:"#0d1117" }}><img src={previewUrl} alt="" style={{ maxHeight:"140px",maxWidth:"100%",objectFit:"contain" }}/></div>}
              <Field label="Property Name">
                <input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Terracina"/>
              </Field>
              <Field label="Street Address">
                <input style={inputStyle} value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="123 Main St"/>
              </Field>
              <Grid2>
                <Field label="City"><input style={inputStyle} value={form.city} onChange={e=>setForm(f=>({...f,city:e.target.value}))} placeholder="City"/></Field>
                <Field label="State"><select style={inputStyle} value={form.state} onChange={e=>setForm(f=>({...f,state:e.target.value}))}>{US_STATES.map(s=><option key={s}>{s}</option>)}</select></Field>
              </Grid2>
              <Field label="Color Tag">
                <div style={{ display:"flex",gap:"0.5rem",flexWrap:"wrap" }}>
                  {PROPERTY_COLORS.map(c=><div key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{ width:"28px",height:"28px",borderRadius:"50%",background:c,cursor:"pointer",border:form.color===c?"3px solid #fff":"3px solid transparent" }}/>)}
                </div>
              </Field>
              <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end",marginTop:"0.5rem" }}>
                <BtnSecondary onClick={dismiss}>Discard</BtnSecondary>
                <BtnPrimary onClick={()=>{ if(form.name.trim()) { onConfirm(form); dismiss(); } }}><Icon name="check" size={13}/>Save Property</BtnPrimary>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Property Detail View ─────────────────────────────────────────────────────
function PropertyDetail({ property, invoices, tenants, projects, vendors, isAdmin, onUpdate, onDelete, onBack }) {
  const [editModal, setEditModal] = useState(false);
  const [form, setForm] = useState({...property});
  const [activeSection, setActiveSection] = useState("overview");

  const propInvoices = invoices.filter(i=>i.propertyId===property.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const propProjects = projects.filter(p=>p.propertyId===property.id);
  const propTenants = tenants.filter(t=>t.propertyId===property.id);
  const totalSpent = propInvoices.reduce((s,i)=>s+Number(i.amount),0);
  const leaseIncome = propTenants.filter(t=>leaseStatus(t.leaseStart,t.leaseEnd)==="active").reduce((s,t)=>s+leaseTotalRent(t),0);

  // Unique vendors used for this property
  const vendorIds = [...new Set(propInvoices.filter(i=>i.vendorId).map(i=>i.vendorId))];
  const propVendors = vendorIds.map(id=>vendors.find(v=>v.id===id)).filter(Boolean);

  async function handleSave() {
    if (!form.name.trim()) return;
    await onUpdate({...form,id:property.id});
    setEditModal(false);
  }
  async function handleDelete() {
    if (!confirm("Delete this property?")) return;
    await onDelete(property.id);
    onBack();
  }

  const sections = [
    { id:"overview", label:"Overview" },
    { id:"invoices", label:`Invoices (${propInvoices.length})` },
    { id:"projects", label:`Projects (${propProjects.length})` },
    { id:"vendors", label:`Vendors (${propVendors.length})` },
  ];

  return (
    <div>
      <button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:"6px",background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:"0.83rem",marginBottom:"1.25rem",padding:0 }}>
        <Icon name="arrowLeft" size={14}/>Back to Properties
      </button>

      {/* Header */}
      <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"14px",padding:"1.5rem",marginBottom:"1.25rem",borderTop:`3px solid ${property.color}` }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"0.75rem",marginBottom:"1rem" }}>
          <div>
            <h2 style={{ margin:"0 0 0.2rem",fontSize:"1.2rem",fontWeight:700,color:"#e8eaf0" }}>{property.name}</h2>
            <div style={{ fontSize:"0.82rem",color:"#6b7280" }}>{property.address && `${property.address}, `}{property.city}, {property.state}</div>
          </div>
          <BtnSecondary onClick={()=>{ setForm({...property}); setEditModal(true); }}><Icon name="wrench" size={13}/>Edit</BtnSecondary>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:"0.75rem" }}>
          {[
            {l:"Total Expenses",v:fmt(totalSpent),c:"#e07b39"},
            {l:"Lease Income",v:fmt(leaseIncome),c:"#4a7c59"},
            {l:"Net",v:fmt(leaseIncome-totalSpent),c:leaseIncome-totalSpent>=0?"#4a7c59":"#e07b39"},
            {l:"Tenants",v:propTenants.length,c:"#3b6fa0"},
            {l:"Projects",v:propProjects.length,c:"#8b5cf6"},
          ].map(x=>(
            <div key={x.l}><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:"2px" }}>{x.l}</div><div style={{ fontSize:"1rem",fontWeight:700,color:x.c,fontFamily:"'DM Mono',monospace" }}>{x.v}</div></div>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display:"flex",gap:"0.25rem",marginBottom:"1.25rem",background:"#0d1117",borderRadius:"10px",padding:"4px",border:"1px solid #1e2430" }}>
        {sections.map(s=>(
          <button key={s.id} onClick={()=>setActiveSection(s.id)} style={{ flex:1,padding:"0.45rem 0.5rem",borderRadius:"7px",border:"none",background:activeSection===s.id?"#14181f":"transparent",color:activeSection===s.id?"#e8eaf0":"#6b7280",cursor:"pointer",fontSize:"0.78rem",fontWeight:activeSection===s.id?600:400,textAlign:"center" }}>{s.label}</button>
        ))}
      </div>

      {/* Overview — tenants */}
      {activeSection==="overview" && (
        <div>
          {/* Spend vs Income trend */}
          <ChartCard title="Monthly Expenses vs. Income — Last 12 Months" style={{ marginBottom:"1.25rem" }}>
            <SparkLine invoices={propInvoices} tenants={propTenants} months={12} height={100}/>
          </ChartCard>
          <div style={{ fontSize:"0.72rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"0.75rem" }}>Tenants</div>
          {propTenants.length===0 ? (
            <div style={{ background:"#14181f",border:"1px dashed #2a2f3d",borderRadius:"10px",padding:"2rem",textAlign:"center",color:"#4b5563",fontSize:"0.85rem" }}>No tenants at this property.</div>
          ) : (
            <div style={{ display:"flex",flexDirection:"column",gap:"0.6rem" }}>
              {propTenants.map(t=>{
                const status = leaseStatus(t.leaseStart,t.leaseEnd);
                return (
                  <div key={t.id} style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"10px",padding:"1rem 1.25rem",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"0.5rem" }}>
                    <div>
                      <div style={{ fontWeight:600,color:"#e8eaf0",fontSize:"0.9rem",display:"flex",alignItems:"center",gap:"0.5rem" }}>{t.name}{t.unit&&<span style={{ fontSize:"0.72rem",color:"#6b7280" }}>Unit {t.unit}</span>}</div>
                      {t.leaseStart&&t.leaseEnd&&<div style={{ fontSize:"0.72rem",color:"#6b7280",marginTop:"2px" }}>{t.leaseStart} → {t.leaseEnd}</div>}
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:"0.75rem" }}>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase" }}>Monthly Rent</div>
                        <div style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.95rem",fontWeight:700,color:"#4a7c59" }}>{fmt(t.monthlyRent)}</div>
                      </div>
                      <Badge color={leaseColor(status)} label={leaseLabel(status)}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Expenses by category */}
          {propInvoices.length>0 && (
            <div style={{ marginTop:"1.5rem" }}>
              <div style={{ fontSize:"0.72rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"0.75rem" }}>Expenses by Category</div>
              <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"10px",overflow:"hidden" }}>
                {CATEGORIES.map(cat=>{ const total=propInvoices.filter(i=>i.category===cat).reduce((s,i)=>s+Number(i.amount),0); if(!total) return null; return (
                  <div key={cat} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.6rem 1.25rem",borderBottom:"1px solid #1a1f2b" }}>
                    <span style={{ fontSize:"0.82rem",color:"#94a3b8" }}>{cat}</span>
                    <span style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.85rem",fontWeight:600,color:"#e8eaf0" }}>{fmt(total)}</span>
                  </div>
                ); })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Invoices */}
      {activeSection==="invoices" && (
        <div>
          {propInvoices.length===0 ? (
            <div style={{ background:"#14181f",border:"1px dashed #2a2f3d",borderRadius:"10px",padding:"2.5rem",textAlign:"center",color:"#4b5563",fontSize:"0.85rem" }}>No invoices for this property yet.</div>
          ) : (
            <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",overflow:"hidden" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.75rem 1.25rem",borderBottom:"1px solid #1e2430",background:"#0d1117" }}>
                <span style={{ fontSize:"0.75rem",color:"#6b7280",fontWeight:600,textTransform:"uppercase" }}>{propInvoices.length} records</span>
                <span style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.9rem",fontWeight:700,color:"#e07b39" }}>{fmt(totalSpent)}</span>
              </div>
              {propInvoices.map((inv,idx)=>{
                const vend = vendors.find(v=>v.id===inv.vendorId);
                const proj = projects.find(p=>p.id===inv.projectId);
                const rec = RECURRING_OPTIONS.find(r=>r.value===inv.recurring)||RECURRING_OPTIONS[0];
                return (
                  <div key={inv.id} style={{ display:"flex",alignItems:"center",padding:"0.85rem 1.25rem",borderBottom:idx<propInvoices.length-1?"1px solid #1a1f2b":"none" }}>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.2rem",flexWrap:"wrap" }}>
                        <span style={{ fontSize:"0.88rem",fontWeight:600,color:"#e8eaf0" }}>{vend?.name||"Unknown Vendor"}</span>
                        {inv.invoiceNumber&&<span style={{ fontSize:"0.72rem",color:"#6b7280",fontFamily:"'DM Mono',monospace" }}>#{inv.invoiceNumber}</span>}
                        <span style={{ fontSize:"0.68rem",background:"#1e2430",color:"#6b7280",borderRadius:"4px",padding:"1px 6px" }}>{inv.category}</span>
                        {inv.recurring&&inv.recurring!=="one-time"&&<span style={{ fontSize:"0.65rem",fontWeight:700,textTransform:"uppercase",color:rec.color,background:rec.color+"22",border:`1px solid ${rec.color}44`,borderRadius:"99px",padding:"1px 7px" }}>↻ {rec.label}</span>}
                        {proj&&<span style={{ fontSize:"0.68rem",background:"#3b6fa022",color:"#3b6fa0",border:"1px solid #3b6fa044",borderRadius:"4px",padding:"1px 6px" }}>{proj.name}</span>}
                        {inv.fileUrl&&<a href={inv.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:"0.68rem",color:"#3b6fa0",display:"flex",alignItems:"center",gap:"2px",textDecoration:"none" }}><Icon name="file" size={10}/>View</a>}
                      </div>
                      <div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{inv.date}{inv.description?" · "+inv.description:""}</div>
                    </div>
                    <div style={{ fontFamily:"'DM Mono',monospace",fontSize:"1rem",fontWeight:700,color:"#e8eaf0",marginLeft:"1rem" }}>{fmt(inv.amount)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Projects */}
      {activeSection==="projects" && (
        <div>
          {propProjects.length===0 ? (
            <div style={{ background:"#14181f",border:"1px dashed #2a2f3d",borderRadius:"10px",padding:"2.5rem",textAlign:"center",color:"#4b5563",fontSize:"0.85rem" }}>No projects for this property yet.</div>
          ) : (
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:"1rem" }}>
              {propProjects.map(p=>{
                const tasks = p.tasks||[]; const done=tasks.filter(t=>t.status==="done").length;
                const pct = tasks.length>0?Math.round((done/tasks.length)*100):0;
                const color = PROJECT_STATUS_COLORS[p.status]||"#6b7280";
                const budget = tasks.reduce((s,t)=>s+Number(t.budget||0),0);
                const actual = tasks.reduce((s,t)=>s+Number(t.actual||0),0);
                return (
                  <div key={p.id} style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",padding:"1.25rem",borderTop:`3px solid ${color}` }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.5rem" }}>
                      <div style={{ fontWeight:700,fontSize:"0.95rem",color:"#e8eaf0",flex:1,paddingRight:"0.5rem" }}>{p.name}</div>
                      <Badge color={color} label={p.status}/>
                    </div>
                    {p.description&&<p style={{ margin:"0 0 0.75rem",fontSize:"0.78rem",color:"#6b7280",lineHeight:1.4 }}>{p.description}</p>}
                    {tasks.length>0&&<div style={{ marginBottom:"0.75rem" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",fontSize:"0.68rem",color:"#6b7280",marginBottom:"4px" }}><span>{done}/{tasks.length} tasks</span><span>{pct}%</span></div>
                      <div style={{ height:"4px",background:"#1e2430",borderRadius:"99px",overflow:"hidden" }}><div style={{ height:"100%",width:`${pct}%`,background:pct===100?"#4a7c59":"#e07b39",borderRadius:"99px" }}/></div>
                    </div>}
                    {(budget>0||actual>0)&&<div style={{ display:"flex",gap:"1rem" }}>
                      {budget>0&&<div><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase" }}>Budget</div><div style={{ fontSize:"0.85rem",fontWeight:600,color:"#e07b39",fontFamily:"'DM Mono',monospace" }}>{fmt(budget)}</div></div>}
                      {actual>0&&<div><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase" }}>Actual</div><div style={{ fontSize:"0.85rem",fontWeight:600,color:actual>budget?"#f87171":"#4a7c59",fontFamily:"'DM Mono',monospace" }}>{fmt(actual)}</div></div>}
                    </div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Vendors */}
      {activeSection==="vendors" && (
        <div>
          {propVendors.length===0 ? (
            <div style={{ background:"#14181f",border:"1px dashed #2a2f3d",borderRadius:"10px",padding:"2.5rem",textAlign:"center",color:"#4b5563",fontSize:"0.85rem" }}>No vendors have been invoiced for this property yet.</div>
          ) : (
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"1rem" }}>
              {propVendors.map(v=>{
                const spent = propInvoices.filter(i=>i.vendorId===v.id).reduce((s,i)=>s+Number(i.amount),0);
                const invCount = propInvoices.filter(i=>i.vendorId===v.id).length;
                return (
                  <div key={v.id} style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"10px",padding:"1rem" }}>
                    <div style={{ fontWeight:600,color:"#e8eaf0",fontSize:"0.9rem",marginBottom:"0.25rem" }}>{v.name}</div>
                    <div style={{ fontSize:"0.72rem",color:"#6b7280",marginBottom:"0.5rem" }}>{v.category}</div>
                    {v.phone&&<div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{v.phone}</div>}
                    {v.email&&<div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{v.email}</div>}
                    <div style={{ marginTop:"0.6rem",paddingTop:"0.6rem",borderTop:"1px solid #1a1f2b",display:"flex",justifyContent:"space-between" }}>
                      <div><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase" }}>Paid</div><div style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.88rem",fontWeight:700,color:"#e07b39" }}>{fmt(spent)}</div></div>
                      <div style={{ textAlign:"right" }}><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase" }}>Invoices</div><div style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.88rem",fontWeight:700,color:"#3b6fa0" }}>{invCount}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {editModal && (
        <Modal title="Edit Property" onClose={()=>setEditModal(false)}>
          <Field label="Property Name"><input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Naples Main"/></Field>
          <Field label="Street Address"><input style={inputStyle} value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="123 Main St"/></Field>
          <Grid2>
            <Field label="City"><input style={inputStyle} value={form.city} onChange={e=>setForm(f=>({...f,city:e.target.value}))} placeholder="City"/></Field>
            <Field label="State"><select style={inputStyle} value={form.state} onChange={e=>setForm(f=>({...f,state:e.target.value}))}>{US_STATES.map(s=><option key={s}>{s}</option>)}</select></Field>
          </Grid2>
          <Field label="Color Tag">
            <div style={{ display:"flex",gap:"0.5rem",flexWrap:"wrap" }}>
              {PROPERTY_COLORS.map(c=><div key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{ width:"28px",height:"28px",borderRadius:"50%",background:c,cursor:"pointer",border:form.color===c?"3px solid #fff":"3px solid transparent" }}/>)}
            </div>
          </Field>
          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end" }}>
            <BtnDanger onClick={handleDelete}><Icon name="trash" size={14}/>Delete</BtnDanger>
            <button onClick={handleSave} style={{ background:"#e07b39",color:"#fff",border:"none",borderRadius:"8px",padding:"0.5rem 1.25rem",cursor:"pointer",fontSize:"0.85rem",fontWeight:600,marginLeft:"auto" }}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Properties ───────────────────────────────────────────────────────────────
function Properties({ properties, isAdmin, viewingAs, onAdd, onUpdate, onDelete, invoices, tenants, projects, vendors }) {
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [modal, setModal] = useState(null);
  const blank = { name:"",address:"",city:"",state:"FL",color:PROPERTY_COLORS[0] };
  const [form, setForm] = useState(blank);
  const readOnly = !!viewingAs;

  if (selectedProperty) {
    const live = properties.find(p=>p.id===selectedProperty);
    if (!live) { setSelectedProperty(null); return null; }
    return <PropertyDetail property={live} invoices={invoices} tenants={tenants} projects={projects||[]} vendors={vendors||[]} isAdmin={isAdmin} onUpdate={onUpdate} onDelete={async(id)=>{ await onDelete(id); setSelectedProperty(null); }} onBack={()=>setSelectedProperty(null)}/>;
  }

  function openAdd() { setForm(blank); setModal("add"); }
  async function handleSave() {
    if (!form.name.trim()) return;
    if (modal==="add") await onAdd(form);
    else await onUpdate({ ...form, id:modal.id });
    setModal(null);
  }

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem" }}>
        <h2 style={{ margin:0,fontSize:"1.1rem",fontWeight:700,color:"#e8eaf0" }}>Properties {viewingAs&&<OwnerTag email={viewingAs.email} name={viewingAs.full_name}/>}</h2>
        {!readOnly && <BtnPrimary onClick={openAdd}><Icon name="plus" size={14}/>Add Property</BtnPrimary>}
      </div>
      {!readOnly && <PropertyDropZone onConfirm={f=>onAdd(f)}/>}

      {properties.length>0 && (
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem",marginBottom:"1.5rem" }}>
          <ChartCard title="Expenses by Property">
            <HBarChart data={properties.map(p=>({ label:p.name, value:invoices.filter(i=>i.propertyId===p.id).reduce((s,i)=>s+Number(i.amount),0), color:p.color })).filter(d=>d.value>0).sort((a,b)=>b.value-a.value)} colorKey="color" valueKey="value" labelKey="label"/>
          </ChartCard>
          <ChartCard title="Income vs. Expenses">
            <GroupedBarChart data={properties.map(p=>({ name:p.name, income:tenants.filter(t=>t.propertyId===p.id&&leaseStatus(t.leaseStart,t.leaseEnd)==="active").reduce((s,t)=>s+leaseTotalRent(t),0), expense:invoices.filter(i=>i.propertyId===p.id).reduce((s,i)=>s+Number(i.amount),0) }))} height={160}/>
          </ChartCard>
        </div>
      )}
      {properties.length===0 && <div style={{ color:"#4b5563",fontSize:"0.9rem",padding:"2rem 0",textAlign:"center" }}>No properties yet.</div>}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:"1rem" }}>
        {properties.map(p=>{
          const spent = invoices.filter(i=>i.propertyId===p.id).reduce((s,i)=>s+Number(i.amount),0);
          const active = tenants.filter(t=>t.propertyId===p.id&&leaseStatus(t.leaseStart,t.leaseEnd)==="active");
          const leaseIncome = active.reduce((s,t)=>s+leaseTotalRent(t),0);
          return (
            <div key={p.id} onClick={()=>setSelectedProperty(p.id)} style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",padding:"1.25rem",borderTop:`3px solid ${p.color}`,cursor:"pointer" }}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#2a3a4d"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1e2430"}>
              <div style={{ fontSize:"1rem",fontWeight:700,color:"#e8eaf0",marginBottom:"0.2rem" }}>{p.name}</div>
              <div style={{ fontSize:"0.78rem",color:"#6b7280" }}>{p.city}, {p.state}</div>
              <div style={{ fontSize:"0.74rem",color:"#4b5563" }}>{p.address}</div>
              <div style={{ marginTop:"1rem",paddingTop:"0.75rem",borderTop:"1px solid #1a1f2b",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.5rem" }}>
                {[{l:"Expenses",v:fmt(spent),c:"#e07b39"},{l:"Lease Income",v:fmt(leaseIncome),c:"#4a7c59"},{l:"Tenants",v:active.length,c:"#3b6fa0"}].map(x=>(
                  <div key={x.l}><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em" }}>{x.l}</div><div style={{ fontSize:"0.95rem",fontWeight:700,color:x.c,fontFamily:"'DM Mono',monospace" }}>{x.v}</div></div>
                ))}
              </div>
              <div style={{ marginTop:"0.5rem",fontSize:"0.68rem",color:"#4b5563" }}>Click to view details →</div>
            </div>
          );
        })}
      </div>
      {modal && !readOnly && (
        <Modal title="Add Property" onClose={()=>setModal(null)}>
          <Field label="Property Name"><input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Naples Main"/></Field>
          <Field label="Street Address"><input style={inputStyle} value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="123 Main St"/></Field>
          <Grid2>
            <Field label="City"><input style={inputStyle} value={form.city} onChange={e=>setForm(f=>({...f,city:e.target.value}))} placeholder="City"/></Field>
            <Field label="State"><select style={inputStyle} value={form.state} onChange={e=>setForm(f=>({...f,state:e.target.value}))}>{US_STATES.map(s=><option key={s}>{s}</option>)}</select></Field>
          </Grid2>
          <Field label="Color Tag">
            <div style={{ display:"flex",gap:"0.5rem",flexWrap:"wrap" }}>
              {PROPERTY_COLORS.map(c=><div key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{ width:"28px",height:"28px",borderRadius:"50%",background:c,cursor:"pointer",border:form.color===c?"3px solid #fff":"3px solid transparent" }}/>)}
            </div>
          </Field>
          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end" }}>
            <button onClick={handleSave} style={{ background:"#e07b39",color:"#fff",border:"none",borderRadius:"8px",padding:"0.5rem 1.25rem",cursor:"pointer",fontSize:"0.85rem",fontWeight:600,marginLeft:"auto" }}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Tenants ──────────────────────────────────────────────────────────────────
function Tenants({ tenants, properties, viewingAs, onAdd, onUpdate, onDelete }) {
  const [modal, setModal] = useState(null);
  const [filterProp, setFilterProp] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const fileRef = useRef();
  const readOnly = !!viewingAs;
  const blank = { name:"",email:"",phone:"",propertyId:properties[0]?.id||"",leaseStart:"",leaseEnd:"",monthlyRent:"",securityDeposit:"",unit:"",notes:"",contractFileName:null };
  const [form, setForm] = useState(blank);

  function openAdd() { setForm({...blank,propertyId:properties[0]?.id||""}); setModal("add"); }
  function openEdit(t) { setForm({...t}); setModal(t); }
  async function handleSave() {
    if (!form.name.trim()||!form.propertyId) return;
    if (modal==="add") await onAdd(form); else await onUpdate({...form,id:modal.id});
    setModal(null);
  }
  async function handleDelete(id) {
    if (!confirm("Remove this tenant?")) return;
    await onDelete(id); setModal(null);
  }

  const filtered = tenants.filter(t=>{
    if (filterProp!=="all"&&t.propertyId!==filterProp) return false;
    if (filterStatus!=="all"&&leaseStatus(t.leaseStart,t.leaseEnd)!==filterStatus) return false;
    return true;
  });
  const totalLeaseIncome = filtered.filter(t=>leaseStatus(t.leaseStart,t.leaseEnd)==="active").reduce((s,t)=>s+leaseTotalRent(t),0);

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem",flexWrap:"wrap",gap:"0.75rem" }}>
        <h2 style={{ margin:0,fontSize:"1.1rem",fontWeight:700,color:"#e8eaf0" }}>Tenants {viewingAs&&<OwnerTag email={viewingAs.email} name={viewingAs.full_name}/>}</h2>
        <div style={{ display:"flex",gap:"0.5rem",alignItems:"center",flexWrap:"wrap" }}>
          <select style={{...inputStyle,width:"auto"}} value={filterProp} onChange={e=>setFilterProp(e.target.value)}>
            <option value="all">All Properties</option>
            {properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select style={{...inputStyle,width:"auto"}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="expiring">Expiring Soon</option>
            <option value="expired">Expired</option>
          </select>
          {!readOnly && <BtnPrimary onClick={openAdd}><Icon name="plus" size={14}/>Add Tenant</BtnPrimary>}
        </div>
      </div>
      <div style={{ background:"#0d1117",border:"1px solid #1e2430",borderRadius:"10px",padding:"0.75rem 1.25rem",marginBottom:"1.25rem",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <span style={{ fontSize:"0.75rem",color:"#6b7280",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em" }}>{filtered.length} shown</span>
        <span style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.9rem",fontWeight:700,color:"#4a7c59" }}>{fmt(totalLeaseIncome)} lease income</span>
      </div>

      {/* Tenant charts */}
      {tenants.length>0 && (
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem",marginBottom:"1.25rem" }}>
          <ChartCard title="Lease Income by Property">
            <HBarChart data={properties.map(p=>({ label:p.name, value:tenants.filter(t=>t.propertyId===p.id&&leaseStatus(t.leaseStart,t.leaseEnd)==="active").reduce((s,t)=>s+leaseTotalRent(t),0), color:p.color })).filter(d=>d.value>0)} colorKey="color" valueKey="value" labelKey="label"/>
          </ChartCard>
          <ChartCard title="Monthly Income — Last 12 Months">
            <SparkLine invoices={[]} tenants={tenants} months={12} height={100}/>
          </ChartCard>
        </div>
      )}
      {filtered.length===0 && <div style={{ color:"#4b5563",fontSize:"0.9rem",padding:"2rem 0",textAlign:"center" }}>No tenants match this filter.</div>}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"1rem" }}>
        {filtered.map(t=>{
          const prop = properties.find(p=>p.id===t.propertyId);
          const status = leaseStatus(t.leaseStart,t.leaseEnd);
          const seasonal = isSeasonal(t);
          const months = leaseMonths(t.leaseStart, t.leaseEnd);
          const totalRent = leaseTotalRent(t);
          return (
            <div key={t.id} onClick={()=>!readOnly&&openEdit(t)} style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",padding:"1.25rem",cursor:readOnly?"default":"pointer",borderLeft:`3px solid ${prop?.color||"#374151"}` }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.75rem" }}>
                <div>
                  <div style={{ fontWeight:700,fontSize:"0.95rem",color:"#e8eaf0",display:"flex",alignItems:"center",gap:"0.4rem" }}>
                    {t.name}
                    {seasonal && <span style={{ fontSize:"0.6rem",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",color:"#0891b2",background:"#0891b222",border:"1px solid #0891b244",borderRadius:"99px",padding:"1px 6px" }}>Seasonal</span>}
                  </div>
                  <div style={{ fontSize:"0.75rem",color:"#6b7280",marginTop:"2px" }}>{prop?.name}{t.unit?` · Unit ${t.unit}`:""}</div>
                </div>
                <Badge color={leaseColor(status)} label={leaseLabel(status)}/>
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:"3px",marginBottom:"0.85rem" }}>
                {t.phone&&<div style={{ display:"flex",alignItems:"center",gap:"5px",fontSize:"0.78rem",color:"#94a3b8" }}><Icon name="phone" size={11}/>{t.phone}</div>}
                {t.email&&<div style={{ display:"flex",alignItems:"center",gap:"5px",fontSize:"0.78rem",color:"#94a3b8" }}><Icon name="mail" size={11}/>{t.email}</div>}
                {t.leaseStart&&t.leaseEnd&&<div style={{ display:"flex",alignItems:"center",gap:"5px",fontSize:"0.72rem",color:"#6b7280" }}><Icon name="calendar" size={10}/>{t.leaseStart} → {t.leaseEnd} · {months} mo</div>}
              </div>
              <div style={{ display:"flex",justifyContent:"space-between",paddingTop:"0.75rem",borderTop:"1px solid #1a1f2b" }}>
                <div>
                  <div style={{ fontSize:"0.65rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em" }}>{seasonal?`Lease Total (${months} mo)`:"Monthly Rent"}</div>
                  <div style={{ fontSize:"1rem",fontWeight:700,color:"#4a7c59",fontFamily:"'DM Mono',monospace" }}>{seasonal?fmt(totalRent):fmt(t.monthlyRent)}</div>
                  {seasonal&&<div style={{ fontSize:"0.65rem",color:"#6b7280",marginTop:"1px" }}>{fmt(t.monthlyRent)}/mo</div>}
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:"0.65rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em" }}>Deposit</div>
                  <div style={{ fontSize:"1rem",fontWeight:700,color:"#e8eaf0",fontFamily:"'DM Mono',monospace" }}>{fmt(t.securityDeposit)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {modal && !readOnly && (
        <Modal title={modal==="add"?"Add Tenant":"Edit Tenant"} onClose={()=>setModal(null)} wide>
          <SectionDivider label="Contact Info"/>
          <Field label="Full Name"><input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Jane Smith"/></Field>
          <Grid2>
            <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="555-0100"/></Field>
            <Field label="Email"><input style={inputStyle} value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="jane@email.com"/></Field>
          </Grid2>
          <SectionDivider label="Property & Lease"/>
          <Grid2>
            <Field label="Property"><select style={inputStyle} value={form.propertyId} onChange={e=>setForm(f=>({...f,propertyId:e.target.value}))}><option value="">Select…</option>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Unit (optional)"><input style={inputStyle} value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} placeholder="Unit 2B"/></Field>
          </Grid2>
          <Grid2>
            <Field label="Lease Start"><input style={inputStyle} type="date" value={form.leaseStart} onChange={e=>setForm(f=>({...f,leaseStart:e.target.value}))}/></Field>
            <Field label="Lease End"><input style={inputStyle} type="date" value={form.leaseEnd} onChange={e=>setForm(f=>({...f,leaseEnd:e.target.value}))}/></Field>
          </Grid2>
          <SectionDivider label="Financials"/>
          <Grid2>
            <Field label="Monthly Rent ($)"><input style={inputStyle} type="number" value={form.monthlyRent} onChange={e=>setForm(f=>({...f,monthlyRent:e.target.value}))} placeholder="0"/></Field>
            <Field label="Security Deposit ($)"><input style={inputStyle} type="number" value={form.securityDeposit} onChange={e=>setForm(f=>({...f,securityDeposit:e.target.value}))} placeholder="0"/></Field>
          </Grid2>
          <Field label="Notes"><textarea style={{...inputStyle,resize:"vertical",minHeight:"60px"}} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Special terms, parking, etc."/></Field>
          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end",marginTop:"0.25rem" }}>
            {modal!=="add"&&<BtnDanger onClick={()=>handleDelete(modal.id)}><Icon name="trash" size={14}/>Remove</BtnDanger>}
            <button onClick={handleSave} style={{ background:"#e07b39",color:"#fff",border:"none",borderRadius:"8px",padding:"0.5rem 1.25rem",cursor:"pointer",fontSize:"0.85rem",fontWeight:600,marginLeft:"auto" }}>Save Tenant</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Vendor AI Drop Zone ──────────────────────────────────────────────────────
function VendorDropZone({ onConfirm }) {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [form, setForm] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const inputRef = useRef();
  const confidenceColor = { low:"#f87171", medium:"#fbbf24", high:"#4a7c59" };

  async function processFile(f) {
    if (!f) return;
    setError(null); setParsed(null); setForm(null);
    if (f.type.startsWith("image/")) setPreviewUrl(URL.createObjectURL(f)); else setPreviewUrl(null);
    setParsing(true);
    try {
      const result = await parseVendorWithAI(f);
      setParsed(result);
      setForm({ name:result.name||"", category:CATEGORIES.includes(result.category)?result.category:CATEGORIES[0], phone:result.phone||"", email:result.email||"", notes:result.notes||"" });
    } catch(e) { setError(e.message||"Failed to parse vendor info."); }
    finally { setParsing(false); }
  }

  function dismiss() { setParsed(null); setForm(null); setPreviewUrl(null); setError(null); }

  return (
    <>
      <div onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)processFile(f);}} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onClick={()=>inputRef.current?.click()}
        style={{ border:`2px dashed ${dragging?"#e07b39":"#2a2f3d"}`,borderRadius:"12px",padding:"1.25rem",textAlign:"center",cursor:"pointer",background:dragging?"#1c1407":"#0d1117",transition:"all 0.15s",marginBottom:"1.25rem" }}>
        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }} onChange={e=>{const f=e.target.files[0];if(f)processFile(f);e.target.value="";}}/>
        {parsing ? (
          <div style={{ color:"#e07b39",fontSize:"0.85rem",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.5rem" }}><Spinner/>Reading vendor info with AI…</div>
        ) : (
          <div>
            <div style={{ color:"#4b5563",marginBottom:"0.25rem" }}><Icon name="upload" size={18}/></div>
            <div style={{ fontSize:"0.82rem",color:dragging?"#e07b39":"#6b7280",fontWeight:600 }}>{dragging?"Drop file here":"Drag & drop an invoice, business card, or screenshot"}</div>
            <div style={{ fontSize:"0.7rem",color:"#4b5563",marginTop:"0.2rem" }}>or click to browse · AI extracts vendor name, phone, email, category</div>
          </div>
        )}
      </div>
      {error && <div style={{ background:"#1c0808",border:"1px solid #5c1f1f",borderRadius:"8px",padding:"0.75rem 1rem",marginBottom:"1rem",fontSize:"0.82rem",color:"#f87171",display:"flex",justifyContent:"space-between",alignItems:"center" }}>{error}<button onClick={()=>setError(null)} style={{ background:"none",border:"none",color:"#f87171",cursor:"pointer",padding:0 }}><Icon name="x" size={13}/></button></div>}

      {form && (
        <div style={{ position:"fixed",inset:0,background:"rgba(10,12,18,0.85)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }}>
          <div style={{ background:"#14181f",border:"1px solid #2a2f3d",borderRadius:"14px",width:"100%",maxWidth:"520px",maxHeight:"94vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1.25rem 1.5rem",borderBottom:"1px solid #1e2430",position:"sticky",top:0,background:"#14181f",zIndex:10 }}>
              <div>
                <h3 style={{ margin:0,fontSize:"1rem",fontWeight:700,color:"#e8eaf0" }}>Review Extracted Vendor</h3>
                <div style={{ fontSize:"0.72rem",color:"#6b7280",marginTop:"2px" }}>AI confidence: <span style={{ color:confidenceColor[parsed?.confidence]||"#6b7280",fontWeight:700,textTransform:"uppercase" }}>{parsed?.confidence||"—"}</span></div>
              </div>
              <button onClick={dismiss} style={{ background:"none",border:"none",color:"#6b7280",cursor:"pointer",padding:"4px",display:"flex" }}><Icon name="x" size={18}/></button>
            </div>
            <div style={{ padding:"1.5rem" }}>
              {previewUrl && <div style={{ marginBottom:"1rem",borderRadius:"8px",overflow:"hidden",border:"1px solid #2a2f3d",maxHeight:"140px",display:"flex",alignItems:"center",justifyContent:"center",background:"#0d1117" }}><img src={previewUrl} alt="" style={{ maxHeight:"140px",maxWidth:"100%",objectFit:"contain" }}/></div>}
              <Field label="Vendor Name"><input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Business name"/></Field>
              <Field label="Category"><select style={inputStyle} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field>
              <Grid2>
                <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="555-0100"/></Field>
                <Field label="Email"><input style={inputStyle} value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="email@vendor.com"/></Field>
              </Grid2>
              <Field label="Notes"><textarea style={{...inputStyle,resize:"vertical",minHeight:"60px"}} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Website, address, license #, etc."/></Field>
              <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end",marginTop:"0.5rem" }}>
                <BtnSecondary onClick={dismiss}>Discard</BtnSecondary>
                <BtnPrimary onClick={()=>{ if(form.name.trim()) { onConfirm(form); dismiss(); } }}><Icon name="check" size={13}/>Save Vendor</BtnPrimary>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Vendor Detail View ───────────────────────────────────────────────────────
function VendorDetail({ vendor, invoices, properties, projects, isAdmin, onUpdate, onDelete, onBack }) {
  const [editModal, setEditModal] = useState(false);
  const [form, setForm] = useState({...vendor});
  const vendorInvoices = invoices.filter(i=>i.vendorId===vendor.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const totalSpent = vendorInvoices.reduce((s,i)=>s+Number(i.amount),0);
  const byProp = properties.map(p=>({ ...p, total:vendorInvoices.filter(i=>i.propertyId===p.id).reduce((s,i)=>s+Number(i.amount),0) })).filter(p=>p.total>0);

  async function handleSave() {
    if (!form.name.trim()) return;
    await onUpdate({...form,id:vendor.id});
    setEditModal(false);
  }
  async function handleDelete() {
    if (!confirm("Delete this vendor?")) return;
    await onDelete(vendor.id);
    onBack();
  }

  return (
    <div>
      <button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:"6px",background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:"0.83rem",marginBottom:"1.25rem",padding:0 }}>
        <Icon name="arrowLeft" size={14}/>Back to Vendors
      </button>

      <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"14px",padding:"1.5rem",marginBottom:"1.5rem" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"0.75rem",marginBottom:"1rem" }}>
          <div>
            <h2 style={{ margin:"0 0 0.25rem",fontSize:"1.2rem",fontWeight:700,color:"#e8eaf0" }}>{vendor.name}</h2>
            <Badge color="#6b7280" label={vendor.category}/>
          </div>
          <div style={{ display:"flex",gap:"0.5rem" }}>
            <BtnSecondary onClick={()=>{ setForm({...vendor}); setEditModal(true); }}><Icon name="wrench" size={13}/>Edit</BtnSecondary>
          </div>
        </div>
        <div style={{ display:"flex",flexDirection:"column",gap:"4px",marginBottom:"1rem" }}>
          {vendor.phone&&<div style={{ display:"flex",alignItems:"center",gap:"6px",fontSize:"0.83rem",color:"#94a3b8" }}><Icon name="phone" size={13}/>{vendor.phone}</div>}
          {vendor.email&&<div style={{ display:"flex",alignItems:"center",gap:"6px",fontSize:"0.83rem",color:"#94a3b8" }}><Icon name="mail" size={13}/>{vendor.email}</div>}
          {vendor.notes&&<div style={{ fontSize:"0.78rem",color:"#6b7280",fontStyle:"italic",marginTop:"4px" }}>{vendor.notes}</div>}
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:"0.75rem",paddingTop:"0.75rem",borderTop:"1px solid #1e2430" }}>
          {[{l:"Total Paid",v:fmt(totalSpent),c:"#e07b39"},{l:"Invoices",v:vendorInvoices.length,c:"#3b6fa0"},{l:"Properties",v:byProp.length,c:"#4a7c59"}].map(x=>(
            <div key={x.l}><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:"2px" }}>{x.l}</div><div style={{ fontSize:"1.1rem",fontWeight:700,color:x.c,fontFamily:"'DM Mono',monospace" }}>{x.v}</div></div>
          ))}
        </div>
        {byProp.length>0&&<div style={{ marginTop:"1rem",paddingTop:"0.75rem",borderTop:"1px solid #1e2430" }}>
          <div style={{ fontSize:"0.65rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"0.5rem" }}>Spend by Property</div>
          {byProp.map(p=>(
            <div key={p.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.3rem 0",borderBottom:"1px solid #1a1f2b" }}>
              <span style={{ display:"flex",alignItems:"center",gap:"6px",fontSize:"0.82rem",color:"#94a3b8" }}><span style={{ width:"6px",height:"6px",borderRadius:"50%",background:p.color,display:"inline-block" }}/>{p.name}</span>
              <span style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.82rem",fontWeight:600,color:"#e8eaf0" }}>{fmt(p.total)}</span>
            </div>
          ))}
        </div>}
      </div>

      <div style={{ fontSize:"0.72rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"0.75rem" }}>Invoice History ({vendorInvoices.length})</div>
      {vendorInvoices.length===0 ? (
        <div style={{ background:"#14181f",border:"1px dashed #2a2f3d",borderRadius:"10px",padding:"2.5rem",textAlign:"center",color:"#4b5563",fontSize:"0.85rem" }}>No invoices from this vendor yet.</div>
      ) : (
        <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",overflow:"hidden" }}>
          {vendorInvoices.map((inv,idx)=>{
            const prop = properties.find(p=>p.id===inv.propertyId);
            const proj = projects.find(p=>p.id===inv.projectId);
            const rec = RECURRING_OPTIONS.find(r=>r.value===inv.recurring)||RECURRING_OPTIONS[0];
            return (
              <div key={inv.id} style={{ display:"flex",alignItems:"center",padding:"0.85rem 1.25rem",borderBottom:idx<vendorInvoices.length-1?"1px solid #1a1f2b":"none" }}>
                <div style={{ width:"4px",height:"36px",borderRadius:"99px",background:prop?.color||"#6b7280",marginRight:"1rem",flexShrink:0 }}/>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.2rem",flexWrap:"wrap" }}>
                    <span style={{ fontSize:"0.85rem",fontWeight:600,color:"#e8eaf0" }}>{prop?.name||"—"}</span>
                    {inv.invoiceNumber&&<span style={{ fontSize:"0.72rem",color:"#6b7280",fontFamily:"'DM Mono',monospace" }}>#{inv.invoiceNumber}</span>}
                    <span style={{ fontSize:"0.68rem",background:"#1e2430",color:"#6b7280",borderRadius:"4px",padding:"1px 6px" }}>{inv.category}</span>
                    {inv.recurring&&inv.recurring!=="one-time"&&<span style={{ fontSize:"0.65rem",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:rec.color,background:rec.color+"22",border:`1px solid ${rec.color}44`,borderRadius:"99px",padding:"1px 7px" }}>↻ {rec.label}</span>}
                    {proj&&<span style={{ fontSize:"0.68rem",background:"#3b6fa022",color:"#3b6fa0",border:"1px solid #3b6fa044",borderRadius:"4px",padding:"1px 6px" }}>{proj.name}</span>}
                    {inv.fileUrl&&<a href={inv.fileUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ fontSize:"0.68rem",color:"#3b6fa0",display:"flex",alignItems:"center",gap:"2px",textDecoration:"none" }}><Icon name="file" size={10}/>View</a>}
                  </div>
                  <div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{inv.date}{inv.description?" · "+inv.description:""}</div>
                </div>
                <div style={{ fontFamily:"'DM Mono',monospace",fontSize:"1rem",fontWeight:700,color:"#e8eaf0",marginLeft:"1rem" }}>{fmt(inv.amount)}</div>
              </div>
            );
          })}
        </div>
      )}

      {editModal && (
        <Modal title="Edit Vendor" onClose={()=>setEditModal(false)}>
          <Field label="Vendor Name"><input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Business name"/></Field>
          <Field label="Category"><select style={inputStyle} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field>
          <Grid2>
            <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="555-0100"/></Field>
            <Field label="Email"><input style={inputStyle} value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="email@vendor.com"/></Field>
          </Grid2>
          <Field label="Notes"><textarea style={{...inputStyle,resize:"vertical",minHeight:"60px"}} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes"/></Field>
          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end" }}>
            {isAdmin && <BtnDanger onClick={handleDelete}><Icon name="trash" size={14}/>Delete</BtnDanger>}
            <button onClick={handleSave} style={{ background:"#e07b39",color:"#fff",border:"none",borderRadius:"8px",padding:"0.5rem 1.25rem",cursor:"pointer",fontSize:"0.85rem",fontWeight:600,marginLeft:"auto" }}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Vendors (shared) ─────────────────────────────────────────────────────────
function Vendors({ vendors, isAdmin, invoices, properties, projects, onAdd, onUpdate, onDelete }) {
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [modal, setModal] = useState(null);
  const blank = { name:"",category:CATEGORIES[0],phone:"",email:"",notes:"" };
  const [form, setForm] = useState(blank);

  // If a vendor is selected, show its detail view
  if (selectedVendor) {
    const live = vendors.find(v=>v.id===selectedVendor) || vendors[0];
    if (!live) { setSelectedVendor(null); return null; }
    return <VendorDetail vendor={live} invoices={invoices} properties={properties} projects={projects||[]} isAdmin={isAdmin} onUpdate={onUpdate} onDelete={onDelete} onBack={()=>setSelectedVendor(null)}/>;
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    if (modal==="add") await onAdd(form); else await onUpdate({...form,id:modal.id});
    setModal(null);
  }
  async function handleDelete(id) {
    if (!confirm("Delete this vendor?")) return;
    await onDelete(id); setModal(null);
  }

  const grouped = CATEGORIES.map(cat=>({ cat, vendors:vendors.filter(v=>v.category===cat) })).filter(g=>g.vendors.length>0);

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.5rem" }}>
        <h2 style={{ margin:0,fontSize:"1.1rem",fontWeight:700,color:"#e8eaf0" }}>Vendors <span style={{ fontSize:"0.7rem",color:"#6b7280",fontWeight:400,fontStyle:"italic" }}>shared across all users</span></h2>
        <BtnPrimary onClick={()=>{setForm(blank);setModal("add");}}><Icon name="plus" size={14}/>Add Vendor</BtnPrimary>
      </div>
      {!isAdmin && <div style={{ fontSize:"0.75rem",color:"#6b7280",marginBottom:"1rem" }}>You can add vendors. Only admins can delete them.</div>}

      <VendorDropZone onConfirm={f=>onAdd(f)}/>

      {vendors.length>0 && (
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem",marginBottom:"1.5rem" }}>
          <ChartCard title="Top Vendors by Total Spend">
            <HBarChart data={vendors.map(v=>({ label:v.name, value:invoices.filter(i=>i.vendorId===v.id).reduce((s,i)=>s+Number(i.amount),0), color:"#e07b39" })).filter(d=>d.value>0).sort((a,b)=>b.value-a.value).slice(0,8)} colorKey="color" valueKey="value" labelKey="label"/>
          </ChartCard>
          <ChartCard title="Spend by Category">
            <DonutChart size={130} thickness={22} data={CATEGORIES.map((cat,i)=>({ label:cat, value:invoices.filter(inv=>inv.category===cat).reduce((s,i)=>s+Number(i.amount),0), color:["#e07b39","#3b6fa0","#4a7c59","#8b5cf6","#0891b2","#d946a8","#b45309","#e11d48","#34d399","#f87171","#60a5fa","#a78bfa","#fbbf24","#6b7280","#94a3b8"][i%15] })).filter(d=>d.value>0).sort((a,b)=>b.value-a.value).slice(0,7)}/>
          </ChartCard>
        </div>
      )}

      {vendors.length===0 && <div style={{ color:"#4b5563",fontSize:"0.9rem",padding:"2rem 0",textAlign:"center" }}>No vendors yet.</div>}
      {grouped.map(g=>(
        <div key={g.cat} style={{ marginBottom:"1.5rem" }}>
          <div style={{ fontSize:"0.7rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"0.6rem",paddingBottom:"0.4rem",borderBottom:"1px solid #1e2430" }}>{g.cat}</div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"0.75rem" }}>
            {g.vendors.map(v=>{
              const spent = invoices.filter(i=>i.vendorId===v.id).reduce((s,i)=>s+Number(i.amount),0);
              return (
                <div key={v.id} onClick={()=>setSelectedVendor(v.id)} style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"10px",padding:"1rem",cursor:"pointer" }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="#2a3a4d"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1e2430"}>
                  <div style={{ fontWeight:600,color:"#e8eaf0",fontSize:"0.9rem",marginBottom:"0.25rem" }}>{v.name}</div>
                  {v.phone&&<div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{v.phone}</div>}
                  {v.email&&<div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{v.email}</div>}
                  {v.notes&&<div style={{ fontSize:"0.72rem",color:"#4b5563",marginTop:"0.25rem",fontStyle:"italic" }}>{v.notes}</div>}
                  <div style={{ marginTop:"0.6rem",fontSize:"0.78rem",color:"#94a3b8",fontFamily:"'DM Mono',monospace" }}>Total paid: {fmt(spent)}</div>
                  <div style={{ marginTop:"0.35rem",fontSize:"0.68rem",color:"#4b5563" }}>Click to view invoices →</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {modal && (
        <Modal title={modal==="add"?"Add Vendor":"Edit Vendor"} onClose={()=>setModal(null)}>
          <Field label="Vendor Name"><input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Business name"/></Field>
          <Field label="Category"><select style={inputStyle} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field>
          <Grid2>
            <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="555-0100"/></Field>
            <Field label="Email"><input style={inputStyle} value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="email@vendor.com"/></Field>
          </Grid2>
          <Field label="Notes"><textarea style={{...inputStyle,resize:"vertical",minHeight:"60px"}} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes"/></Field>
          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end" }}>
            {modal!=="add" && isAdmin && <BtnDanger onClick={()=>handleDelete(modal.id)}><Icon name="trash" size={14}/>Delete</BtnDanger>}
            <button onClick={handleSave} style={{ background:"#e07b39",color:"#fff",border:"none",borderRadius:"8px",padding:"0.5rem 1.25rem",cursor:"pointer",fontSize:"0.85rem",fontWeight:600,marginLeft:"auto" }}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
function Invoices({ invoices, properties, vendors, projects, viewingAs, isAdmin, onAdd, onUpdate, onDelete }) {
  const [modal, setModal] = useState(null);
  const [filterProp, setFilterProp] = useState("all");
  const [filterCat, setFilterCat] = useState("all");
  const readOnly = !!viewingAs;
  const blank = { propertyId:properties[0]?.id||"",vendorId:"",category:CATEGORIES[0],amount:"",date:new Date().toISOString().slice(0,10),description:"",invoiceNumber:"",fileName:null,fileUrl:null,filePath:null,recurring:"one-time" };
  const [form, setForm] = useState(blank);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null); // file staged for upload on save
  const fileRef = useRef();

  async function handleSave() {
    if (!form.propertyId||!form.amount||!form.date) return;
    let finalForm = {...form};
    if (pendingFile) {
      setUploading(true);
      try {
        // Remove old file if replacing
        if (finalForm.filePath) await deleteFile(finalForm.filePath);
        const uploaded = await uploadFile(pendingFile, "invoices");
        finalForm.fileName = uploaded.name;
        finalForm.fileUrl = uploaded.url;
        finalForm.filePath = uploaded.path;
      } catch(e) { console.error("Upload failed", e); }
      finally { setUploading(false); }
    }
    if (modal==="add") await onAdd(finalForm); else await onUpdate({...finalForm,id:modal.id});
    setPendingFile(null);
    setModal(null);
  }
  async function handleDelete(id) {
    if (!confirm("Delete this invoice?")) return;
    await onDelete(id); setModal(null);
  }
  function openModal(inv) {
    setForm({...inv});
    setPendingFile(null);
    setModal(inv);
  }

  const filtered = invoices.filter(i=>{
    if (filterProp!=="all"&&i.propertyId!==filterProp) return false;
    if (filterCat!=="all"&&i.category!==filterCat) return false;
    return true;
  }).sort((a,b)=>new Date(b.date)-new Date(a.date));

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem",flexWrap:"wrap",gap:"0.75rem" }}>
        <h2 style={{ margin:0,fontSize:"1.1rem",fontWeight:700,color:"#e8eaf0" }}>Invoices {viewingAs&&<OwnerTag email={viewingAs.email} name={viewingAs.full_name}/>}</h2>
        <div style={{ display:"flex",gap:"0.5rem",alignItems:"center",flexWrap:"wrap" }}>
          <select style={{...inputStyle,width:"auto"}} value={filterProp} onChange={e=>setFilterProp(e.target.value)}>
            <option value="all">All Properties</option>
            {properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select style={{...inputStyle,width:"auto"}} value={filterCat} onChange={e=>setFilterCat(e.target.value)}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
          {!readOnly && <BtnPrimary onClick={()=>{setForm({...blank,propertyId:properties[0]?.id||""});setPendingFile(null);setModal("add");}}><Icon name="plus" size={14}/>Add Invoice</BtnPrimary>}
        </div>
      </div>

      {!readOnly && <InvoiceDropZone vendors={vendors} properties={properties} projects={projects||[]} onConfirm={f=>onAdd(f)}/>}

      {invoices.length>0 && (
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem",marginBottom:"1.25rem" }}>
          <ChartCard title="Monthly Spend Trend">
            <SparkLine invoices={filtered} months={12} color="#e07b39" height={85}/>
          </ChartCard>
          <ChartCard title="Spend by Category">
            <HBarChart data={CATEGORIES.map((cat,i)=>({ label:cat, value:filtered.filter(inv=>inv.category===cat).reduce((s,i)=>s+Number(i.amount),0), color:["#e07b39","#3b6fa0","#4a7c59","#8b5cf6","#0891b2","#d946a8","#b45309","#e11d48","#34d399","#f87171","#60a5fa","#a78bfa","#fbbf24","#6b7280","#94a3b8"][i%15] })).filter(d=>d.value>0).sort((a,b)=>b.value-a.value).slice(0,8)} colorKey="color" valueKey="value" labelKey="label"/>
          </ChartCard>
        </div>
      )}

      <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",overflow:"hidden" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.75rem 1.25rem",borderBottom:"1px solid #1e2430",background:"#0d1117" }}>
          <span style={{ fontSize:"0.75rem",color:"#6b7280",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em" }}>{filtered.length} records</span>
          <span style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.9rem",fontWeight:700,color:"#e07b39" }}>{fmt(filtered.reduce((s,i)=>s+Number(i.amount),0))}</span>
        </div>
        {filtered.length===0 && <div style={{ padding:"2rem",color:"#4b5563",fontSize:"0.9rem",textAlign:"center" }}>No invoices match this filter.</div>}
        {filtered.map(inv=>{
          const prop = properties.find(p=>p.id===inv.propertyId);
          const vend = vendors.find(v=>v.id===inv.vendorId);
          const proj = projects.find(p=>p.id===inv.projectId);
          const rec = RECURRING_OPTIONS.find(r=>r.value===inv.recurring)||RECURRING_OPTIONS[0];
          return (
            <div key={inv.id} onClick={()=>!readOnly&&openModal(inv)} style={{ display:"flex",alignItems:"center",padding:"0.85rem 1.25rem",borderBottom:"1px solid #1a1f2b",cursor:readOnly?"default":"pointer" }}
              onMouseEnter={e=>!readOnly&&(e.currentTarget.style.background="#1a1f2b")} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div style={{ width:"4px",height:"36px",borderRadius:"99px",background:prop?.color||"#6b7280",marginRight:"1rem",flexShrink:0 }}/>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.2rem",flexWrap:"wrap" }}>
                  <span style={{ fontSize:"0.88rem",fontWeight:600,color:"#e8eaf0" }}>{vend?.name||"Unknown Vendor"}</span>
                  {inv.invoiceNumber&&<span style={{ fontSize:"0.72rem",color:"#6b7280",fontFamily:"'DM Mono',monospace" }}>#{inv.invoiceNumber}</span>}
                  <span style={{ fontSize:"0.68rem",background:"#1e2430",color:"#6b7280",borderRadius:"4px",padding:"1px 6px" }}>{inv.category}</span>
                  {inv.recurring&&inv.recurring!=="one-time"&&<span style={{ fontSize:"0.65rem",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:rec.color,background:rec.color+"22",border:`1px solid ${rec.color}44`,borderRadius:"99px",padding:"1px 7px" }}>↻ {rec.label}</span>}
                  {proj&&<span style={{ fontSize:"0.68rem",background:"#3b6fa022",color:"#3b6fa0",border:"1px solid #3b6fa044",borderRadius:"4px",padding:"1px 6px",display:"flex",alignItems:"center",gap:"3px" }}><Icon name="clipboard" size={9}/>{proj.name}</span>}
                  {inv.fileUrl && <a href={inv.fileUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ fontSize:"0.68rem",color:"#3b6fa0",display:"flex",alignItems:"center",gap:"2px",textDecoration:"none" }}><Icon name="file" size={10}/>View</a>}
                  {isAdmin&&inv.ownerName&&<OwnerTag email={inv.ownerEmail} name={inv.ownerName}/>}
                </div>
                <div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{prop?.name} · {inv.date}{inv.description?" · "+inv.description:""}</div>
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace",fontSize:"1rem",fontWeight:700,color:"#e8eaf0",marginLeft:"1rem" }}>{fmt(inv.amount)}</div>
            </div>
          );
        })}
      </div>

      {modal && !readOnly && (
        <Modal title={modal==="add"?"Add Invoice":"Edit Invoice"} onClose={()=>{setModal(null);setPendingFile(null);}} wide>
          <Grid2>
            <Field label="Property"><select style={inputStyle} value={form.propertyId} onChange={e=>setForm(f=>({...f,propertyId:e.target.value}))}><option value="">Select…</option>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Vendor"><select style={inputStyle} value={form.vendorId} onChange={e=>setForm(f=>({...f,vendorId:e.target.value}))}><option value="">Select…</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          </Grid2>
          <Grid2>
            <Field label="Category"><select style={inputStyle} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="Amount ($)"><input style={inputStyle} type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/></Field>
          </Grid2>
          <Grid2>
            <Field label="Date"><input style={inputStyle} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></Field>
            <Field label="Invoice #"><input style={inputStyle} value={form.invoiceNumber||""} onChange={e=>setForm(f=>({...f,invoiceNumber:e.target.value}))} placeholder="e.g. INV-0042"/></Field>
          </Grid2>
          <Field label="Description"><input style={inputStyle} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Brief description…"/></Field>
          <Field label="Recurring">
            <div style={{ display:"flex",gap:"0.5rem",flexWrap:"wrap" }}>
              {RECURRING_OPTIONS.map(r=>(
                <button key={r.value} onClick={()=>setForm(f=>({...f,recurring:r.value}))}
                  style={{ flex:1,padding:"0.45rem 0.5rem",borderRadius:"7px",border:`1px solid ${form.recurring===r.value?r.color:"#2a2f3d"}`,background:form.recurring===r.value?r.color+"22":"#0d1117",color:form.recurring===r.value?r.color:"#6b7280",cursor:"pointer",fontSize:"0.78rem",fontWeight:form.recurring===r.value?700:400,textAlign:"center",whiteSpace:"nowrap" }}>
                  {r.value!=="one-time"&&"↻ "}{r.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Project">
            <select style={inputStyle} value={form.projectId||""} onChange={e=>setForm(f=>({...f,projectId:e.target.value}))}>
              <option value="">— No project —</option>
              {projects.filter(p=>!form.propertyId||p.propertyId===form.propertyId).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              {form.propertyId&&projects.filter(p=>p.propertyId!==form.propertyId).length>0&&<>
                <option disabled>── Other properties ──</option>
                {projects.filter(p=>p.propertyId!==form.propertyId).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </>}
            </select>
          </Field>

          {/* File attachment */}
          <SectionDivider label="Attachment"/>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:"none" }}
            onChange={e=>{ const f=e.target.files[0]; if(f){ setPendingFile(f); setForm(ff=>({...ff,fileName:f.name})); } e.target.value=""; }}/>
          {(pendingFile||form.fileUrl) ? (
            <div style={{ background:"#0d1117",border:"1px solid #2a2f3d",borderRadius:"8px",padding:"0.65rem 1rem",display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"0.5rem" }}>
              <Icon name="file" size={14}/>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontSize:"0.82rem",color:"#e8eaf0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                  {pendingFile ? pendingFile.name : form.fileName||"Attached file"}
                </div>
                {pendingFile && <div style={{ fontSize:"0.68rem",color:"#b45309",marginTop:"1px" }}>Pending — will upload on save</div>}
                {!pendingFile && form.fileUrl && <a href={form.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:"0.68rem",color:"#3b6fa0",textDecoration:"none" }}>View current file ↗</a>}
              </div>
              <div style={{ display:"flex",gap:"0.4rem",flexShrink:0 }}>
                <button onClick={()=>fileRef.current?.click()} style={{ fontSize:"0.72rem",padding:"3px 8px",borderRadius:"5px",border:"1px solid #2a2f3d",background:"#1e2430",color:"#94a3b8",cursor:"pointer" }}>Replace</button>
                <button onClick={()=>{ setPendingFile(null); setForm(f=>({...f,fileName:null,fileUrl:null,filePath:null})); }} style={{ fontSize:"0.72rem",padding:"3px 8px",borderRadius:"5px",border:"1px solid #3d1515",background:"#1c0808",color:"#f87171",cursor:"pointer" }}>Remove</button>
              </div>
            </div>
          ) : (
            <div
              onDrop={e=>{ e.preventDefault(); e.stopPropagation(); const f=e.dataTransfer.files[0]; if(f){ setPendingFile(f); setForm(ff=>({...ff,fileName:f.name})); } }}
              onDragOver={e=>{ e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderColor="#e07b39"; e.currentTarget.style.background="#1c1407"; }}
              onDragLeave={e=>{ e.currentTarget.style.borderColor="#2a2f3d"; e.currentTarget.style.background="#0d1117"; }}
              onClick={()=>fileRef.current?.click()}
              style={{ width:"100%",background:"#0d1117",border:"1px dashed #2a2f3d",borderRadius:"8px",padding:"0.65rem",color:"#6b7280",cursor:"pointer",fontSize:"0.82rem",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.5rem",marginBottom:"0.5rem",transition:"all 0.15s" }}>
              <Icon name="upload" size={13}/>Attach PDF or image — or drag &amp; drop here
            </div>
          )}

          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end",marginTop:"0.5rem" }}>
            {modal!=="add"&&<BtnDanger onClick={()=>handleDelete(modal.id)}><Icon name="trash" size={14}/>Delete</BtnDanger>}
            <BtnPrimary onClick={handleSave} disabled={uploading}>
              {uploading&&<Spinner/>}
              {uploading?"Uploading…":"Save Invoice"}
            </BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Projects (simplified — tasks stored as JSONB) ────────────────────────────
function Projects({ projects, properties, vendors, invoices, viewingAs, isAdmin, onAdd, onUpdate, onDelete, onAddInvoice, onUpdateInvoice }) {
  const [view, setView] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const readOnly = !!viewingAs;

  const blank = { name:"",description:"",propertyId:properties[0]?.id||"",status:"Planning",vendorIds:[],startDate:"",endDate:"",tasks:[] };
  const [form, setForm] = useState(blank);

  async function handleAdd() {
    if (!form.name.trim()) return;
    await onAdd(form); setForm(blank); setShowModal(false);
  }

  if (view) {
    const project = projects.find(p=>p.id===view);
    if (!project) { setView(null); return null; }
    return <ProjectDetail project={project} projects={projects} vendors={vendors} properties={properties} invoices={invoices} readOnly={readOnly} isAdmin={isAdmin} onUpdate={onUpdate} onDelete={onDelete} onAddInvoice={onAddInvoice} onUpdateInvoice={onUpdateInvoice} onBack={()=>setView(null)}/>;
  }

  const filtered = projects.filter(p=>filterStatus==="all"||p.status===filterStatus);

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem",flexWrap:"wrap",gap:"0.75rem" }}>
        <h2 style={{ margin:0,fontSize:"1.1rem",fontWeight:700,color:"#e8eaf0" }}>Projects {viewingAs&&<OwnerTag email={viewingAs.email} name={viewingAs.full_name}/>}</h2>
        <div style={{ display:"flex",gap:"0.5rem",alignItems:"center",flexWrap:"wrap" }}>
          <select style={{...inputStyle,width:"auto"}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            {PROJECT_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          {!readOnly && <BtnPrimary onClick={()=>setShowModal(true)}><Icon name="plus" size={14}/>New Project</BtnPrimary>}
        </div>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.75rem",marginBottom:"1.5rem" }}>
        {PROJECT_STATUSES.map(s=>{ const count=projects.filter(p=>p.status===s).length; const color=PROJECT_STATUS_COLORS[s]; return (
          <div key={s} onClick={()=>setFilterStatus(filterStatus===s?"all":s)} style={{ background:"#14181f",border:`1px solid ${filterStatus===s?color:"#1e2430"}`,borderRadius:"10px",padding:"0.75rem 1rem",cursor:"pointer",borderTop:`2px solid ${color}` }}>
            <div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"2px" }}>{s}</div>
            <div style={{ fontSize:"1.3rem",fontWeight:700,color,fontFamily:"'DM Mono',monospace" }}>{count}</div>
          </div>
        ); })}
      </div>

      {!readOnly && <InvoiceDropZone vendors={vendors} properties={properties} projects={projects} onConfirm={f=>onAddInvoice(f)}/>}

      {filtered.length===0 && <div style={{ background:"#14181f",border:"1px dashed #2a2f3d",borderRadius:"12px",padding:"3rem",textAlign:"center",color:"#4b5563",fontSize:"0.9rem" }}>{projects.length===0?"No projects yet.":"No projects match this filter."}</div>}

      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"1rem" }}>
        {filtered.map(p=>{
          const prop = properties.find(pr=>pr.id===p.propertyId);
          const tasks = p.tasks||[]; const done = tasks.filter(t=>t.status==="done").length;
          const pct = tasks.length>0?Math.round((done/tasks.length)*100):0;
          const color = PROJECT_STATUS_COLORS[p.status]||"#6b7280";
          const budget = tasks.reduce((s,t)=>s+Number(t.budget||0),0);
          const actual = tasks.reduce((s,t)=>s+Number(t.actual||0),0);
          return (
            <div key={p.id} onClick={()=>setView(p.id)} style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"12px",padding:"1.25rem",cursor:"pointer",borderTop:`3px solid ${color}` }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"0.5rem" }}>
                <div style={{ fontWeight:700,fontSize:"0.98rem",color:"#e8eaf0",flex:1,paddingRight:"0.5rem" }}>{p.name}</div>
                <Badge color={color} label={p.status}/>
              </div>
              {prop&&<div style={{ fontSize:"0.72rem",color:"#6b7280",marginBottom:"0.6rem",display:"flex",alignItems:"center",gap:"4px" }}><span style={{ width:"6px",height:"6px",borderRadius:"50%",background:prop.color,display:"inline-block" }}/>{prop.name}</div>}
              {p.description&&<p style={{ margin:"0 0 0.75rem",fontSize:"0.78rem",color:"#6b7280",lineHeight:1.4 }}>{p.description}</p>}
              {tasks.length>0&&<div style={{ marginBottom:"0.75rem" }}>
                <div style={{ display:"flex",justifyContent:"space-between",fontSize:"0.68rem",color:"#6b7280",marginBottom:"4px" }}><span>{done}/{tasks.length} tasks</span><span>{pct}%</span></div>
                <div style={{ height:"4px",background:"#1e2430",borderRadius:"99px",overflow:"hidden" }}><div style={{ height:"100%",width:`${pct}%`,background:pct===100?"#4a7c59":"#e07b39",borderRadius:"99px" }}/></div>
              </div>}
              {(budget>0||actual>0)&&<div style={{ display:"flex",gap:"1rem" }}>
                {budget>0&&<div><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase" }}>Budget</div><div style={{ fontSize:"0.88rem",fontWeight:600,color:"#e07b39",fontFamily:"'DM Mono',monospace" }}>{fmt(budget)}</div></div>}
                {actual>0&&<div><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase" }}>Actual</div><div style={{ fontSize:"0.88rem",fontWeight:600,color:actual>budget?"#f87171":"#4a7c59",fontFamily:"'DM Mono',monospace" }}>{fmt(actual)}</div></div>}
              </div>}
              {isAdmin&&p.ownerName&&<div style={{ marginTop:"0.5rem" }}><OwnerTag email={p.ownerEmail} name={p.ownerName}/></div>}
            </div>
          );
        })}
      </div>

      {showModal && !readOnly && (
        <Modal title="New Project" onClose={()=>setShowModal(false)} wide>
          <Field label="Project Name"><input style={inputStyle} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Kitchen Renovation"/></Field>
          <Field label="Description"><textarea style={{...inputStyle,resize:"vertical",minHeight:"60px"}} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="What's being done?"/></Field>
          <Grid2>
            <Field label="Property"><select style={inputStyle} value={form.propertyId} onChange={e=>setForm(f=>({...f,propertyId:e.target.value}))}><option value="">Select…</option>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Status"><select style={inputStyle} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{PROJECT_STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>
          </Grid2>
          <Grid2>
            <Field label="Start Date"><input style={inputStyle} type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))}/></Field>
            <Field label="Target End"><input style={inputStyle} type="date" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))}/></Field>
          </Grid2>
          <SectionDivider label="Attach Vendors (optional)"/>
          <div style={{ display:"flex",flexWrap:"wrap",gap:"0.4rem",marginBottom:"0.5rem" }}>
            {vendors.map(v=>{ const sel=(form.vendorIds||[]).includes(v.id); return (
              <button key={v.id} onClick={()=>setForm(f=>({...f,vendorIds:sel?f.vendorIds.filter(id=>id!==v.id):[...(f.vendorIds||[]),v.id]}))} style={{ fontSize:"0.78rem",padding:"4px 10px",borderRadius:"6px",border:`1px solid ${sel?"#e07b39":"#2a2f3d"}`,background:sel?"#e07b3922":"#1e2430",color:sel?"#e07b39":"#6b7280",cursor:"pointer",fontWeight:sel?600:400 }}>{v.name}</button>
            ); })}
          </div>
          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end",marginTop:"0.5rem" }}>
            <BtnSecondary onClick={()=>setShowModal(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={handleAdd}><Icon name="plus" size={13}/>Create Project</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Project Detail ───────────────────────────────────────────────────────────
function ProjectDetail({ project, projects, vendors, properties, invoices, readOnly, isAdmin, onUpdate, onDelete, onAddInvoice, onUpdateInvoice, onBack }) {
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [movingInvoice, setMovingInvoice] = useState(null);
  const blankTask = { title:"",type:TASK_TYPES[0],vendorId:"",status:"todo",budget:"",actual:"",notes:"",photos:[] };
  const [taskForm, setTaskForm] = useState(blankTask);
  const [lightbox, setLightbox] = useState(null);

  const live = projects.find(p=>p.id===project.id)||project;
  const tasks = live.tasks||[];
  const done = tasks.filter(t=>t.status==="done").length;
  const totalBudget = tasks.reduce((s,t)=>s+Number(t.budget||0),0);
  const totalActual = tasks.reduce((s,t)=>s+Number(t.actual||0),0);
  const prop = properties.find(p=>p.id===live.propertyId);
  const color = PROJECT_STATUS_COLORS[live.status]||"#6b7280";
  const attachedVendors = (live.vendorIds||[]).map(id=>vendors.find(v=>v.id===id)).filter(Boolean);
  const projectInvoices = invoices.filter(i=>i.projectId===live.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const invoiceTotal = projectInvoices.reduce((s,i)=>s+Number(i.amount),0);

  function saveTasksUpdate(newTasks) { onUpdate({ ...live, tasks:newTasks }); }
  function addTask() {
    if (!taskForm.title.trim()) return;
    saveTasksUpdate([...tasks,{...taskForm,id:uid()}]);
    setTaskForm(blankTask); setShowTaskModal(false);
  }
  function updateTask(t) { saveTasksUpdate(tasks.map(x=>x.id===t.id?t:x)); }
  function deleteTask(id) { if(!confirm("Delete task?"))return; saveTasksUpdate(tasks.filter(t=>t.id!==id)); }

  return (
    <div>
      {lightbox&&<div onClick={()=>setLightbox(null)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",cursor:"zoom-out" }}><img src={lightbox} alt="" style={{ maxWidth:"90vw",maxHeight:"90vh",borderRadius:"8px",objectFit:"contain" }}/></div>}

      <button onClick={onBack} style={{ display:"flex",alignItems:"center",gap:"6px",background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:"0.83rem",marginBottom:"1.25rem",padding:0 }}>
        <Icon name="arrowLeft" size={14}/>Back to Projects
      </button>

      <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"14px",padding:"1.5rem",marginBottom:"1.25rem",borderTop:`3px solid ${color}` }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"0.75rem",marginBottom:"0.75rem" }}>
          <div>
            <h2 style={{ margin:"0 0 0.25rem",fontSize:"1.2rem",fontWeight:700,color:"#e8eaf0" }}>{live.name}</h2>
            {prop&&<div style={{ fontSize:"0.78rem",color:"#6b7280",display:"flex",alignItems:"center",gap:"5px" }}><span style={{ width:"8px",height:"8px",borderRadius:"50%",background:prop.color,display:"inline-block" }}/>{prop.name}</div>}
          </div>
          <div style={{ display:"flex",gap:"0.5rem",alignItems:"center" }}>
            <Badge color={color} label={live.status}/>
            {!readOnly&&<BtnSecondary onClick={()=>setShowEditModal(true)}><Icon name="wrench" size={13}/>Edit</BtnSecondary>}
          </div>
        </div>
        {live.description&&<p style={{ margin:"0 0 1rem",fontSize:"0.85rem",color:"#94a3b8",lineHeight:1.5 }}>{live.description}</p>}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:"0.75rem",paddingTop:"0.75rem",borderTop:"1px solid #1e2430" }}>
          {[{l:"Tasks",v:`${done}/${tasks.length}`,c:"#3b6fa0"},{l:"Budget",v:fmt(totalBudget),c:"#e07b39"},{l:"Actual",v:fmt(totalActual),c:totalActual>totalBudget?"#f87171":"#4a7c59"},{l:"Over/Under",v:(totalBudget-totalActual>=0?"−":"+")+fmt(Math.abs(totalBudget-totalActual)),c:totalActual>totalBudget?"#f87171":"#4a7c59"},{l:"Invoices",v:fmt(invoiceTotal),c:"#8b5cf6"}].map(x=>(
            <div key={x.l}><div style={{ fontSize:"0.62rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:"2px" }}>{x.l}</div><div style={{ fontSize:"1rem",fontWeight:700,color:x.c,fontFamily:"'DM Mono',monospace" }}>{x.v}</div></div>
          ))}
        </div>
        {attachedVendors.length>0&&<div style={{ marginTop:"1rem",paddingTop:"0.75rem",borderTop:"1px solid #1e2430" }}>
          <div style={{ fontSize:"0.65rem",color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"0.4rem" }}>Vendors</div>
          <div style={{ display:"flex",flexWrap:"wrap",gap:"0.4rem" }}>{attachedVendors.map(v=><span key={v.id} style={{ fontSize:"0.75rem",background:"#1e2430",color:"#94a3b8",border:"1px solid #2a2f3d",borderRadius:"6px",padding:"2px 8px" }}>{v.name}</span>)}</div>
        </div>}
      </div>

      {/* Invoices linked to this project */}
      <div style={{ marginBottom:"1.5rem" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.75rem" }}>
          <div style={{ fontSize:"0.72rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em" }}>Invoices ({projectInvoices.length}) · {fmt(invoiceTotal)}</div>
        </div>
        {projectInvoices.length===0 ? (
          <div style={{ background:"#0d1117",border:"1px dashed #2a2f3d",borderRadius:"10px",padding:"1.25rem",textAlign:"center",color:"#4b5563",fontSize:"0.82rem" }}>No invoices linked to this project. Assign invoices from the Invoices tab.</div>
        ) : (
          <div style={{ background:"#14181f",border:"1px solid #1e2430",borderRadius:"10px",overflow:"hidden" }}>
            {projectInvoices.map((inv,idx)=>{
              const vend = vendors.find(v=>v.id===inv.vendorId);
              return (
                <div key={inv.id} style={{ display:"flex",alignItems:"center",padding:"0.75rem 1.25rem",borderBottom:idx<projectInvoices.length-1?"1px solid #1a1f2b":"none" }}>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.15rem" }}>
                      <span style={{ fontSize:"0.85rem",fontWeight:600,color:"#e8eaf0" }}>{vend?.name||"Unknown Vendor"}</span>
                      <span style={{ fontSize:"0.68rem",background:"#1e2430",color:"#6b7280",borderRadius:"4px",padding:"1px 6px" }}>{inv.category}</span>
                      {inv.fileUrl&&<a href={inv.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:"0.68rem",color:"#3b6fa0",display:"flex",alignItems:"center",gap:"2px",textDecoration:"none" }}><Icon name="file" size={10}/>View</a>}
                    </div>
                    <div style={{ fontSize:"0.72rem",color:"#6b7280" }}>{inv.date}{inv.description?" · "+inv.description:""}</div>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:"0.75rem",marginLeft:"1rem" }}>
                    <span style={{ fontFamily:"'DM Mono',monospace",fontSize:"0.95rem",fontWeight:700,color:"#e8eaf0" }}>{fmt(inv.amount)}</span>
                    {!readOnly&&onUpdateInvoice&&(
                      <button onClick={()=>setMovingInvoice(inv)} style={{ fontSize:"0.7rem",padding:"3px 8px",borderRadius:"5px",border:"1px solid #2a2f3d",background:"#1e2430",color:"#6b7280",cursor:"pointer",display:"flex",alignItems:"center",gap:"3px",whiteSpace:"nowrap" }}>
                        <Icon name="arrowLeft" size={10}/>Move
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem" }}>
        <div style={{ fontSize:"0.72rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em" }}>Tasks ({tasks.length})</div>
        {!readOnly&&<BtnPrimary onClick={()=>setShowTaskModal(true)}><Icon name="plus" size={13}/>Add Task</BtnPrimary>}
      </div>

      {tasks.length===0&&<div style={{ background:"#14181f",border:"1px dashed #2a2f3d",borderRadius:"10px",padding:"2.5rem",textAlign:"center",color:"#4b5563",fontSize:"0.85rem" }}>No tasks yet.</div>}

      {["in-progress","todo","done"].map(s=>{
        const group = tasks.filter(t=>(t.status||"todo")===s);
        if (!group.length) return null;
        const labels={todo:"To Do","in-progress":"In Progress",done:"Done"};
        const colors={todo:"#6b7280","in-progress":"#b45309",done:"#4a7c59"};
        return (
          <div key={s} style={{ marginBottom:"1.5rem" }}>
            <div style={{ fontSize:"0.68rem",fontWeight:700,color:colors[s],textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"0.5rem",display:"flex",alignItems:"center",gap:"6px" }}>
              <span style={{ width:"6px",height:"6px",borderRadius:"50%",background:colors[s],display:"inline-block" }}/>{labels[s]} · {group.length}
            </div>
            {group.map(task=>(
              <TaskCard key={task.id} task={task} vendors={vendors} readOnly={readOnly} onUpdate={updateTask} onDelete={deleteTask} onLightbox={setLightbox}/>
            ))}
          </div>
        );
      })}

      {showTaskModal&&!readOnly&&(
        <Modal title="Add Task" onClose={()=>setShowTaskModal(false)} wide>
          <Field label="Task Title"><input style={inputStyle} value={taskForm.title} onChange={e=>setTaskForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Replace roof shingles"/></Field>
          <Grid2>
            <Field label="Task Type"><select style={inputStyle} value={taskForm.type} onChange={e=>setTaskForm(f=>({...f,type:e.target.value}))}>{TASK_TYPES.map(t=><option key={t}>{t}</option>)}</select></Field>
            <Field label="Assigned Vendor"><select style={inputStyle} value={taskForm.vendorId} onChange={e=>setTaskForm(f=>({...f,vendorId:e.target.value}))}><option value="">None / TBD</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          </Grid2>
          <Grid2>
            <Field label="Budget ($)"><input style={inputStyle} type="number" value={taskForm.budget} onChange={e=>setTaskForm(f=>({...f,budget:e.target.value}))} placeholder="0"/></Field>
            <Field label="Actual Cost ($)"><input style={inputStyle} type="number" value={taskForm.actual} onChange={e=>setTaskForm(f=>({...f,actual:e.target.value}))} placeholder="0"/></Field>
          </Grid2>
          <Field label="Notes"><textarea style={{...inputStyle,resize:"vertical",minHeight:"64px"}} value={taskForm.notes} onChange={e=>setTaskForm(f=>({...f,notes:e.target.value}))} placeholder="Scope, instructions…"/></Field>
          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end" }}>
            <BtnSecondary onClick={()=>setShowTaskModal(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={addTask}><Icon name="plus" size={13}/>Add Task</BtnPrimary>
          </div>
        </Modal>
      )}

      {showEditModal&&!readOnly&&(
        <Modal title="Edit Project" onClose={()=>setShowEditModal(false)} wide>
          <Field label="Project Name"><input style={inputStyle} value={live.name} onChange={e=>onUpdate({...live,name:e.target.value})}/></Field>
          <Field label="Description"><textarea style={{...inputStyle,resize:"vertical",minHeight:"60px"}} value={live.description||""} onChange={e=>onUpdate({...live,description:e.target.value})}/></Field>
          <Grid2>
            <Field label="Property"><select style={inputStyle} value={live.propertyId||""} onChange={e=>onUpdate({...live,propertyId:e.target.value})}><option value="">Select…</option>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Status"><select style={inputStyle} value={live.status} onChange={e=>onUpdate({...live,status:e.target.value})}>{PROJECT_STATUSES.map(s=><option key={s}>{s}</option>)}</select></Field>
          </Grid2>
          <Grid2>
            <Field label="Start Date"><input style={inputStyle} type="date" value={live.startDate||""} onChange={e=>onUpdate({...live,startDate:e.target.value})}/></Field>
            <Field label="Target End"><input style={inputStyle} type="date" value={live.endDate||""} onChange={e=>onUpdate({...live,endDate:e.target.value})}/></Field>
          </Grid2>
          <SectionDivider label="Attached Vendors"/>
          <div style={{ display:"flex",flexWrap:"wrap",gap:"0.4rem",marginBottom:"1rem" }}>
            {vendors.map(v=>{ const sel=(live.vendorIds||[]).includes(v.id); return (
              <button key={v.id} onClick={()=>onUpdate({...live,vendorIds:sel?(live.vendorIds||[]).filter(id=>id!==v.id):[...(live.vendorIds||[]),v.id]})} style={{ fontSize:"0.78rem",padding:"4px 10px",borderRadius:"6px",border:`1px solid ${sel?"#e07b39":"#2a2f3d"}`,background:sel?"#e07b3922":"#1e2430",color:sel?"#e07b39":"#6b7280",cursor:"pointer",fontWeight:sel?600:400 }}>{v.name}</button>
            ); })}
          </div>
          <div style={{ display:"flex",gap:"0.75rem",justifyContent:"flex-end" }}>
            <BtnDanger onClick={async()=>{ if(!confirm("Delete project?"))return; await onDelete(live.id); setShowEditModal(false); onBack(); }}><Icon name="trash" size={13}/>Delete</BtnDanger>
            <BtnSecondary onClick={()=>setShowEditModal(false)}>Done</BtnSecondary>
          </div>
        </Modal>
      )}

      {/* Move Invoice modal */}
      {movingInvoice&&!readOnly&&onUpdateInvoice&&(
        <Modal title="Move Invoice to Project" onClose={()=>setMovingInvoice(null)}>
          <div style={{ marginBottom:"1rem",background:"#0d1117",border:"1px solid #1e2430",borderRadius:"8px",padding:"0.75rem 1rem" }}>
            <div style={{ fontSize:"0.85rem",fontWeight:600,color:"#e8eaf0" }}>{vendors.find(v=>v.id===movingInvoice.vendorId)?.name||"Invoice"}</div>
            <div style={{ fontSize:"0.75rem",color:"#6b7280" }}>{movingInvoice.date} · {fmt(movingInvoice.amount)}</div>
          </div>
          <Field label="Move to Project">
            <select style={inputStyle} defaultValue={movingInvoice.projectId||""}
              onChange={async e=>{
                await onUpdateInvoice({...movingInvoice, projectId:e.target.value||""});
                setMovingInvoice(null);
              }}>
              <option value="">— Remove from project —</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name}{p.id===live.id?" (current)":""}</option>)}
            </select>
          </Field>
          <div style={{ fontSize:"0.75rem",color:"#6b7280",marginTop:"-0.5rem" }}>Selecting a project moves the invoice immediately.</div>
        </Modal>
      )}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────
function TaskCard({ task, vendors, readOnly, onUpdate, onDelete, onLightbox }) {
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef();
  const vendor = vendors.find(v=>v.id===task.vendorId);
  const statusColor = { todo:"#6b7280","in-progress":"#b45309",done:"#4a7c59" }[task.status||"todo"];
  const statusLabel = { todo:"To Do","in-progress":"In Progress",done:"Done" }[task.status||"todo"];

  function cycleStatus() {
    if (readOnly) return;
    const cycle = { todo:"in-progress","in-progress":"done",done:"todo" };
    onUpdate({...task,status:cycle[task.status||"todo"]});
  }

  async function handlePhotos(e) {
    const files = Array.from(e.target.files);
    const uploaded = await Promise.all(files.map(async f => {
      try {
        const result = await uploadFile(f, "task-photos");
        return { id:Math.random().toString(36).slice(2,9), name:result.name, url:result.url, path:result.path };
      } catch(err) {
        console.error("Photo upload failed", err);
        return null;
      }
    }));
    const valid = uploaded.filter(Boolean);
    onUpdate({...task, photos:[...(task.photos||[]),...valid]});
  }

  return (
    <div style={{ background:"#0d1117",border:"1px solid #1e2430",borderRadius:"10px",marginBottom:"0.6rem",overflow:"hidden" }}>
      <div style={{ display:"flex",alignItems:"center",gap:"0.75rem",padding:"0.85rem 1rem",cursor:"pointer" }} onClick={()=>setExpanded(x=>!x)}>
        <button onClick={e=>{e.stopPropagation();cycleStatus();}} style={{ width:"20px",height:"20px",borderRadius:"50%",border:`2px solid ${statusColor}`,background:task.status==="done"?statusColor:"transparent",flexShrink:0,cursor:readOnly?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff" }}>
          {task.status==="done"&&<Icon name="check" size={10}/>}
        </button>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ display:"flex",alignItems:"center",gap:"0.5rem",flexWrap:"wrap" }}>
            <span style={{ fontSize:"0.88rem",fontWeight:600,color:task.status==="done"?"#4b5563":"#e8eaf0",textDecoration:task.status==="done"?"line-through":"none" }}>{task.title}</span>
            <span style={{ fontSize:"0.65rem",background:statusColor+"22",color:statusColor,border:`1px solid ${statusColor}44`,borderRadius:"99px",padding:"1px 7px",fontWeight:700,textTransform:"uppercase" }}>{statusLabel}</span>
            {task.type&&<span style={{ fontSize:"0.65rem",background:"#1e2430",color:"#6b7280",borderRadius:"4px",padding:"1px 6px" }}>{task.type}</span>}
          </div>
          <div style={{ fontSize:"0.72rem",color:"#6b7280",marginTop:"2px" }}>
            {vendor&&<span style={{ color:"#94a3b8" }}>{vendor.name} · </span>}
            {task.budget&&<span style={{ color:"#e07b39",fontFamily:"'DM Mono',monospace" }}>{fmt(task.budget)}</span>}
            {task.actual&&<span style={{ color:"#4a7c59",fontFamily:"'DM Mono',monospace" }}> / {fmt(task.actual)} actual</span>}
            {(task.photos||[]).length>0&&<span style={{ marginLeft:"6px",color:"#3b6fa0" }}>· {task.photos.length} photo{task.photos.length!==1?"s":""}</span>}
          </div>
        </div>
        <div style={{ color:"#4b5563",flexShrink:0,transition:"transform 0.2s",transform:expanded?"rotate(90deg)":"none" }}><Icon name="chevronRight" size={14}/></div>
      </div>

      {expanded&&(
        <div style={{ borderTop:"1px solid #1e2430",padding:"1rem" }}>
          {task.notes&&<p style={{ margin:"0 0 1rem",fontSize:"0.82rem",color:"#94a3b8",lineHeight:1.5 }}>{task.notes}</p>}
          <div style={{ fontSize:"0.7rem",fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"0.6rem" }}>Photos</div>
          <div style={{ display:"flex",flexWrap:"wrap",gap:"0.5rem",marginBottom:"0.75rem" }}>
            {(task.photos||[]).map(photo=>(
              <div key={photo.id} style={{ position:"relative",width:"72px",height:"72px",borderRadius:"8px",overflow:"hidden",border:"1px solid #2a2f3d",flexShrink:0 }}>
                <img src={photo.url||photo.dataUrl} alt={photo.name} style={{ width:"100%",height:"100%",objectFit:"cover",cursor:"zoom-in" }} onClick={()=>onLightbox(photo.url||photo.dataUrl)}/>
                {!readOnly&&<button onClick={async()=>{ await deleteFile(photo.path); onUpdate({...task,photos:(task.photos||[]).filter(p=>p.id!==photo.id)}); }} style={{ position:"absolute",top:"2px",right:"2px",background:"rgba(0,0,0,0.7)",border:"none",borderRadius:"50%",width:"18px",height:"18px",color:"#f87171",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0 }}><Icon name="x" size={10}/></button>}
              </div>
            ))}
            {!readOnly&&<label style={{ width:"72px",height:"72px",borderRadius:"8px",border:"1px dashed #2a2f3d",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#4b5563",gap:"4px",flexShrink:0 }}>
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={handlePhotos}/>
              <Icon name="image" size={16}/><span style={{ fontSize:"0.6rem",textAlign:"center",lineHeight:1.2 }}>Add<br/>Photo</span>
            </label>}
          </div>
          {!readOnly&&<div style={{ display:"flex",gap:"0.5rem",justifyContent:"flex-end" }}>
            <BtnDanger onClick={()=>onDelete(task.id)}><Icon name="trash" size={12}/>Delete</BtnDanger>
          </div>}
        </div>
      )}
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);      // all users (admin only)
  const [viewingAs, setViewingAs] = useState(null);  // admin impersonation
  const [tab, setTab] = useState("dashboard");

  const [properties, setProperties] = useState([]);
  const [tenants, setTenants]       = useState([]);
  const [vendors, setVendors]       = useState([]);
  const [invoices, setInvoices]     = useState([]);
  const [projects, setProjects]     = useState([]);

  const isAdmin = profile?.role === "admin";
  // The userId whose data we load (admin can switch viewingAs)
  const targetUserId = viewingAs ? viewingAs.id : session?.user?.id;

  // ── Auth listener ───────────────────────────────────────────
  useEffect(()=>{
    supabase.auth.getSession().then(({ data })=>setSession(data.session||null));
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((_,s)=>setSession(s));
    return ()=>subscription.unsubscribe();
  },[]);

  // ── Load profile + all profiles (admin) ─────────────────────
  useEffect(()=>{
    if (!session) { setProfile(null); setProfiles([]); return; }
    supabase.from("profiles").select("*").eq("id",session.user.id).single()
      .then(({ data })=>{ if(data) setProfile(data); });
  },[session]);

  useEffect(()=>{
    if (!isAdmin) return;
    supabase.from("profiles").select("*").then(({ data })=>{ if(data) setProfiles(data); });
  },[isAdmin]);

  // ── Load data whenever targetUserId changes ──────────────────
  const loadData = useCallback(async ()=>{
    if (!targetUserId) return;
    const uid = targetUserId;
    // For admin viewing another user, use views that bypass RLS
    const propTable = isAdmin && viewingAs ? "admin_all_properties" : "properties";
    const tenTable  = isAdmin && viewingAs ? "admin_all_tenants"    : "tenants";
    const invTable  = isAdmin && viewingAs ? "admin_all_invoices"   : "invoices";
    const projTable = isAdmin && viewingAs ? "admin_all_projects"   : "projects";

    const filter = isAdmin && viewingAs ? { column:"owner_id", value:uid } : null;

    async function q(table, mapper) {
      let query = supabase.from(table).select("*");
      if (filter) query = query.eq(filter.column, filter.value);
      const { data } = await query;
      return (data||[]).map(mapper);
    }

    const [props, tens, vends, invs, projs] = await Promise.all([
      q(propTable, rowToProperty),
      q(tenTable, rowToTenant),
      supabase.from("vendors").select("*").then(({data})=>(data||[]).map(rowToVendor)),
      q(invTable, rowToInvoice),
      q(projTable, rowToProject),
    ]);
    setProperties(props);
    setTenants(tens);
    setVendors(vends);
    setInvoices(invs);
    setProjects(projs);
  },[targetUserId, isAdmin, viewingAs]);

  useEffect(()=>{ loadData(); },[loadData]);

  // ── Backfill template projects for existing properties ───────
  useEffect(()=>{
    if (!session?.user?.id || properties.length===0 || projects===undefined) return;
    async function backfill() {
      const toCreate = [];
      for (const prop of properties) {
        for (const tmpl of GENERIC_PROJECT_TEMPLATES) {
          const already = projects.some(p=>p.propertyId===prop.id && p.name===tmpl.name);
          if (!already) toCreate.push({ prop, tmpl });
        }
      }
      if (toCreate.length===0) return;
      const created = await Promise.all(toCreate.map(async ({ prop, tmpl })=>{
        const { data } = await supabase.from("projects").insert({
          owner_id: prop.ownerId || session.user.id,
          property_id: prop.id,
          name: tmpl.name,
          description: tmpl.description,
          status: "In Progress",
          start_date: new Date().toISOString().slice(0,10),
          end_date: null,
          vendor_ids: [],
          tasks: []
        }).select().single();
        return data ? rowToProject(data) : null;
      }));
      const valid = created.filter(Boolean);
      if (valid.length) setProjects(p=>[...p,...valid]);
    }
    backfill();
  },[properties.length, projects.length, session?.user?.id]); // eslint-disable-line

  // ── CRUD helpers ─────────────────────────────────────────────
  async function addProperty(form) {
    const { data } = await supabase.from("properties").insert({ name:form.name,address:form.address,city:form.city,state:form.state,color:form.color,owner_id:session.user.id }).select().single();
    if (data) {
      setProperties(p=>[...p,rowToProperty(data)]);
      // Auto-create generic projects for this property
      const genericProjects = await Promise.all(GENERIC_PROJECT_TEMPLATES.map(async t=>{
        const { data:pd } = await supabase.from("projects").insert({ owner_id:session.user.id,property_id:data.id,name:t.name,description:t.description,status:"In Progress",start_date:new Date().toISOString().slice(0,10),end_date:null,vendor_ids:[],tasks:[] }).select().single();
        return pd ? rowToProject(pd) : null;
      }));
      const valid = genericProjects.filter(Boolean);
      if (valid.length) setProjects(p=>[...p,...valid]);
    }
  }
  async function updateProperty(form) {
    const { data } = await supabase.from("properties").update({ name:form.name,address:form.address,city:form.city,state:form.state,color:form.color }).eq("id",form.id).select().single();
    if (data) setProperties(p=>p.map(x=>x.id===data.id?rowToProperty(data):x));
  }
  async function deleteProperty(id) {
    await supabase.from("properties").delete().eq("id",id);
    setProperties(p=>p.filter(x=>x.id!==id));
  }

  async function addTenant(form) {
    const { data } = await supabase.from("tenants").insert({ owner_id:session.user.id,property_id:form.propertyId,name:form.name,email:form.email,phone:form.phone,unit:form.unit,lease_start:form.leaseStart||null,lease_end:form.leaseEnd||null,monthly_rent:form.monthlyRent||null,security_deposit:form.securityDeposit||null,notes:form.notes,contract_file_name:form.contractFileName }).select().single();
    if (data) setTenants(t=>[...t,rowToTenant(data)]);
  }
  async function updateTenant(form) {
    const { data } = await supabase.from("tenants").update({ property_id:form.propertyId,name:form.name,email:form.email,phone:form.phone,unit:form.unit,lease_start:form.leaseStart||null,lease_end:form.leaseEnd||null,monthly_rent:form.monthlyRent||null,security_deposit:form.securityDeposit||null,notes:form.notes }).eq("id",form.id).select().single();
    if (data) setTenants(t=>t.map(x=>x.id===data.id?rowToTenant(data):x));
  }
  async function deleteTenant(id) {
    await supabase.from("tenants").delete().eq("id",id);
    setTenants(t=>t.filter(x=>x.id!==id));
  }

  async function addVendor(form) {
    const { data } = await supabase.from("vendors").insert({ name:form.name,category:form.category,phone:form.phone,email:form.email,notes:form.notes,created_by:session.user.id }).select().single();
    if (data) setVendors(v=>[...v,rowToVendor(data)]);
  }
  async function updateVendor(form) {
    const { data } = await supabase.from("vendors").update({ name:form.name,category:form.category,phone:form.phone,email:form.email,notes:form.notes }).eq("id",form.id).select().single();
    if (data) setVendors(v=>v.map(x=>x.id===data.id?rowToVendor(data):x));
  }
  async function deleteVendor(id) {
    await supabase.from("vendors").delete().eq("id",id);
    setVendors(v=>v.filter(x=>x.id!==id));
  }

  async function addInvoice(form) {
    const { data } = await supabase.from("invoices").insert({ owner_id:session.user.id,property_id:form.propertyId||null,vendor_id:form.vendorId||null,project_id:form.projectId||null,category:form.category,amount:form.amount||null,date:form.date||null,description:form.description,file_name:form.fileName,file_url:form.fileUrl||null,file_path:form.filePath||null,invoice_number:form.invoiceNumber||null,recurring:form.recurring||"one-time" }).select().single();
    if (data) setInvoices(i=>[...i,rowToInvoice(data)]);
  }
  async function updateInvoice(form) {
    const { data } = await supabase.from("invoices").update({ property_id:form.propertyId||null,vendor_id:form.vendorId||null,project_id:form.projectId||null,category:form.category,amount:form.amount||null,date:form.date||null,description:form.description,recurring:form.recurring||"one-time",invoice_number:form.invoiceNumber||null,file_name:form.fileName||null,file_url:form.fileUrl||null,file_path:form.filePath||null }).eq("id",form.id).select().single();
    if (data) setInvoices(i=>i.map(x=>x.id===data.id?rowToInvoice(data):x));
  }
  async function deleteInvoice(id) {
    await supabase.from("invoices").delete().eq("id",id);
    setInvoices(i=>i.filter(x=>x.id!==id));
  }

  async function addProject(form) {
    const { data } = await supabase.from("projects").insert({ owner_id:session.user.id,property_id:form.propertyId||null,name:form.name,description:form.description,status:form.status,start_date:form.startDate||null,end_date:form.endDate||null,vendor_ids:form.vendorIds||[],tasks:form.tasks||[] }).select().single();
    if (data) setProjects(p=>[...p,rowToProject(data)]);
  }
  async function updateProject(form) {
    const { data } = await supabase.from("projects").update({ property_id:form.propertyId||null,name:form.name,description:form.description,status:form.status,start_date:form.startDate||null,end_date:form.endDate||null,vendor_ids:form.vendorIds||[],tasks:form.tasks||[] }).eq("id",form.id).select().single();
    if (data) setProjects(p=>p.map(x=>x.id===data.id?rowToProject(data):x));
  }
  async function deleteProject(id) {
    await supabase.from("projects").delete().eq("id",id);
    setProjects(p=>p.filter(x=>x.id!==id));
  }

  function handleRoleChange(userId, newRole) {
    setProfiles(p=>p.map(x=>x.id===userId?{...x,role:newRole}:x));
  }

  // ── Render ───────────────────────────────────────────────────
  if (session===undefined) return (
    <div style={{ background:"#0a0c12",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#6b7280",fontFamily:"sans-serif" }}>Loading…</div>
  );
  if (!session) return <AuthScreen onAuth={setSession}/>;

  const tabs = [
    { id:"dashboard", label:"Dashboard", icon:"chart" },
    { id:"properties", label:"Properties", icon:"home" },
    { id:"tenants", label:"Tenants", icon:"tenant" },
    { id:"vendors", label:"Vendors", icon:"users" },
    { id:"invoices", label:"Invoices", icon:"receipt" },
    { id:"projects", label:"Projects", icon:"wrench" },
    ...(isAdmin ? [{ id:"members", label:"Members", icon:"shield" }] : []),
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap');
        *{box-sizing:border-box;} body{margin:0;background:#0a0c12;}
        input,select,textarea{color-scheme:dark;}
        input:focus,select:focus,textarea:focus{outline:none;border-color:#e07b39!important;}
        ::-webkit-scrollbar{width:6px;} ::-webkit-scrollbar-track{background:#0d1117;} ::-webkit-scrollbar-thumb{background:#2a2f3d;border-radius:99px;}
        @keyframes spin{to{transform:rotate(360deg);}}
        /* Mobile bottom nav */
        .bottom-nav { display:none; }
        .top-nav-tabs { display:flex; }
        @media(max-width:768px){
          .bottom-nav { display:flex; position:fixed; bottom:0; left:0; right:0; background:#0d1117; border-top:1px solid #1e2430; z-index:200; padding-bottom:env(safe-area-inset-bottom); }
          .bottom-nav-item { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:8px 4px 6px; border:none; background:none; cursor:pointer; gap:3px; min-height:56px; }
          .bottom-nav-label { font-size:10px; font-weight:500; letter-spacing:0.02em; }
          .top-nav-tabs { display:none; }
          .top-nav-user { display:none; }
          .page-content { padding-bottom:80px !important; }
        }
      `}</style>
      <div style={{ fontFamily:"'DM Sans',sans-serif",background:"#0a0c12",minHeight:"100vh",color:"#e8eaf0" }}>

        {/* Top bar — desktop only */}
        <div style={{ background:"#0d1117",borderBottom:"1px solid #1e2430",padding:"0 1.5rem",display:"flex",alignItems:"center",height:"56px",position:"sticky",top:0,zIndex:100 }}>
          <div style={{ display:"flex",alignItems:"center",gap:"0.6rem",marginRight:"2rem",flexShrink:0 }}>
            <div style={{ width:"28px",height:"28px",background:"#e07b39",borderRadius:"7px",display:"flex",alignItems:"center",justifyContent:"center" }}><Icon name="home" size={14}/></div>
            <span style={{ fontWeight:700,fontSize:"0.95rem",color:"#e8eaf0" }}>PropTrack</span>
          </div>
          <nav className="top-nav-tabs" style={{ gap:"0.25rem",overflowX:"auto",flex:1 }}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ display:"flex",alignItems:"center",gap:"6px",background:tab===t.id?"#1e2430":"none",border:"none",color:tab===t.id?"#e8eaf0":"#6b7280",borderRadius:"7px",padding:"0.4rem 0.75rem",cursor:"pointer",fontSize:"0.83rem",fontWeight:tab===t.id?600:400,whiteSpace:"nowrap",flexShrink:0 }}>
                <Icon name={t.icon} size={14}/>{t.label}
              </button>
            ))}
          </nav>
          <div className="top-nav-user" style={{ display:"flex",alignItems:"center",gap:"0.75rem",marginLeft:"auto",flexShrink:0 }}>
            <span style={{ fontSize:"0.75rem",color:"#6b7280",display:"flex",alignItems:"center",gap:"4px" }}>
              {isAdmin&&<Icon name="shield" size={11}/>}{profile?.full_name||session.user.email}
            </span>
            <button onClick={()=>supabase.auth.signOut()} style={{ background:"none",border:"1px solid #2a2f3d",borderRadius:"6px",color:"#6b7280",cursor:"pointer",padding:"4px 8px",display:"flex",alignItems:"center",gap:"4px",fontSize:"0.75rem" }}>
              <Icon name="logout" size={12}/>Sign out
            </button>
          </div>
        </div>

        {/* Admin banner */}
        {isAdmin && profiles.filter(p=>p.role!=="admin").length>0 && (
          <AdminBanner profiles={profiles} viewingAs={viewingAs} setViewingAs={(p)=>{ setViewingAs(p); setTab("dashboard"); }}/>
        )}

        {/* Page content */}
        <div className="page-content" style={{ maxWidth:"980px",margin:"0 auto",padding:"1.75rem 1.25rem" }}>
          {tab==="dashboard"   && <Dashboard properties={properties} invoices={invoices} vendors={vendors} tenants={tenants} projects={projects} isAdmin={isAdmin} viewingAs={viewingAs}/>}
          {tab==="properties"  && <Properties properties={properties} isAdmin={isAdmin} viewingAs={viewingAs} onAdd={addProperty} onUpdate={updateProperty} onDelete={deleteProperty} invoices={invoices} tenants={tenants} projects={projects} vendors={vendors}/>}
          {tab==="tenants"     && <Tenants tenants={tenants} properties={properties} viewingAs={viewingAs} onAdd={addTenant} onUpdate={updateTenant} onDelete={deleteTenant}/>}
          {tab==="vendors"     && <Vendors vendors={vendors} isAdmin={isAdmin} invoices={invoices} properties={properties} projects={projects} onAdd={addVendor} onUpdate={updateVendor} onDelete={deleteVendor}/>}
          {tab==="invoices"    && <Invoices invoices={invoices} properties={properties} vendors={vendors} projects={projects} viewingAs={viewingAs} isAdmin={isAdmin} onAdd={addInvoice} onUpdate={updateInvoice} onDelete={deleteInvoice}/>}
          {tab==="projects"    && <Projects projects={projects} properties={properties} vendors={vendors} invoices={invoices} viewingAs={viewingAs} isAdmin={isAdmin} onAdd={addProject} onUpdate={updateProject} onDelete={deleteProject} onAddInvoice={addInvoice} onUpdateInvoice={updateInvoice}/>}
          {tab==="members"     && isAdmin && <MembersTab profiles={profiles} currentUser={profile} onRoleChange={handleRoleChange}/>}
        </div>

        {/* Mobile bottom nav */}
        <nav className="bottom-nav">
          {tabs.map(t=>(
            <button key={t.id} className="bottom-nav-item" onClick={()=>setTab(t.id)}
              style={{ color:tab===t.id?"#e07b39":"#4b5563" }}>
              <Icon name={t.icon} size={22}/>
              <span className="bottom-nav-label">{t.label}</span>
            </button>
          ))}
          {/* Sign out on mobile */}
          <button className="bottom-nav-item" onClick={()=>supabase.auth.signOut()}
            style={{ color:"#4b5563" }}>
            <Icon name="logout" size={22}/>
            <span className="bottom-nav-label">Sign out</span>
          </button>
        </nav>

      </div>
    </>
  );
}
