const sectionNums=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
export class QuestionBank {
 constructor(seed,custom){
  this.seed=seed;
  const c=custom&&typeof custom==='object'?custom:{};
  this.custom={questions:Array.isArray(c.questions)?c.questions:[],archivedIds:Array.isArray(c.archivedIds)?c.archivedIds:[],revisions:c.revisions&&typeof c.revisions==='object'?c.revisions:{},reservedIds:c.reservedIds&&typeof c.reservedIds==='object'?c.reservedIds:{},activeOverrides:c.activeOverrides&&typeof c.activeOverrides==='object'?c.activeOverrides:{},guidance:c.guidance&&typeof c.guidance==='object'&&!Array.isArray(c.guidance)?c.guidance:{}};
  this.seedIds=new Set(seed.questions.map(q=>q.id));
  this.seedDefaults=new Map(seed.questions.map(q=>[q.id,q]));
  this.sourceRejectedIds=new Set(seed.rejectedIds||[]);
 }
 allApproved(){
  const overridden=new Map((this.custom.questions||[]).map(q=>[q.id,q]));
  const old=this.seed.questions.map(q=>({...q,...(overridden.get(q.id)||{}),active:q.active!==false}));
  return [...old,...this.custom.questions.filter(q=>!this.seedIds.has(q.id))]
   .filter(q=>q.approved===true&&!this.sourceRejectedIds.has(q.id));
 }
 isActive(id){
  if((this.custom.archivedIds||[]).includes(id))return false;
  const q=this.allApproved().find(x=>x.id===id);if(!q)return false;
  const override=this.custom.activeOverrides[id];
  return typeof override==='boolean'?override:q.active!==false;
 }
 all(){const archived=new Set(this.custom.archivedIds||[]);const overrides=this.custom.activeOverrides;return this.allApproved().filter(q=>!archived.has(q.id)&&(typeof overrides[q.id]==='boolean'?overrides[q.id]:q.active!==false));}
 inactive(){return this.allApproved().filter(q=>!this.isActive(q.id));}
 bySection(n){return this.all().filter(q=>q.section===Number(n));}
 random(n,exclude){const a=this.bySection(n).filter(q=>q.id!==exclude);return a.length?a[Math.floor(Math.random()*a.length)]:null;}
 count(){return this.all().length;}
 approvedCount(){return this.allApproved().length;}
 isReserved(id){const section=id.split('.')[0];return (this.seed.reservedIds?.[section]||[]).includes(id)||(this.custom.reservedIds?.[section]||[]).includes(id);}
 nextId(n){const used=[...(this.seed.reservedIds?.[n]||[]),...(this.custom.reservedIds?.[n]||[])];let max=Math.max(0,...used.map(id=>Number(id.split('.')[1])));return `${n}.${String(max+1).padStart(2,'0')}`;}
 validate(item,revision=false){if(!sectionNums.includes(Number(item.section)))throw Error('Unknown bank section');if(!new RegExp('^'+item.section+'\\.\\d{2,}$').test(item.id||''))throw Error('Invalid Question ID: '+item.id);if(!item.text||item.text.trim().length<10)throw Error('Question text is too short');const existing=this.allApproved().find(q=>q.id===item.id);if(revision&&!existing)throw Error('Question to revise does not exist');if(!revision&&(existing||this.isReserved(item.id)))throw Error('Question ID has already been used or reserved: '+item.id);}
 async addApproved(items,reconcile=false){
  if(!Array.isArray(items)||!items.length)throw Error('No questions');const seen=new Set();
  for(const q of items){if(this.sourceRejectedIds.has(q.id))throw Error('Question ID was explicitly rejected in the source decisions: '+q.id);if(reconcile){if(!sectionNums.includes(Number(q.section))||!new RegExp('^'+q.section+'\\.\\d{2,}$').test(q.id||'')||!(q.text||'').trim())throw Error('Invalid question entry '+q.id);if(this.allApproved().some(x=>x.id===q.id))throw Error('Question already approved '+q.id);}else this.validate(q);if(seen.has(q.id))throw Error('Duplicate ID in import: '+q.id);seen.add(q.id);}
  for(const q of items){const becomesActive=this.count()<this.seed.targetApprovedCount;this.custom.questions.push({...q,section:Number(q.section),text:q.text.trim(),revision:1,approved:true,active:becomesActive,addedAt:new Date().toISOString()});const sec=String(q.section);(this.custom.reservedIds[sec]??=[]).push(q.id);}
 }
 revise(id,newText){let q=this.allApproved().find(q=>q.id===id);if(!q)throw Error('Question not found');if(!newText||newText.trim().length<10)throw Error('New text too short');const normalized=s=>String(s).normalize('NFC').replace(/\s+/gu,' ').trim();if(normalized(newText)===normalized(q.text))throw Error('Question wording has not changed. A new revision is not permitted for identical wording.');(this.custom.revisions[id]??=[]).push({...q,archivedAt:new Date().toISOString()});const copy={...q,text:newText.trim(),revision:Number(q.revision||1)+1};const n=this.custom.questions.findIndex(x=>x.id===id);if(n<0)this.custom.questions.push(copy);else this.custom.questions[n]=copy;}
 archive(id){if(!this.allApproved().some(q=>q.id===id))throw Error('Question not found');if(!this.custom.archivedIds.includes(id))this.custom.archivedIds.push(id);}
 setActive(id,active){
  if(typeof active!=='boolean')throw Error('Activity status must be boolean');
  if(!this.allApproved().some(q=>q.id===id))throw Error('Approved Question ID not found: '+id);
  if(active&&this.custom.archivedIds.includes(id))throw Error('Archived Question requires a controlled unarchive decision');
  if(this.isActive(id)===active)return;
  if(active&&this.count()>=this.seed.targetApprovedCount)throw Error('The 609 Active limit is reached. Deactivate another question first.');
  this.custom.activeOverrides[id]=active;
 }
}
// Normalize the actual approved-selection files generated during review.
// Never promote rejected, pending, working, or otherwise unapproved source entries.
// A bare array without status is permitted only after a separate explicit owner
// confirmation in the UI. The original source file is retained in metadata.
export function normalizeApprovedRegister(raw,{allowUnmarked=false,source='Owner approved register'}={}){
 const kind=Array.isArray(raw)?'owner-array':raw&&typeof raw==='object'&& !Array.isArray(raw)?'selection-file':null;
 if(!kind)throw Error('Register must be a JSON array or a recognized selection JSON object');
 let items;
 if(Array.isArray(raw))items=raw;
 else items=raw.questions??raw.question_entries??raw.supplement_6_51_to_6_75;
 if(!Array.isArray(items))throw Error('Register has no questions, question_entries, or supplement_6_51_to_6_75 list');
 if(items.length>5000)throw Error('Register contains too many questions');
 const baseSection=Number(raw?.section_number??(String(raw?.section??'').match(/^\d+/)?.[0])??NaN);
 const approved=[],omitted=[],seen=new Set();
 for(let k=0;k<items.length;k++){
  const q=items[k];if(!q||typeof q!=='object'||Array.isArray(q))throw Error(`Invalid question entry ${k+1}`);
  const section=Number(q.section??baseSection);
  const id=String(q.id??(Number.isInteger(q.number)&&Number.isInteger(section)?`${section}.${String(q.number).padStart(2,'0')}`:'')).trim();
  const decision=String(q.status??q.decision??(q.approved===true?'approved':q.approved===false?'rejected':'')).trim().toLowerCase();
  const explicitApproved=decision==='approved';
  if(!explicitApproved && !(kind==='owner-array'&&allowUnmarked&&decision==='')){
   omitted.push({id:id||`index:${k+1}`,reason:decision||'no explicit approved decision'});
   continue;
  }
  const txt=q.text??q.question;
  if(!Number.isInteger(section)||section<1||section>15)throw Error('Missing/invalid section for approved Question '+id);
  if(!new RegExp('^'+section+'\\.\\d{2,}$').test(id))throw Error('Missing/invalid approved Question ID '+id);
  if(typeof txt!=='string'||txt.trim().length<10||txt.length>10000)throw Error('Missing/invalid approved wording for '+id);
  if(seen.has(id))throw Error('Duplicate approved Question ID in file: '+id);
  seen.add(id);
  approved.push({id,section,text:txt.trim(),approved:true,source:String(source).slice(0,150)});
 }
 return {approved,omitted,kind,total:items.length};
}

export function auditQuestionBank(bank,sections){
 const s=Array.isArray(sections)?sections:[];
 const approvedCounts={1:68,2:32,3:38,4:28,5:50,6:37,7:37,8:40,9:34,10:70,11:50,12:50,13:50,14:50,15:24};
 const rows=s.map(x=>({formNo:x.formNo,bankSection:x.bankSection,competency:x.title,historicalApproved:approvedCounts[x.bankSection],approvedWithText:bank.allApproved().filter(q=>q.section===x.bankSection).length,activeForRandom:bank.bySection(x.bankSection).length,inactive:bank.inactive().filter(q=>q.section===x.bankSection).length}));
 return {format:'MASTER-INTERVIEW-QUESTION-BANK-AUDIT',version:2,formRevision:'Rev.2 / 11-2026',bankRevision:bank.seed.revision,targetActiveCount:609,approvedCount:bank.approvedCount(),activeCount:bank.count(),inactiveCount:bank.inactive().length,rows,inactiveApprovedQuestions:bank.inactive().map(q=>({id:q.id,section:q.section,text:q.text})),approvedQuestions:bank.allApproved().map(q=>({...q,active:bank.isActive(q.id)})),reservedIds:Object.fromEntries(Array.from({length:15},(_,i)=>String(i+1)).map(k=>[k,[...new Set([...(bank.seed.reservedIds?.[k]||[]),...(bank.custom.reservedIds?.[k]||[])])]])),sourceProvenance:'308 saved-source files + 325 historical-conversation reconstructions + 25 owner-approved IMSBC supplement questions derived from the 2016 INTERCARGO guide; 24 original inactive IDs approved 2026-11-05; 25 new IMSBC questions Approved/Inactive 2026-11-10; verify current IMSBC Code requirements prior to relying on guidance.',warning:'Four-digit PIN is vulnerable to offline guessing; encrypted backups are not high-assurance confidentiality.'};
}

export async function getSeed(){const [seed,sections]=await Promise.all([fetch('./bank-seed.json',{cache:'no-store'}).then(x=>x.json()),fetch('./sections.json',{cache:'no-store'}).then(x=>x.json())]);return{seed,sections};}
