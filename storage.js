// Local-only vault. IMPORTANT: a 4-digit PIN is weak against offline guessing.
const DB_NAME='master-interview-v1';
const ITERATIONS=650000;
const E=new TextEncoder();const D=new TextDecoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const un64=s=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));
const random=n=>crypto.getRandomValues(new Uint8Array(n));
const enc=s=>E.encode(s);
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const txDone=t=>new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('Transaction aborted'))});
function openDB(){return new Promise((resolve,reject)=>{let r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{let d=r.result;d.createObjectStore('meta');d.createObjectStore('sealed')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
async function derive(pin,salt,iterations=ITERATIONS){
 const m=await crypto.subtle.importKey('raw',enc(pin),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function seal(key,data,id){const iv=random(12);const bytes=enc(JSON.stringify(data));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc('MST1:'+id)},key,bytes);return{iv:b64(iv),ct:b64(new Uint8Array(ct))};}
async function unseal(key,stored,id){let b=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(stored.iv),additionalData:enc('MST1:'+id)},key,un64(stored.ct));return JSON.parse(D.decode(b));}
const getOne=async(db,store,k)=>{let t=db.transaction(store,'readonly');return req(t.objectStore(store).get(k));};

// Validate DECRYPTED data before it may replace an existing local database. AES-GCM
// verifies ciphertext integrity, but validly-encrypted obsolete or malformed
// schema records must not be allowed to destroy working records on restore.
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const questionId=id=>typeof id==='string'&&/^(?:[1-9]|1[0-5])\.\d{2,}$/.test(id);
const assert=(ok,msg)=>{if(!ok)throw Error('Backup validation: '+msg)};
export function validateSnapshot(s){
 assert(isObject(s)&&s.schemaVersion===1,'unsupported schema');
 assert(s.mode==='individual'||s.mode==='complete','invalid backup mode');
 assert(isObject(s.entries),'missing record map');
 const entries=Object.entries(s.entries);
 assert(entries.length<=10000,'too many records');
 if(s.mode==='individual')assert(entries.length===1&&entries[0][0].startsWith('interview:'),'individual backup must contain exactly one interview');
 for(const [key,v] of entries){
  assert(typeof key==='string'&&key.length<200&&!['__proto__','constructor','prototype'].includes(key),'invalid record key');
  if(key.startsWith('interview:')){
   assert(isObject(v)&&typeof v.id==='string'&&v.id===key.slice(10),'interview ID mismatch');
   assert(v.schemaVersion===1&&(v.status==='Draft'||v.status==='Completed'),'invalid interview status/schema');
   assert(isObject(v.candidate)&&Array.isArray(v.contracts)&&v.contracts.length===3,'invalid candidate or contracts');
   assert(isObject(v.initial)&&Array.isArray(v.inspections)&&v.inspections.length===13,'invalid inspection data');
   assert(isObject(v.sections)&&Array.from({length:15},(_,i)=>i+1).every(i=>isObject(v.sections[i])&&typeof v.sections[i].comment==='string'&&typeof v.sections[i].grade==='string'),'invalid questionnaire sections');
   assert(isObject(v.interviewer)&&typeof v.remarks==='string','invalid remarks or interviewer');
  }else if(key==='bank'){
   assert(isObject(v)&&Array.isArray(v.questions)&&Array.isArray(v.archivedIds)&&isObject(v.revisions)&&isObject(v.reservedIds),'invalid bank structure');
   assert(v.questions.length<=10000&&v.archivedIds.length<=10000,'bank exceeds maximum size');
   assert(v.questions.every(q=>isObject(q)&&questionId(q.id)&&Number(q.section)===Number(q.id.split('.')[0])&&typeof q.text==='string'&&q.text.trim().length>=10&&q.text.length<=10000&&q.approved===true),'invalid question entry');
   assert(new Set(v.questions.map(q=>q.id)).size===v.questions.length,'duplicate active question IDs');
   assert(v.archivedIds.every(questionId),'invalid archived ID');
   if(v.activeOverrides!==undefined)assert(isObject(v.activeOverrides)&&Object.entries(v.activeOverrides).every(([id,active])=>questionId(id)&&typeof active==='boolean'),'invalid active override map');
   for(const [section,ids] of Object.entries(v.reservedIds))assert(/^(?:[1-9]|1[0-5])$/.test(section)&&Array.isArray(ids)&&ids.every(id=>questionId(id)&&id.startsWith(section+'.')),'invalid reserved ID list');
   for(const [id,history] of Object.entries(v.revisions))assert(questionId(id)&&Array.isArray(history)&&history.every(item=>isObject(item)&&item.id===id&&typeof item.text==='string'),'invalid revision history');
  }else if(key==='settings'){
   assert(isObject(v)&&typeof v.workerUrl==='string'&&typeof v.signatureDataUrl==='string','invalid local settings');
   assert(v.signatureDataUrl.length<=6000000,'oversized signature');
  }else throw Error('Backup validation: unexpected record key '+key.slice(0,60));
 }
 return s;
}

export class Vault {
 constructor(){this.db=null;this.key=null;this.failed=0;}
 async connect(){this.db=await openDB();return !!(await getOne(this.db,'meta','vault'));}
 get unlocked(){return !!this.key;}
 async setup(pin){if(!/^\d{4}$/.test(pin))throw Error('PIN must contain exactly four digits.');if(await getOne(this.db,'meta','vault'))throw Error('Vault already exists.');const salt=random(16),key=await derive(pin,salt);const verifier=await seal(key,{check:'MST_UNLOCK_V1'},'verifier');const t=this.db.transaction('meta','readwrite');t.objectStore('meta').put({salt:b64(salt),iterations:ITERATIONS,verifier,created:new Date().toISOString()},'vault');await txDone(t);this.key=key;}
 async unlock(pin){if(!/^\d{4}$/.test(pin))throw Error('Enter the 4-digit PIN.');if(this.failed>=5)await new Promise(r=>setTimeout(r,2500));const m=await getOne(this.db,'meta','vault');if(!m)throw Error('Vault not set up.');try{const key=await derive(pin,un64(m.salt),m.iterations);const check=await unseal(key,m.verifier,'verifier');if(check.check!=='MST_UNLOCK_V1')throw Error('Invalid PIN');this.key=key;this.failed=0;}catch(e){this.failed++;throw Error('Incorrect PIN or damaged vault.')}}
 lock(){this.key=null;}
 guard(){if(!this.key)throw Error('Vault is locked');}
 async get(id,defaultValue=null){this.guard();let v=await getOne(this.db,'sealed',id);return v?unseal(this.key,v,id):defaultValue;}
 async set(id,value){this.guard();const v=await seal(this.key,value,id);const t=this.db.transaction('sealed','readwrite');t.objectStore('sealed').put(v,id);await txDone(t);}
 async del(id){this.guard();const t=this.db.transaction('sealed','readwrite');t.objectStore('sealed').delete(id);await txDone(t);}
 async ids(){this.guard();const t=this.db.transaction('sealed','readonly');return req(t.objectStore('sealed').getAllKeys());}
 async snapshot(){this.guard();const ids=await this.ids();const entries={};for(const id of ids)entries[id]=await this.get(id);return{schemaVersion:1,bankRevision:'initial-source-partial',entries};}
 async writeMany(entries,replace=false){this.guard();let encrypted={};for(const [id,data] of Object.entries(entries))encrypted[id]=await seal(this.key,data,id);const t=this.db.transaction('sealed','readwrite');const o=t.objectStore('sealed');if(replace)o.clear();for(const [id,data] of Object.entries(encrypted))o.put(data,id);await txDone(t);}
 async createBackup(pin,mode='complete',selectedId){this.guard();await this.verifyPin(pin);let snapshot=await this.snapshot();if(mode==='individual'){const key='interview:'+selectedId;if(!snapshot.entries[key])throw Error('Interview not found');snapshot={schemaVersion:1,entries:{[key]:snapshot.entries[key]},mode:'individual'};}else snapshot.mode='complete';const salt=random(16),key=await derive(pin,salt),body=await seal(key,snapshot,'export');return{format:'MST-ENCRYPTED-JSON',version:1,mode,salt:b64(salt),iterations:ITERATIONS,created:new Date().toISOString(),body};}
 async readBackup(obj,pin){if(!obj||obj.format!=='MST-ENCRYPTED-JSON'||obj.version!==1)throw Error('Unsupported encrypted backup');if(!Number.isInteger(obj.iterations)||obj.iterations<100000||obj.iterations>3000000)throw Error('Backup validation: invalid KDF cost');if(typeof obj.salt!=='string'||obj.salt.length>100||!isObject(obj.body)||typeof obj.body.ct!=='string'||obj.body.ct.length>40000000)throw Error('Backup validation: invalid encrypted body');const key=await derive(pin,un64(obj.salt),obj.iterations);let data;try{data=await unseal(key,obj.body,'export')}catch(e){throw Error('Incorrect backup PIN or damaged file')};validateSnapshot(data);if(data.mode!==obj.mode)throw Error('Backup validation: mode mismatch');return data;}
 async verifyPin(pin){const m=await getOne(this.db,'meta','vault');const key=await derive(pin,un64(m.salt),m.iterations);try{let v=await unseal(key,m.verifier,'verifier');if(v.check!=='MST_UNLOCK_V1')throw 0;}catch{throw Error('Incorrect PIN.')}return true;}
 async changePin(oldPin,newPin){this.guard();await this.verifyPin(oldPin);if(!/^\d{4}$/.test(newPin))throw Error('New PIN must be four digits');const entries=(await this.snapshot()).entries;const salt=random(16),key=await derive(newPin,salt);const meta={salt:b64(salt),iterations:ITERATIONS,verifier:await seal(key,{check:'MST_UNLOCK_V1'},'verifier'),changed:new Date().toISOString()};const encrypted={};for(const [id,data] of Object.entries(entries))encrypted[id]=await seal(key,data,id);const t=this.db.transaction(['meta','sealed'],'readwrite');t.objectStore('meta').put(meta,'vault');let store=t.objectStore('sealed');store.clear();for(const [id,cipher] of Object.entries(encrypted))store.put(cipher,id);await txDone(t);this.key=key;}
}
export const vault=new Vault();
