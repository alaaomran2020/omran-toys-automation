import { WorkflowEntrypoint } from "cloudflare:workers";
const respond = (body,status=200) => Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const txt = v => String(v ?? "").trim();
function constantTime(a,b) {
  const x=new TextEncoder().encode(txt(a)), y=new TextEncoder().encode(txt(b));
  if(!x.length||x.length!==y.length) return false;
  let diff=0; for(let i=0;i<x.length;i++) diff |= x[i]^y[i]; return diff===0;
}
const auth=(r,e)=>!!txt(e.ADMIN_API_TOKEN)&&constantTime(e.ADMIN_API_TOKEN,(r.headers.get("authorization")||"").replace(/^Bearer\s+/i,""));
const imageUrl=v=>!v||(()=>{try{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password&&v.length<=2048;}catch{return false;}})();
const num=(v,integer=false)=>v==null||v===""?null:(Number.isFinite(Number(v))&&Number(v)>=0&&(!integer||Number.isSafeInteger(Number(v)))?Number(v):NaN);
async function body(r) {
  if(Number(r.headers.get("content-length")||0)>32768) throw new Error("PAYLOAD_TOO_LARGE");
  if(!r.body) throw new Error("EMPTY_BODY");
  const rd=r.body.getReader(), chunks=[]; let count=0;
  while(true){const {done,value}=await rd.read();if(done)break;count+=value.length;if(count>32768){await rd.cancel();throw new Error("PAYLOAD_TOO_LARGE");}chunks.push(value);}
  const bytes=new Uint8Array(count);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function audit(db,key,id,action) {
  await db.prepare("INSERT OR IGNORE INTO audit_log(event_key,draft_id,action) VALUES(?,?,?)").bind(key,id,action).run();
}
async function intake(env,item) {
  const id=crypto.randomUUID();
  const r=await env.DB.prepare("INSERT OR IGNORE INTO drafts(id,source,source_event_id,name,category,image_url,telegram_file_id,notes,price,quantity) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(id,item.source,item.event||null,item.name,item.category,item.image,item.file||"",item.notes,item.price,item.quantity).run();
  if(!r.meta.changes) {
    const old=await env.DB.prepare("SELECT id FROM drafts WHERE source_event_id=?").bind(item.event).first();
    return {id:old?.id,duplicate:true};
  }
  try{await env.INTAKE.create({id:"intake-"+id,params:{id}});}
  catch(e){await env.DB.prepare("UPDATE drafts SET status='PROCESSING_ERROR' WHERE id=?").bind(id).run();throw e;}
  return {id,duplicate:false};
}
export class IntakeWorkflow extends WorkflowEntrypoint {
  async run(event,step){
    const id=event.payload.id;
    await step.do("validate and queue",async()=>{
      const r=await this.env.DB.prepare("SELECT * FROM drafts WHERE id=?").bind(id).first();
      if(!r) throw new Error("DRAFT_NOT_FOUND");
      const missing=[];
      if(!r.name)missing.push("name");
      if(!r.category)missing.push("category");
      if(!r.image_url)missing.push("verified_image_url");
      if(r.price===null)missing.push("price");
      if(r.quantity===null)missing.push("quantity");
      await this.env.DB.prepare("UPDATE drafts SET status='NEEDS_REVIEW',review_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='RECEIVED'")
        .bind(missing.length?"MISSING:"+missing.join(","):"ADMIN_REVIEW_REQUIRED",id).run();
      await audit(this.env.DB,"validated-"+id,id,"QUEUED_FOR_REVIEW");
      return {id};
    });
  }
}
export class CatalogPreviewWorkflow extends WorkflowEntrypoint {
  async run(event,step){
    const id=event.payload.id;
    await step.do("stage preview only - never publish",async()=>{
      const r=await this.env.DB.prepare("SELECT * FROM drafts WHERE id=?").bind(id).first();
      if(!r||r.status!=="APPROVED"||r.qa_status!=="PASS"||r.image_verified!==1||
         !r.name||!r.category||!r.image_url||r.price===null||r.quantity===null)
        throw new Error("APPROVAL_GATE_BLOCKED");
      await this.env.DB.prepare("INSERT OR IGNORE INTO catalog_preview(id,name,category,price,quantity,image_url,status) VALUES(?,?,?,?,?,?,'STAGED_ONLY')")
        .bind(id,r.name,r.category,r.price,r.quantity,r.image_url).run();
      await audit(this.env.DB,"staged-"+id,id,"CATALOG_STAGED_ONLY");
      return {id,published:false};
    });
  }
}
async function handle(req,env) {
  const path=new URL(req.url).pathname;
  if(path==="/health"&&req.method==="GET")return respond({ok:true,service:"omran-automation-staging",mode:"review-only",published:false});
  if(path==="/api/telegram/webhook"&&req.method==="POST"){
    const allowed=txt(env.TELEGRAM_ALLOWED_CHAT_IDS).split(",").map(txt).filter(Boolean);
    if(!txt(env.TELEGRAM_WEBHOOK_SECRET)||!allowed.length||
       !constantTime(env.TELEGRAM_WEBHOOK_SECRET,req.headers.get("x-telegram-bot-api-secret-token")))
      return respond({ok:false,error:"FORBIDDEN"},403);
    const b=await body(req),m=b.message||{};
    if(!allowed.includes(String(m.chat?.id||"")))return respond({ok:true,ignored:true});
    if(!Number.isSafeInteger(b.update_id)||!Array.isArray(m.photo)||!m.photo.length)return respond({ok:true,ignored:true});
    const file=txt(m.photo[m.photo.length-1]?.file_id);
    if(!file)return respond({ok:true,ignored:true});
    const x=await intake(env,{source:"TELEGRAM",event:"telegram:"+b.update_id,name:"",category:"",image:"",file,notes:txt(m.caption).slice(0,1500),price:null,quantity:null});
    return respond({ok:true,draft_id:x.id,duplicate:x.duplicate});
  }
  if(!auth(req,env))return respond({ok:false,error:"UNAUTHORIZED"},401);
  if(path==="/api/intake"&&req.method==="POST"){
    const b=await body(req),image=txt(b.image_url),price=num(b.price),quantity=num(b.quantity,true);
    if(!imageUrl(image)||Number.isNaN(price)||Number.isNaN(quantity)||![b.name,b.notes,image].some(v=>txt(v))||
       txt(b.name).length>180||txt(b.category).length>100)return respond({ok:false,error:"INVALID_INPUT"},400);
    const x=await intake(env,{source:"API",name:txt(b.name),category:txt(b.category),image,notes:txt(b.notes).slice(0,1500),price,quantity});
    return respond({ok:true,draft_id:x.id,published:false},202);
  }
  if(path==="/api/drafts"&&req.method==="GET"){
    const r=await env.DB.prepare("SELECT id,source,name,category,image_url,notes,price,quantity,status,qa_status,image_verified,review_reason,created_at FROM drafts ORDER BY created_at DESC LIMIT 50").all();
    return respond({ok:true,drafts:r.results});
  }
  if(path==="/api/catalog-preview"&&req.method==="GET"){
    const r=await env.DB.prepare("SELECT * FROM catalog_preview ORDER BY created_at DESC LIMIT 50").all();
    return respond({ok:true,publish_enabled:false,items:r.results});
  }
  if(path==="/api/audit"&&req.method==="GET"){
    const r=await env.DB.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50").all();
    return respond({ok:true,events:r.results});
  }
  if(path==="/api/update"&&req.method==="POST"){
    const b=await body(req),id=txt(b.id),image=txt(b.image_url),price=num(b.price),quantity=num(b.quantity,true);
    if(!id||!imageUrl(image)||Number.isNaN(price)||Number.isNaN(quantity)||txt(b.name).length>180||txt(b.category).length>100)
      return respond({ok:false,error:"INVALID_INPUT"},400);
    const old=await env.DB.prepare("SELECT image_url FROM drafts WHERE id=? AND status='NEEDS_REVIEW'").bind(id).first();
    if(!old)return respond({ok:false,error:"NOT_EDITABLE"},409);
    const changed=image!==old.image_url;
    const r=await env.DB.prepare("UPDATE drafts SET name=?,category=?,image_url=?,price=?,quantity=?,image_verified=CASE WHEN ? THEN 0 ELSE image_verified END,review_reason='ADMIN_EDIT',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='NEEDS_REVIEW'")
      .bind(txt(b.name),txt(b.category),image,price,quantity,changed?1:0,id).run();
    if(!r.meta.changes)return respond({ok:false,error:"CONFLICT"},409);
    await audit(env.DB,"edit-"+crypto.randomUUID(),id,"ADMIN_EDIT");
    return respond({ok:true,reverify_image:changed});
  }
  if(path==="/api/verify-image"&&req.method==="POST"){
    const b=await body(req),id=txt(b.id);
    if(b.verified!==true)return respond({ok:false,error:"EXPLICIT_VERIFICATION_REQUIRED"},400);
    const r=await env.DB.prepare("UPDATE drafts SET image_verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='NEEDS_REVIEW' AND image_url<>''").bind(id).run();
    if(!r.meta.changes)return respond({ok:false,error:"NOT_VERIFIABLE"},409);
    await audit(env.DB,"image-"+crypto.randomUUID(),id,"ADMIN_VERIFIED_IMAGE");
    return respond({ok:true,image_verified:true});
  }
  if(path==="/api/decision"&&req.method==="POST"){
    const b=await body(req),id=txt(b.id),decision=txt(b.decision).toUpperCase();
    if(!id||!["APPROVE","REJECT"].includes(decision))return respond({ok:false,error:"INVALID_DECISION"},400);
    const r=await env.DB.prepare("SELECT * FROM drafts WHERE id=? AND status='NEEDS_REVIEW'").bind(id).first();
    if(!r)return respond({ok:false,error:"NOT_PENDING"},409);
    if(decision==="APPROVE"&&(!r.image_verified||!r.image_url||!r.name||!r.category||r.price===null||r.quantity===null))
      return respond({ok:false,error:"QA_OR_REQUIRED_FIELDS_MISSING"},409);
    const state=decision==="APPROVE"?"APPROVED":"REJECTED";
    const changed=await env.DB.prepare("UPDATE drafts SET status=?,qa_status=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='NEEDS_REVIEW'")
      .bind(state,state==="APPROVED"?"PASS":"REJECTED",id).run();
    if(!changed.meta.changes)return respond({ok:false,error:"CONFLICT"},409);
    await audit(env.DB,"decision-"+id,id,"ADMIN_"+state);
    if(state==="APPROVED"){
      try{await env.CATALOG.create({id:"preview-"+id,params:{id}});}
      catch{return respond({ok:true,status:state,preview:"RETRY_REQUIRED",published:false},202);}
    }
    return respond({ok:true,status:state,published:false});
  }
  return respond({ok:false,error:"NOT_FOUND"},404);
}
export default {async fetch(req,env){
  try{return await handle(req,env);}
  catch(e){const error=e instanceof SyntaxError?"INVALID_JSON":e?.message==="PAYLOAD_TOO_LARGE"?"PAYLOAD_TOO_LARGE":"INTERNAL_ERROR";
    if(error==="INTERNAL_ERROR")console.error("Staging automation failure:",e?.message);
    return respond({ok:false,error},error==="INTERNAL_ERROR"?500:400);
  }
}};
