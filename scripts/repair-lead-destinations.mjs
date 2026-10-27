// Review every linked conversation, including closed ones. --apply uses the same
// production classifiers and preserves manual fields. Each write has a rollback
// record and guards against edits/visit changes since the read.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import pg from "pg";
import { createHash } from "node:crypto";

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
const modules = new Map();
function load(relative) {
  const file = path.resolve(relative);
  if (modules.has(file)) return modules.get(file).exports;
  const loaded = { exports: {} }; modules.set(file, loaded);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {})((name) => load(name.startsWith('@/') ? 'src/' + name.slice(2) + '.ts' : path.join(path.dirname(file), name + '.ts')), loaded, loaded.exports);
  return loaded.exports;
}
const { inferConversationDestination } = load('src/lib/leads/destination.ts');
const { classifyConversationInquiry } = load('src/lib/leads/request-classification.ts');
const apply = process.argv.includes('--apply');
const offline = process.argv.includes('--offline');
if (apply && offline) throw Error('Apply requires fresh provider checks');
const db = new pg.Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
const root = path.resolve('output/classification-audit'); fs.mkdirSync(root,{recursive:true});
const output = path.join(root, `${apply?'apply':'review'}-${Date.now()}.json`);
const report = {mode:apply?'apply':'review',scanned:0,unchanged:0,manual:0,applied:0,conflicts:0,failures:[],changes:[]};
const save = () => fs.writeFileSync(output,JSON.stringify(report,null,2));
const base = process.env.TELETEL_BASE_URL.replace(/\/+$/,'');
async function get(suffix) {
  let last;
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const r=await fetch(`${base}/api/v1/accounts/${process.env.TELETEL_ACCOUNT_ID||'1'}${suffix}`,{headers:{api_access_token:process.env.TELETEL_API_TOKEN},signal:AbortSignal.timeout(20000)});
      if (!r.ok) { if(r.status===404) throw Error('not_found'); throw Error(`HTTP ${r.status}`); }
      return await r.json();
    } catch (e) { last=e; if(e.message==='not_found') break; if(attempt<2) await new Promise(r=>setTimeout(r,1500*(attempt+1))); }
  }
  throw last;
}
async function read(row) {
  const file=path.join(root, `${row.teletel_conversation_id}.json`);
  const cached=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  if (offline) { if(!cached) throw Error('no_cache'); return cached; }
  const [first,conv]=await Promise.all([get(`/conversations/${row.teletel_conversation_id}/messages`),get(`/conversations/${row.teletel_conversation_id}`)]);
  const fingerprint=createHash('sha256').update(JSON.stringify(first.payload)).digest('hex');
  const cachedFingerprint=cached?.fingerprint?.length===64?cached.fingerprint:cached?.fingerprint?createHash('sha256').update(cached.fingerprint).digest('hex'):null;
  if (cachedFingerprint===fingerprint) {
    const data={...cached,fingerprint,labels:labels(conv)};
    fs.writeFileSync(file,JSON.stringify(data)); return data;
  }
  let batch=first.payload;
  if (!Array.isArray(batch)) throw Error('invalid_payload');
  const messages=[]; let before=null,complete=false;
  for(let page=0;page<200;page++) {
    if(!batch.length){complete=true;break;}
    messages.push(...batch.filter(m=>m.message_type!==2&&!m.private).map(m=>({id:m.id,at:m.created_at,text:m.content||'',fromClient:m.message_type===0,isPrivate:false})));
    const oldest=Math.min(...batch.map(m=>m.id));
    if(oldest===before) throw Error('repeated_cursor');
    before=oldest;
    batch=(await get(`/conversations/${row.teletel_conversation_id}/messages?before=${oldest}`)).payload;
    if(!Array.isArray(batch)) throw Error('invalid_payload');
  }
  if(!complete) throw Error('incomplete_history');
  const data={messages,labels:labels(conv),fingerprint};
  fs.writeFileSync(file,JSON.stringify(data)); return data;
}
function labels(conv){ const c=conv.meta?.sender?.custom_attributes??{};return [c.service_type_list,c.service_type,...(conv.labels??[])].filter(v=>typeof v==='string'); }
try {
  await db.connect();
  if(apply) await db.query(`update public.integrations set used_by=concat_ws('؛ ',used_by,'مراجعة وتصحيح تصنيف المحادثات المفتوحة والمغلقة: scripts/repair-lead-destinations.mjs'),updated_at=now() where check_key='teletel' and coalesce(used_by,'') not like '%repair-lead-destinations.mjs%'`);
  const places=(await db.query(`select arabic_name as name,arabic_name as country,array_remove(array[english_name],null) as aliases from countries union all select c.arabic_name,coalesce(p.arabic_name,''),array_remove(array[c.english_name],null) from cities c left join countries p on p.id=c.country_id`)).rows;
  const rows=(await db.query(`select id,teletel_conversation_id,destination,destination_source,inquiry,inquiry_source,last_visit_at,created_at from client_leads where teletel_conversation_id is not null order by created_at desc`)).rows;
  const limit=process.argv.find(a=>a.startsWith('--limit=')); const selected=limit?rows.slice(0,Number(limit.split('=')[1])):rows;
  console.log(JSON.stringify({eligible:selected.length,report:output}));
  for(let start=0;start<selected.length;start+=4){
    await Promise.all(selected.slice(start,start+4).map(async row=>{
      report.scanned++;
      if(row.destination_source==='manual'&&row.inquiry_source==='manual'){report.manual++;return;}
      try {
        const thread=await read(row); const since=Date.parse(row.last_visit_at??row.created_at)/1000;
        const inferred=inferConversationDestination(thread.messages,places,since);
        const destination=row.destination_source==='manual'?row.destination:inferred.destination;
        const inquiry=row.inquiry_source==='manual'?row.inquiry:classifyConversationInquiry(thread.messages,places,since,thread.labels,row.destination_source==='manual'?row.destination:null);
        if(destination===row.destination&&inquiry===row.inquiry){report.unchanged++;return;}
        const change={id:row.id,conversation:row.teletel_conversation_id,before:{destination:row.destination,inquiry:row.inquiry,destination_source:row.destination_source,inquiry_source:row.inquiry_source},after:{destination,inquiry},evidenceId:inferred.evidenceId,ambiguous:inferred.ambiguous,applied:false};
        report.changes.push(change);save();
        if(apply){
          const r=await db.query(`update client_leads set destination=$1,inquiry=$2,destination_source=case when destination_source='manual' then destination_source else 'client' end,inquiry_source=case when inquiry_source='manual' then inquiry_source else 'auto' end,updated_at=now() where id=$3 and destination is not distinct from $4 and inquiry is not distinct from $5 and destination_source is not distinct from $6 and inquiry_source is not distinct from $7 and last_visit_at is not distinct from $8 returning id`,[destination,inquiry,row.id,row.destination,row.inquiry,row.destination_source,row.inquiry_source,row.last_visit_at]);
          change.applied=r.rowCount===1;if(change.applied)report.applied++;else report.conflicts++;
        }
      } catch(e){report.failures.push({id:row.id,conversation:row.teletel_conversation_id,reason:e.message});}
    }));
    save();if(start%40===0)console.log(JSON.stringify({scanned:report.scanned,changes:report.changes.length,applied:report.applied,failed:report.failures.length}));
  }
  save();console.log(JSON.stringify({...report,changes:report.changes.length,failures:report.failures.length,report:output}));
} finally{await db.end();}
