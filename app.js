import {vault,validateSnapshot} from './storage.js';
import {getSeed,QuestionBank,normalizeApprovedRegister,auditQuestionBank} from './bank.js';
import {buildPDF} from './pdf.js?v=RC10';
const $=s=>document.querySelector(s),app=$('#app');
const text=s=>String(s??'');
const h=s=>text(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const attr=h;
const notify=(s,bad=false)=>{const t=$('#toast');t.textContent=s;t.style.background=bad?'#a4333d':'#132f42';t.classList.remove('hidden');clearTimeout(notify.t);notify.t=setTimeout(()=>t.classList.add('hidden'),5500)};
const dateNow=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const grades=['','Excellent','Very Good','Good','Satisfactory','Below Satisfactory'];
const inspectionNames=['Paris MOU, Tokyo MOU, USCG','Rightship, IDWAL','ISM / ISPS / MLC audit','Classification attendance','Dry Dock experience','Delivery of newbuilding','Ice Navigation Experience','Ballast Management / BWTS','Anchorage Loading / STS','Grain Loading / NCB Survey','BLUCODE','Self-pilotage','Familiar with e-log'];
const aFields=[['shipType','Ship Type Experience'],['tradingArea','Trading Area Experience'],['cargo','Cargo Experience'],['mixedCrew','Mixed Crew Experience'],['english','Spoken English / Practical Scenarios']];
const navs=[['home','All Interviews'],['candidate','Candidate Details'],['contracts','Last Three Contracts'],['initial','A. Initial Assessment'],['inspection','B. Inspection Experience'],['questionnaire','C. Questionnaire'],['conclusion','D. Conclusion'],['remarks','E. Remarks / AI'],['bank','Question Bank'],['backup','Backup / Restore'],['settings','Settings']];
let state={ready:false,initialized:false,tab:'home',interview:null,bank:null,sections:null,settings:{workerUrl:'',signatureDataUrl:''},aiDraft:'',modal:null,archiveSection:1,openedQ:null,selectedBankId:'',bankSection:2,saveTimer:null,renderSerial:0,busy:false,openGuidanceFormNo:null,editGuidanceFormNo:null};
let printPdf=null,printUrl=null,printFilename='',printAnnex=false,printError='',previewGeneration=0;
function status(section){return section?.comment?.trim()&&section?.grade?'Complete':section?.comment?.trim()||section?.grade?'Partial':'Not Assessed'}
function badge(s){return `<span class="badge ${s==='Complete'?'complete':s==='Partial'?'partial':s==='Completed'?'closed':'missing'}">${h(s)}</span>`}
// Update Section C completion counters without destroying the currently focused input.
// Replacing app.innerHTML synchronously inside a select/change event can cause DOM
// removal errors and lost keystrokes in some browsers.
function updateProgressIndicators(){
 if(!state.interview||state.tab!=='questionnaire')return;
 const total=state.sections.filter(s=>status(state.interview.sections[s.formNo])==='Complete').length;
 const count=$('.content .metric strong');if(count)count.textContent=`${total} / 15`;
 const nav=$('.sectionMark');if(nav)nav.textContent=`${total}/15`;
 for(const sec of state.sections){
  const head=document.querySelector(`[data-expand="${sec.formNo}"]`),indicator=head?.querySelector('.badge');
  if(!indicator)continue;const st=status(state.interview.sections[sec.formNo]);
  indicator.textContent=st;
  indicator.className='badge '+(st==='Complete'?'complete':st==='Partial'?'partial':'missing');
 }
}

function fileName(i){const c=i.candidate||{};const slug=s=>text(s).trim().replace(/\s+/g,'_').replace(/[^A-Za-z0-9_-]/g,'')||'Unknown';return `${slug(c.rank||'Master')}_${slug(c.name||'Candidate')}_${slug(c.date||dateNow())}.pdf`}
function control(label,path,value,type='text',extras=''){return `<div class="field"><label>${h(label)}</label><input type="${type}" data-path="${attr(path)}" value="${attr(value??'')}" ${extras}></div>`}
function area(label,path,value,rows=3){return `<div class="field"><label>${h(label)}</label><textarea data-path="${attr(path)}" rows="${rows}">${h(value)}</textarea></div>`}
function selection(label,path,value,opts){return `<div class="field"><label>${h(label)}</label><select data-path="${attr(path)}">${opts.map(([v,t])=>`<option value="${attr(v)}" ${String(v)===String(value||'')?'selected':''}>${h(t)}</option>`).join('')}</select></div>`}
function newInterview(){const now=new Date().toISOString(),sections={};for(const sec of state.sections){const q=state.bank.random(sec.bankSection);sections[sec.formNo]={questionId:q?.id||'',questionText:q?.text||'',questionRevision:q?.revision||null,comment:'',grade:''};}return {id:crypto.randomUUID(),createdAt:now,updatedAt:now,status:'Draft',schemaVersion:1,candidate:{date:dateNow(),rank:'Master',name:'',idNumber:'',vessel:''},contracts:[{company:'',vessel:'',rankPeriod:''},{company:'',vessel:'',rankPeriod:''},{company:'',vessel:'',rankPeriod:''}],initial:{shipType:'',tradingArea:'',cargo:'',mixedCrew:'',english:''},inspections:inspectionNames.map(()=>({choice:'',comments:''})),sections,acceptable:'',remarks:'',purpose:'',method:'',interviewer:{name:'Capt. Roman Fedorov',position:'HSEQ / Marine Superintendent',date:dateNow()}};}
function formTab(){const i=state.interview,c=i?.candidate||{};switch(state.tab){
case 'home':return home();
case 'candidate':return `<h1>Candidate Details</h1><p class="lead">Form 001 MST — Original candidate information</p><section class="panel"><div class="grid">${control('Interview date','candidate.date',c.date,'date')}${control('Vessel','candidate.vessel',c.vessel)}${control('Rank','candidate.rank',c.rank)}${control('Candidate name','candidate.name',c.name)}${control('ID number','candidate.idNumber',c.idNumber)}</div></section><div class="notice">Candidate name, personal ID and named vessels are excluded from AI requests.</div>`;
case 'contracts':return `<h1>Previous Experience</h1><p class="lead">Last three contracts — exact original form fields</p>${i.contracts.map((x,j)=>`<section class="panel"><h2>Contract ${j+1}</h2><div class="grid three">${control('Company name',`contracts.${j}.company`,x.company)}${control('Vessel name / Vessel type',`contracts.${j}.vessel`,x.vessel)}${control('Rank / Period in months',`contracts.${j}.rankPeriod`,x.rankPeriod)}</div></section>`).join('')}`;
case 'initial':return `<h1>A. Initial Assessment</h1><p class="lead">Professional experience and communication</p><section class="panel">${aFields.map(([key,label])=>`<div style="margin-bottom:15px">${area(label,'initial.'+key,i.initial[key],2)}</div>`).join('')}</section>`;
case 'inspection':return `<h1>B. Inspection Experience</h1><p class="lead">Original inspection types and experience comments</p><section class="panel">${inspectionNames.map((name,j)=>`<div class="formrow"><div class="title">${j+1}. ${h(name)}</div>${selection('Experience',`inspections.${j}.choice`,i.inspections[j]?.choice,[['','—'],['yes','Yes'],['no','No']])}${area('Comments',`inspections.${j}.comments`,i.inspections[j]?.comments,2)}</div>`).join('')}</section>`;
case 'questionnaire':return questionnaire();
case 'conclusion':return `<h1>D. Conclusion</h1><p class="lead">Candidate Acceptable — manual decision only, not AI-generated</p><section class="panel"><div class="grid">${selection('Candidate Acceptable','acceptable',i.acceptable,[['','Not selected'],['yes','YES'],['no','NO']])}</div><p class="muted">Free Completion: the interview may be marked Completed even when this field remains empty.</p></section>`;
case 'remarks':return remarks();
case 'bank':return bankView();
case 'backup':return backupView();
case 'settings':return settingsView();
}return home();}
function home(){let all=state.interviews||[];const done=all.filter(x=>x.status==='Completed').length;const bank=state.bank;return `<h1>Master Interview</h1><p class="lead">Form 001 MST · Rev.2 / 11-2026 · Personal interview workspace</p><div class="metrics"><div class="metric"><strong>${all.length}</strong>Interviews</div><div class="metric"><strong>${done}</strong>Completed</div><div class="metric"><strong>${bank.count()} / 609</strong>Active Questions</div><div class="metric"><strong>${bank.inactive().length}</strong>Approved / Inactive</div></div>${bank.count()!==609||bank.approvedCount()!==633?`<div class="notice">Bank currently has ${bank.count()} active and ${bank.approvedCount()} approved in total. Owner-approved initial baseline: 609 Active / 24 Inactive (633 Approved).</div>`:''}<div class="row" style="margin:20px 0"><button data-action="new">+ New Interview</button><button class="secondary" data-action="backup">Encrypted Backup</button></div><div class="cards">${all.length?all.map(x=>`<div class="itemCard" data-open="${attr(x.id)}"><h3>${h((x.candidate?.rank||'Master')+' '+(x.candidate?.name||'Unnamed Candidate'))}</h3><p>${h(x.candidate?.date||'No date')} · ${h(x.id.slice(0,8))}</p>${badge(x.status||'Draft')}<p style="margin-top:11px">Updated ${h(new Date(x.updatedAt).toLocaleString())}</p></div>`).join(''):'<div class="panel">No interviews yet. Select New Interview.</div>'}</div>`}
const auditorFields=[['expectedAnswer','Expected Answer / Must-have Points'],['acceptableAlternatives','Acceptable Alternatives'],['suggestedFollowUp','Suggested Follow-up'],['criticalRedFlags','Critical Red Flags']];
function guidanceFor(v){
 const g=state.bank.custom.guidance?.[v.questionId];
 // Match both immutable ID and full original wording. Question revisions must
 // be individually revalidated; never silently display unrelated guidance.
 const current=state.bank.allApproved().find(q=>q.id===v.questionId);
 const match=!!g&&!!current&&g.questionText===v.questionText&&g.questionRevision===Number(v.questionRevision||1)&&current.text===v.questionText&&Number(current.revision||1)===Number(v.questionRevision||1);
 return {g,match};
}
function auditorGuidance(formNo,v){
 const open=state.openGuidanceFormNo===formNo, {g,match}=guidanceFor(v);
 return `<div class="auditorTools"><button type="button" class="secondary" data-guidance-toggle="${formNo}" aria-expanded="${open}">${open?'Hide':'Show'} Auditor Guidance ${match?'(available)':g?'(needs revision check)':'(not available)'}</button><span class="tiny muted">Auditor only · never printed · stored encrypted locally</span></div>${open?`<div class="auditorGuidance" data-guidance-for="${formNo}"><h3>Auditor Answer Guidance — ${h(v.questionId)}</h3>${match?auditorFields.map(([key,label])=>`<div class="guidanceField"><strong>${h(label)}</strong><p>${h(g[key]||'Not supplied')}</p></div>`).join(''):`<p class="notice">${g?'The question wording/revision has changed; previous guidance cannot be used until reviewed.':'No verified answer guidance is linked to this exact Question ID yet.'} The original 105-question reference file uses different IDs and wording and cannot be mapped automatically.</p>`}<div class="row"><button class="secondary" type="button" data-guidance-edit="${formNo}">${state.editGuidanceFormNo===formNo?'Cancel editing':'Edit / Add private guidance'}</button></div>${state.editGuidanceFormNo===formNo?`<div class="auditorGuidanceEditor"><p class="muted tiny">Owner-entered guidance is for reference only; verify against current rules, SMS, equipment and voyage context. No AI generation is involved.</p>${auditorFields.map(([key,label])=>`<div class="field"><label>${h(label)}</label><textarea rows="3" data-guidance-field="${key}">${h(g?.[key]||'')}</textarea></div>`).join('')}<div class="row"><button type="button" data-guidance-save="${formNo}">Save Guidance (encrypted locally)</button></div></div>`:''}</div>`:''}`;
}
function questionnaire(){
 const i=state.interview,complete=state.sections.filter(s=>status(i.sections[s.formNo])==='Complete').length;
 return `<h1>C. Questionnaire</h1><p class="lead">One selected question per competency. Open a row to read the question, then select Show Auditor Guidance for private expected-answer notes. Official Comments and Assessment remain manual.</p><div class="row spread"><div class="metric"><strong>${complete} / 15</strong>Complete assessments</div><p class="muted tiny">The indicators are shown only in the PWA, never in the PDF.</p></div>${state.sections.map(s=>{
  const v=i.sections[s.formNo]||{},q=state.bank.bySection(s.bankSection),st=status(v),expanded=state.openedQ===s.formNo;
  const wording=v.questionText||'Import the exact approved questions for this section to activate random selection.';
  return `<div class="qrow"><div class="qhead" data-expand="${s.formNo}" role="button" tabindex="0" aria-expanded="${expanded?'true':'false'}" aria-label="${attr(s.title)}: ${expanded?'collapse':'expand'} question details"><span class="num">${s.formNo}</span><div class="subject"><div class="qsection-title">${h(s.title)}</div><div class="tiny muted">${h(v.questionId||'No verified approved question available')} · Bank section ${s.bankSection}</div>${expanded?'':`<div class="qsummary"><strong>${h(v.questionId||'Missing question')}</strong> ${h(wording)}</div>`}</div>${badge(st)}<span class="qchevron" aria-hidden="true">${expanded?'▴':'▾'}</span></div>${expanded?`<div class="qbody"><div class="qtext"><strong>${h(v.questionId||'Missing question')}</strong> ${h(wording)}</div><div class="qtools" style="margin:14px 0"><button class="secondary" data-reroll="${s.formNo}" ${q.length<2?'disabled':''}>↻ Reroll</button><button class="secondary" data-question-picker="${s.formNo}">Choose question — full text…</button><span class="muted tiny">${q.length} Active questions in pool</span></div>${auditorGuidance(s.formNo,v)}<div class="grid">${area('Comments on reply (manual)',`sections.${s.formNo}.comment`,v.comment,4)}${selection('Final Assessment (manual)',`sections.${s.formNo}.grade`,v.grade,grades.map(x=>[x,x||'Not assessed']))}</div><p class="tiny muted">Replacing the selected question clears the comment and grade for this competency only.</p></div>`:''}</div>`;
 }).join('')}`;
}

// Native <select> controls cannot reliably display long maritime interview questions:
// the prior release also cut the option text at 100 characters. This accessible
// search-and-pick dialog displays the entire approved wording without truncation.
function openQuestionPicker(formNo){
 const sec=state.sections.find(x=>x.formNo===formNo);
 if(!sec||!state.interview)return;
 const questions=state.bank.bySection(sec.bankSection);
 const currentId=state.interview.sections[formNo]?.questionId;
 document.querySelector('#questionPickerOverlay')?.remove();
 const overlay=document.createElement('div');
 overlay.id='questionPickerOverlay';overlay.className='modalBackdrop';
 overlay.innerHTML=`<div class="modal questionPicker" role="dialog" aria-modal="true" aria-labelledby="questionPickerTitle"><div class="row spread"><h2 id="questionPickerTitle">Choose Question — Section ${formNo}</h2><button type="button" class="secondary" data-picker-close>✕ Close</button></div><p class="muted">${h(sec.title)} · ${questions.length} Active questions. Complete original wording is shown below; select one question only.</p><label class="field" for="questionPickerSearch"><span class="fieldCaption">Search by Question ID or full wording</span><input id="questionPickerSearch" type="search" autocomplete="off" placeholder="Search ID or question text…"></label><p id="pickerCount" class="tiny muted" role="status"></p><div id="questionPickerResults" class="questionPickerResults"></div><p class="muted tiny">Choosing a different question clears that section's existing comments and grade. All other sections are unchanged.</p></div>`;
 document.body.appendChild(overlay);
 const results=overlay.querySelector('#questionPickerResults');
 const search=overlay.querySelector('#questionPickerSearch');
 const update=()=>{
  const terms=search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches=questions.filter(q=>terms.every(t=>(q.id+' '+q.text).toLocaleLowerCase().includes(t)));
  overlay.querySelector('#pickerCount').textContent=`${matches.length} of ${questions.length} available questions`;
  results.innerHTML=matches.length?matches.map(q=>`<button type="button" class="questionChoice ${q.id===currentId?'isSelected':''}" data-pick-question="${attr(q.id)}" aria-label="Select question ${attr(q.id)}"><span class="questionChoiceMeta">${h(q.id)}${q.id===currentId?' · CURRENTLY SELECTED':''}</span><span class="questionChoiceText">${h(q.text)}</span></button>`).join(''):'<p class="muted">No matching approved questions. Try another search term.</p>';
 };
 search.addEventListener('input',update);
 const close=()=>{overlay.remove();document.querySelector(`[data-question-picker="${formNo}"]`)?.focus();};
 overlay.addEventListener('click',e=>{
  if(e.target===overlay||e.target.closest('[data-picker-close]')){close();return;}
  const pick=e.target.closest('[data-pick-question]');
  if(pick){const id=pick.dataset.pickQuestion;overlay.remove();switchQuestion(formNo,id);}
 });
 overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}});
 update();search.focus();
}
function remarks(){const i=state.interview,draft=state.aiDraft;return `<h1>E. Remarks / AI Conclusion</h1><p class="lead">Official Remarks are editable. AI output is optional and must be accepted manually.</p><section class="panel">${area('E. REMARKS (official PDF content)','remarks',i.remarks,5)}<p class="muted tiny">Only accepted AI text is saved. The unaccepted draft is temporary and disappears on closing the interview.</p></section><section class="panel"><h2>AI-Assisted Professional Conclusion</h2><div class="row"><button data-action="generate-ai">${draft?'Regenerate':'Generate AI Conclusion'}</button><button class="secondary" data-action="accept-ai" ${draft?'':'disabled'}>Accept Conclusion</button></div>${draft?`<div style="margin-top:15px">${area('Unaccepted draft — editable','@aiDraft',draft,5)}<p class="muted">${draft.trim().split(/\s+/).length} words · target 40–70</p></div>`:'<div class="notice">AI requires a configured Cloudflare Worker in Settings. Your interview is not sent until you select Generate.</div>'}</section><section class="panel"><h2>Completed by / Signature</h2><div class="grid">${control('Name','interviewer.name',i.interviewer.name)}${control('Position','interviewer.position',i.interviewer.position)}${control('Date','interviewer.date',i.interviewer.date,'date')}${selection('Interview purpose','purpose',i.purpose,[['','Not specified'],['newcomer','Newcomer'],['promotion','Promotion']])}${selection('Interview method','method',i.method,[['','Not specified'],['office','Office: face to face'],['camera','Web Camera'],['telephone','Telephone']])}</div><p class="muted tiny">The private signature appears in the right side of the Completed by table, with no separate Signature label, only when Completed by Name is exactly Capt. Roman Fedorov. Upload it privately in Settings.</p></section>`;}
function bankView(){
 const bank=state.bank,section=state.bankSection;
 const rows=bank.allApproved().filter(q=>q.section===section),missing=state.sections.filter(s=>!bank.bySection(s.bankSection).length).map(s=>s.formNo);
 const selected=bank.allApproved().find(q=>q.id===state.selectedBankId);
 return `<h1>Question Bank</h1><p class="lead">Question Bank R1 · 633 Approved · 609 Active · 24 Owner-approved Inactive</p><div class="metrics"><div class="metric"><strong>${bank.count()} / 609</strong>Active for random selection</div><div class="metric"><strong>${bank.approvedCount()}</strong>Approved with wording</div><div class="metric"><strong>${bank.inactive().length}</strong>Approved / Inactive</div><div class="metric"><strong>${15-missing.length} / 15</strong>Populated pools</div></div>${missing.length?`<div class="notice error">Missing active pools for Form Sections: ${missing.join(', ')}.</div>`:''}<section class="panel"><h2>Coverage across 15 original form sections</h2><p class="muted tiny">Only Active questions participate in random selection. The 24 Inactive records remain Approved with preserved immutable IDs and wording.</p><div class="coverage-grid">${state.sections.map(s=>`<div class="coverage-row"><span>${h(s.formNo+' — '+s.title)}</span><strong>${bank.bySection(s.bankSection).length} active / ${bank.allApproved().filter(q=>q.section===s.bankSection).length} approved</strong></div>`).join('')}</div><div class="row" style="margin-top:15px"><button class="secondary" data-action="bank-audit">Download Question Bank Audit (.json)</button></div></section><section class="panel"><h2>Approved questions by bank section</h2><div class="grid">${selection('Bank section','@bankSection',String(section),state.sections.slice().sort((a,b)=>a.bankSection-b.bankSection).map(s=>[String(s.bankSection),s.bankSection+' — '+s.title]))}<div class="field"><label>Current section</label><div class="metric"><strong>${bank.bySection(section).length} Active / ${rows.length} Approved</strong></div></div></div><div style="max-height:380px;overflow:auto;margin-top:16px">${rows.map(q=>`<div class="formrow" style="grid-template-columns:75px 1fr auto"><strong>${h(q.id)}</strong><div>${h(q.text)} <span class="muted tiny">(Rev.${q.revision||1}; ${bank.isActive(q.id)?'Active':'Inactive'})</span></div><button class="secondary" data-bank-select="${attr(q.id)}">Manage</button></div>`).join('')}</div></section><section class="panel"><h2>Import previously approved questions</h2><p class="muted">All 633 reviewed source entries are already in Question Bank R1. Importing additional previously approved source records retains their original IDs. New entries will remain Inactive while the 609 Active limit is full. Identical records are skipped.</p><div class="field"><label>Upload approved question register (.json) — or paste below</label><input id="bankFile" type="file" accept=".json,application/json"></div><textarea id="bankJson" rows="7" placeholder='[{"id":"2.04","section":2,"text":"Exact previously approved English question wording…"}]'></textarea><div class="row" style="margin-top:12px"><label class="checkline"><input id="approvedImport" type="checkbox"> I confirm every imported question was previously approved by the owner.</label><button data-action="bank-import">Validate & Import Approved Records</button></div></section><section class="panel"><h2>Private Auditor Guidance Library</h2><p class="muted">Expected Answer, Acceptable Alternatives, Suggested Follow-up and Critical Red Flags are kept in the local encrypted Question Bank record. Guidance is NOT published on GitHub Pages, not included in PDF/Annex and not sent to AI. Only guidance entries tied to an exact approved ID and original question wording can be imported.</p><div class="row"><div class="metric"><strong>${Object.keys(state.bank.custom.guidance||{}).length}</strong>Private guidance entries</div><button class="secondary" data-action="guidance-template">Download JSON Template (633 IDs, empty answer fields)</button></div><div class="field"><label>Import locally reviewed answer guidance (.json)</label><input type="file" id="guidanceFile" accept=".json,application/json"></div><div class="row" style="margin-top:12px"><button data-action="guidance-import">Validate & Import Private Guidance</button></div><p class="muted tiny">Only local-encrypted Complete Backup includes these notes. Individual Interview Backup excludes the guidance library.</p></section><section class="panel"><h2>Add a new approved question</h2><div class="grid">${control('Proposed next unused ID','@newId',bank.nextId(section),'text','readonly')}${area('Full English wording','@newText','',3)}</div><div class="row" style="margin-top:12px"><label class="checkline"><input type="checkbox" id="newApproved"> Owner has explicitly approved this question.</label><button data-action="new-question">Add Approved Question</button></div><p class="muted tiny">When 609 Active places are occupied, additional Approved questions start Inactive until a deliberate Owner-approved swap.</p></section>${selected?`<section class="panel"><h2>Manage question ${h(state.selectedBankId)}</h2><p>Approval: <strong>Approved</strong> · Random pool: <strong>${bank.isActive(selected.id)?'Active':'Inactive'}</strong></p>${area('New wording for approved revision','@revisionText',selected.text,4)}<div class="row" style="margin-top:12px"><button data-action="revise-question">Approve New Revision</button><button class="secondary" data-action="toggle-question-active">${bank.isActive(selected.id)?'Set Inactive':'Activate (if space)'}</button><button class="danger" data-action="archive-question">Archive / Exclude from Future Selection</button></div><p class="muted tiny">Changing the active pool never alters existing interview snapshots. Activating at 609 requires deactivating another question first. Archived questions require separate controlled restoration.</p></section>`:''}`;
}
function backupView(){return `<h1>Encrypted Backup / Restore</h1><p class="lead">Individual or Complete JSON backup using the same four-digit PIN</p><div class="notice error"><strong>Security limitation:</strong> a 4-digit PIN has only 10,000 combinations. Copied encrypted backups can be brute-forced offline. This is not strong protection for confidential candidate records.</div><section class="panel"><h2>Export Encrypted JSON</h2><div class="grid">${selection('Export mode','@exportMode',state.exportMode||'complete',[['complete','Complete Backup — all interviews and local bank'],['individual','Individual Interview — current interview']])}<div class="field"><label>Current interview</label><p>${h(state.interview?.candidate?.name||'None selected')}</p></div></div><div class="row" style="margin-top:12px"><button data-action="backup-export">Export Encrypted JSON</button></div></section><section class="panel"><h2>Import Encrypted JSON</h2><div class="field"><label>Select a .json backup file</label><input id="importJsonFile" type="file" accept=".json,application/json"></div><div class="grid" style="margin-top:13px">${selection('Import method','@importMode',state.importMode||'merge',[['merge','Merge with Existing Data'],['full','Full Restore — replace all local data']])}</div><div class="row" style="margin-top:14px"><button data-action="backup-import">Decrypt, Validate & Import</button></div><p class="muted tiny">On Interview ID collision: Replace Existing, Import as Copy, or Cancel. Full Restore preserves previously reserved historical IDs. It requires explicit confirmation. Backup PIN may differ if the local code was changed after export.</p></section>`;}
function settingsView(){const s=state.settings;return `<h1>Settings</h1><p class="lead">Private local configuration · API access · digital signature</p><section class="panel"><h2>OpenAI via Cloudflare Worker</h2>${control('HTTPS Worker endpoint URL','@workerUrl',s.workerUrl||'','url','placeholder="https://your-worker.workers.dev"')}<p class="muted tiny">OpenAI API key must be stored only in Cloudflare Worker Secrets. Configure Cloudflare Access and server-side rate limiting before enabling a public endpoint. The worker will reject requests until its protection is provisioned.</p><button data-action="save-settings">Save Worker URL</button></section><section class="panel"><h2>Private Signature</h2>${s.signatureDataUrl?`<p>Signature loaded into the local encrypted vault.</p><img class="signaturePreview" src="${attr(s.signatureDataUrl)}" alt="Local authorized signature"><div class="row" style="margin:12px 0"><button class="danger" data-action="clear-signature">Remove Local Signature</button></div>`:'<p class="muted">No signature loaded. The source JPG is intentionally absent from public GitHub files.</p>'}<div class="field"><label>Import local signature image (encrypted in browser)</label><input id="signatureFile" type="file" accept="image/png,image/jpeg,image/webp"></div><p class="muted tiny">Signature will only print when the interviewer name is Capt. Roman Fedorov.</p></section><section class="panel"><h2>Change Four-Digit PIN</h2><p class="muted">The same PIN is used for application unlocking, local encryption and encrypted backups. Changing it re-encrypts stored local records; old backups still require the old PIN.</p><div class="row"><button class="secondary" data-action="change-pin">Change PIN</button><button class="secondary" data-action="lock">Lock Application</button></div></section><section class="panel"><h2>Version Information</h2><p>Form 001 MST · <strong>Rev.2 / 11-2026</strong></p><p>Online-only · GitHub Pages · browser-local IndexedDB · encrypted JSON</p><p class="muted tiny">Your public GitHub URL does not provide private login authentication. Use a dedicated browser profile/device for confidential materials.</p></section>`}
function topActions(){let current=state.interview;return `<header class="topbar">${current?`<button class="secondary" data-action="back">← Back</button><div class="name">${h(current.candidate?.rank||'Master')} · ${h(current.candidate?.name||'New Interview')}</div><span class="badge ${current.status==='Completed'?'closed':''}">${h(current.status)}</span><span id="saveState" class="status">Autosaved</span><span class="grow"></span><button class="secondary" data-action="save">Save</button><button class="secondary" data-action="toggle-status">${current.status==='Draft'?'Mark Completed':'Mark Draft'}</button><button data-action="print">Print PDF</button>`:`<div class="name">Master Interview · Rev.2 / 11-2026</div><span class="grow"></span><button data-action="new">New Interview</button>`}<button class="secondary" data-action="lock">Lock</button></header>`;}
function shell(){let active=state.tab;return `<div class="appShell"><nav class="side"><div class="brand"><strong>MASTER INTERVIEW</strong><small>Form 001 MST · Rev.2</small></div>${navs.map(([k,label])=>`<button data-tab="${k}" class="${active===k?'active':''}">${h(label)}${k==='questionnaire'&&state.interview?` <span class="sectionMark">${state.sections.filter(s=>status(state.interview.sections[s.formNo])==='Complete').length}/15</span>`:''}</button>`).join('')}<div class="foot">ONLINE ONLY<br>Local encrypted browser storage<br>PIN security: limited</div></nav><main class="main">${topActions()}<div class="content">${formTab()}</div></main></div>`;}
function login(){const init=!state.initialized;app.innerHTML=`<div class="loginOuter"><div class="loginPanel"><div class="headline">Master Interview</div><p class="muted">Form 001 MST · Rev.2 / 11-2026</p><h2>${init?'Initialize Local Vault':'Unlock Local Vault'}</h2><p class="muted">${init?'Set your chosen 4-digit PIN. No PIN is embedded in the public source.':'Enter the 4-digit code used for this browser-local vault.'}</p><form id="authForm"><div class="field"><label>Four-digit PIN</label><input name="pin" type="password" autocomplete="off" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required></div>${init?'<div class="field" style="margin-top:12px"><label>Confirm PIN</label><input name="pin2" type="password" autocomplete="off" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required></div>':''}<button type="submit">${init?'Initialize & Unlock':'Unlock'}</button></form><div class="notice error"><strong>Weak-PIN warning:</strong> four digits are susceptible to offline brute-force attacks. Avoid using the app for highly sensitive records without stronger protection.</div><p class="tiny muted">Online-only. Data are saved only to this browser profile. Preserve encrypted backups.</p></div></div>`;}
function render(){state.renderSerial++;if(!vault.unlocked){login();return;}app.innerHTML=shell();}
// Serialize writes, and seal a point-in-time copy of each interview. An older async
// autosave must never overwrite a newer edit; save failures must propagate.
let saveChain=Promise.resolve(),saveVersion=0,unsavedInterview=false;
function queueSave(){
 if(!state.interview)return;
 unsavedInterview=true;
 const el=$('#saveState');if(el)el.textContent='Saving…';
 clearTimeout(state.saveTimer);
 state.saveTimer=setTimeout(()=>{state.saveTimer=null;saveInterview().catch(()=>{});},550);
}
// Flush a changed interview before backups, printing, switching interviews or
// locking. A rejected background write must NEVER be treated as saved merely
// because the serialized save chain recovered from the rejection.
async function flushPendingSave(){
 if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=null;}
 await saveChain;
 if(state.interview&&unsavedInterview)await saveInterview();
 await saveChain;
 if(unsavedInterview)throw Error('Unsaved interview changes remain. Retry Save before continuing.');
}
async function saveInterview(){
 if(!state.interview||!vault.unlocked)return;
 if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=null;}
 const entry=structuredClone(state.interview),version=++saveVersion;
 entry.updatedAt=new Date().toISOString();state.interview.updatedAt=entry.updatedAt;
 // New edits during this write mark the interview dirty again.
 unsavedInterview=false;
 const write=saveChain.then(async()=>{await vault.set('interview:'+entry.id,entry);state.interviews=await getInterviews();});
 saveChain=write.catch(()=>{});
 try {await write;if(version===saveVersion&&state.interview?.id===entry.id){const e=$('#saveState');if(e)e.textContent=unsavedInterview?'Saving…':'Saved';}}
 catch(e){unsavedInterview=true;notify('Save failed: '+e.message,true);const t=$('#saveState');if(t)t.textContent='Save failed';throw e;}
}
async function getInterviews(){const keys=await vault.ids();const out=[];for(const k of keys.filter(x=>x.startsWith('interview:')))out.push(await vault.get(k));return out.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));}
async function loadSession(){const custom=await vault.get('bank',{questions:[],archivedIds:[],revisions:{},reservedIds:{}});state.bank=new QuestionBank(state.seed,custom);state.settings=await vault.get('settings',{workerUrl:'',signatureDataUrl:''});state.interviews=await getInterviews();state.ready=true;state.interview=null;state.tab='home';state.openGuidanceFormNo=null;state.editGuidanceFormNo=null;render();}
function getPath(obj,path){return path.split('.').reduce((a,k)=>a?.[k],obj)}
function setPath(obj,path,val){const parts=path.split('.');let a=obj;for(let j=0;j<parts.length-1;j++){if(a[parts[j]]==null)a[parts[j]]={};a=a[parts[j]];}a[parts.at(-1)]=val;}
function leaveInterview(){if(state.aiDraft&&state.aiDraft.trim()){if(!confirm('There is an unaccepted AI draft. It will be discarded. Continue?'))return false;}state.aiDraft='';clearTimeout(state.saveTimer);return true;}
async function goTab(tab){if(tab==='home'&&state.interview){await flushPendingSave();if(!leaveInterview())return;state.interview=null;}if(!state.interview&&!['home','bank','backup','settings'].includes(tab)){notify('Open or create an interview first',true);return}state.tab=tab;render();}
async function onAction(act){switch(act){
 case 'new':{const missing=state.sections.filter(s=>!state.bank.bySection(s.bankSection).length).map(s=>s.formNo);if(missing.length){notify('New Interview requires one approved question in each of 15 pools. Missing Form Sections: '+missing.join(', '),true);return;}if(state.interview){await flushPendingSave();if(!leaveInterview())return;}state.interview=newInterview();state.tab='candidate';state.openedQ=1;await saveInterview();render();return;}
 case 'back':await goTab('home');return;
 case 'save':await flushPendingSave();await saveInterview();notify('Interview saved locally');return;
 case 'toggle-status':if(!state.interview)return;state.interview.status=state.interview.status==='Draft'?'Completed':'Draft';await saveInterview();render();return;
 case 'print':await printDialog();return;
 case 'backup':state.tab='backup';render();return;
 case 'generate-ai':await generateAI();return;
 case 'accept-ai':if(!state.aiDraft)return;const words=state.aiDraft.trim().split(/\s+/).length;if(words<40||words>70){notify('AI conclusion should contain 40–70 words before acceptance.',true);return;}if(state.interview.remarks?.trim()&&!confirm('Replace existing E. REMARKS with the accepted AI conclusion?'))return;state.interview.remarks=state.aiDraft.trim();state.aiDraft='';await saveInterview();render();notify('AI conclusion accepted into E. REMARKS');return;
 case 'save-settings':state.settings.workerUrl=$('[data-path="@workerUrl"]')?.value.trim()||'';await vault.set('settings',state.settings);render();notify('Settings saved locally');return;
 case 'clear-signature':if(!confirm('Remove the locally stored signature?'))return;state.settings.signatureDataUrl='';await vault.set('settings',state.settings);render();return;
 case 'change-pin':await changePIN();return;
 case 'lock':if(state.interview){await flushPendingSave();if(!leaveInterview())return;}await saveChain;closeModal();vault.lock();state.interview=null;state.aiDraft='';state.interviews=[];state.bank=null;state.settings={workerUrl:'',signatureDataUrl:''};state.ready=false;render();return;
 case 'backup-export':await exportBackup();return;
 case 'backup-import':await importBackup();return;
 case 'bank-import':await importApproved();return;
 case 'bank-audit':exportBankAudit();return;
  case 'guidance-template':exportGuidanceTemplate();return;
  case 'guidance-import':await importGuidanceFile();return;
 case 'new-question':await addQuestion();return;
 case 'revise-question':await reviseQuestion();return;
 case 'archive-question':await archiveQuestion();return;
 case 'toggle-question-active':await toggleQuestionActive();return;
 }}
function switchQuestion(formNo,id){const sec=state.sections.find(x=>x.formNo===Number(formNo));const next=state.bank.bySection(sec.bankSection).find(q=>q.id===id);if(!next)return;let current=state.interview.sections[formNo];if(current.questionId===next.id&&current.questionText===next.text&&current.questionRevision===next.revision)return;current.questionId=next.id;current.questionText=next.text;current.questionRevision=next.revision;current.comment='';current.grade='';state.openGuidanceFormNo=null;state.editGuidanceFormNo=null;queueSave();state.openedQ=Number(formNo);render();notify('Question replaced; comment and grade cleared for this competency.');}
async function commitBankChange(fn){const candidate=new QuestionBank(state.seed,structuredClone(state.bank.custom));await fn(candidate);await vault.set('bank',candidate.custom);state.bank=candidate;render();}
async function importApproved(){
 try{
  const file=$('#bankFile')?.files?.[0];
  if(file&&file.size>2*1024*1024)throw Error('Question register must be under 2 MB');
  const input=file?await file.text():$('#bankJson')?.value;
  if(!input?.trim())throw Error('Select a JSON register or paste approved records.');
  if(!$('#approvedImport')?.checked)throw Error('Owner approval confirmation is required.');
  const raw=JSON.parse(input),parsed=normalizeApprovedRegister(raw,{allowUnmarked:true,source:file?.name||'Owner verified pasted register'});
  const existing=new Map(state.bank.allApproved().map(q=>[q.id,q]));
  const archived=new Set(state.bank.custom.archivedIds||[]);
  const candidates=[];let unchanged=0;
  for(const q of parsed.approved){
   if(archived.has(q.id))throw Error('Previously archived ID '+q.id+' requires a controlled revision; cannot silently reactivate.');
   const old=existing.get(q.id);
   if(old){if(old.text.replace(/\s+/g,' ').trim()!==q.text.replace(/\s+/g,' ').trim())throw Error(`Question ${q.id} conflicts with an existing approved wording; use Controlled Revision, not bulk import.`);unchanged++;continue;}
   if(q.id==='6.52')throw Error('6.52 was explicitly rejected by the owner. It cannot be activated by importing an older selection file.');
   candidates.push(q);
  }
  if(!candidates.length){notify(`No new approved questions: ${unchanged} already present; ${parsed.omitted.length} rejected, pending or unapproved entries skipped.`);return;}
  const available=Math.max(0,state.seed.targetApprovedCount-state.bank.count());
  const message=`Source entries: ${parsed.total}\nApproved candidates: ${parsed.approved.length}\nAlready present with identical wording: ${unchanged}\nRejected/Pending/Unapproved excluded: ${parsed.omitted.length}\nNew approved to import: ${candidates.length}\nNew questions that can become Active: ${Math.min(available,candidates.length)}\nNew Approved questions remaining Inactive: ${Math.max(0,candidates.length-available)}\n\nConfirm import of these Approved Questions?`;
  if(!confirm(message))return;
  const candidateBank=new QuestionBank(state.seed,structuredClone(state.bank.custom));
  await candidateBank.addApproved(candidates,true);
  await vault.set('bank',candidateBank.custom); // commit before updating UI; failed writes leave UI unchanged
  state.bank=candidateBank;
  render();
  notify(`Imported ${candidates.length} Approved questions; ${candidateBank.count()} Active, ${candidateBank.inactive().length} Inactive.`);
 }catch(e){notify('Question Bank import: '+e.message,true)}
}
async function saveGuidance(formNo){
 try{
  const v=state.interview?.sections?.[formNo];if(!v?.questionId)throw Error('No selected question');
  const q=state.bank.allApproved().find(q=>q.id===v.questionId);
  if(!q||q.text!==v.questionText||Number(q.revision||1)!==Number(v.questionRevision||1))throw Error('Question bank wording or revision changed; choose a current question before saving guidance');
  const panel=document.querySelector(`[data-guidance-for="${formNo}"]`);
  if(!panel)throw Error('Guidance editor is closed');
  const entry={id:q.id,questionText:q.text,questionRevision:Number(q.revision||1),updatedAt:new Date().toISOString()};
  for(const [field] of auditorFields){const el=panel.querySelector(`[data-guidance-field="${field}"]`);if(!el)throw Error('Missing guidance field '+field);if(el.value.length>12000)throw Error('Guidance field exceeds 12000 characters');entry[field]=el.value.trim();}
  await commitBankChange(b=>{b.custom.guidance??={};if(auditorFields.every(([field])=>!entry[field]))delete b.custom.guidance[q.id];else b.custom.guidance[q.id]=entry;});
  state.openGuidanceFormNo=formNo;state.editGuidanceFormNo=null;render();notify('Auditor guidance saved in encrypted local bank. It will not print.');
 }catch(e){notify('Auditor guidance: '+e.message,true)}
}
function exportGuidanceTemplate(){
 const guidance=state.bank.allApproved().map(q=>({id:q.id,questionText:q.text,questionRevision:Number(q.revision||1),expectedAnswer:'',acceptableAlternatives:'',suggestedFollowUp:'',criticalRedFlags:''}));
 download(`MST_Auditor_Guidance_Template_${dateNow()}.json`,new Blob([JSON.stringify({format:'MST-AUDITOR-GUIDANCE',version:1,guidance},null,2)],{type:'application/json'}));
 notify('Auditor guidance template downloaded. Populate and privately import; do NOT upload answers to public GitHub.');
}
async function importGuidanceFile(){
 try{
  const file=$('#guidanceFile')?.files?.[0];if(!file)throw Error('Select a private JSON file');
  if(file.size>4*1024*1024)throw Error('Guidance JSON must be smaller than 4 MB');
  const data=JSON.parse(await file.text());
  if(data.format!=='MST-AUDITOR-GUIDANCE'||data.version!==1||!Array.isArray(data.guidance)||data.guidance.length>3000)throw Error('Invalid guidance file format or version');
  const byId=new Map(state.bank.allApproved().map(q=>[q.id,q]));const incoming=new Map();let empty=0;
  for(const r of data.guidance){
   if(!r||typeof r.id!=='string'||incoming.has(r.id))throw Error('Duplicate or missing question ID in guidance file');
   const q=byId.get(r.id);if(!q)throw Error(`Unknown approved ID: ${r.id}. Legacy Q001–Q105 IDs cannot be imported automatically.`);
   if(q.text!==r.questionText||Number(q.revision||1)!==Number(r.questionRevision))throw Error('Original wording / revision mismatch for '+r.id);
   const item={id:r.id,questionText:q.text,questionRevision:Number(q.revision||1),updatedAt:new Date().toISOString()};
   for(const [field] of auditorFields){if(typeof r[field]!=='string'||r[field].length>12000)throw Error('Missing or invalid '+field+' for '+r.id);item[field]=r[field].trim();}
   if(auditorFields.every(([field])=>!item[field])){empty++;continue;}
   incoming.set(r.id,item);
  }
  if(!incoming.size)throw Error('File contains no filled guidance entries; populate the JSON template first.');
  if(!confirm(`Import ${incoming.size} private answer-guidance entries? Empty rows skipped: ${empty}. Existing entries with same ID will be replaced. Guidance is stored encrypted only in this browser.`))return;
  await commitBankChange(b=>{b.custom.guidance??={};for(const [id,entry] of incoming)b.custom.guidance[id]=entry;});
  notify(`Imported ${incoming.size} private guidance entries into encrypted local bank.`);
 }catch(e){notify('Auditor guidance import: '+e.message,true)}
}
function exportBankAudit(){
 const audit=auditQuestionBank(state.bank,state.sections);
 download(`MST_Question_Bank_Audit_${dateNow()}.json`,new Blob([JSON.stringify(audit,null,2)],{type:'application/json'}));
 notify('Question Bank audit exported. Contains no interview records, PIN or signature.');
}

async function addQuestion(){try{if(!$('#newApproved').checked)throw Error('Owner approval required.');const section=Number(state.bankSection),id=state.bank.nextId(section),value=state.newText||'';if(!confirm('Owner approves new question '+id+'? The Question ID will never be reused.'))return;await commitBankChange(b=>b.addApproved([{id,section,text:value}],false));state.newText='';notify('Question '+id+' approved');}catch(e){notify(e.message,true)}}
async function reviseQuestion(){try{const id=state.selectedBankId,s=state.revisionText;if(!s||!confirm('Approve a new revision of '+id+'? Existing interview snapshots will remain unchanged.'))return;await commitBankChange(b=>b.revise(id,s));state.revisionText='';notify('New approved revision saved');}catch(e){notify(e.message,true)}}
async function toggleQuestionActive(){try{const id=state.selectedBankId,now=state.bank.isActive(id);if(!confirm((now?'Deactivate ':'Activate ')+id+' for future random selection? Existing interviews remain unchanged.'))return;await commitBankChange(b=>b.setActive(id,!now));notify(id+' is now '+(!now?'Active':'Inactive'));}catch(e){notify(e.message,true)}}
async function archiveQuestion(){try{let id=state.selectedBankId;if(!confirm('Archive '+id+' and exclude it from future random selection?'))return;await commitBankChange(b=>b.archive(id));state.selectedBankId='';notify('Question archived');}catch(e){notify(e.message,true)}}
function download(name,blob){let a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),120000)}
async function exportBackup(){try{await flushPendingSave();}catch(e){notify('Cannot export before pending edits are saved: '+e.message,true);return;}let pin=prompt('Enter the current four-digit PIN to encrypt and export your backup:');if(pin===null)return;try{let mode=state.exportMode||'complete';if(mode==='individual'&&!state.interview)throw Error('Open an interview to export an individual backup');let data=await vault.createBackup(pin,mode,state.interview?.id);download(`MST_${mode}_${dateNow()}.encrypted.json`,new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));notify('Encrypted JSON backup downloaded. Store it securely.')}catch(e){notify(e.message,true)}}
async function importBackup(){const file=$('#importJsonFile')?.files[0];if(!file){notify('Choose an encrypted .json file',true);return;}if(file.size>30*1024*1024){notify('Encrypted backup must be smaller than 30 MB',true);return;}try{await flushPendingSave();}catch(e){notify('Save pending edits before importing: '+e.message,true);return;}if(state.interview){if(!leaveInterview())return;}await saveChain;const pin=prompt('Enter the PIN used when this backup was exported:');if(pin===null)return;try{const raw=JSON.parse(await file.text()),snap=await vault.readBackup(raw,pin);const mode=state.importMode||'merge';if(mode==='full'&&snap.mode!=='complete')throw Error('Full Restore requires a complete backup');let dest={};if(mode==='full'){
 if(!confirm('FULL RESTORE WILL REPLACE EVERY LOCAL INTERVIEW AND SETTINGS RECORD. Confirm?'))return;
 if(!confirm('Final confirmation: replace local vault contents with the imported Complete Backup?'))return;
 dest=structuredClone(snap.entries);
 const previousBank=await vault.get('bank',{reservedIds:{}});
 const oldReserved=previousBank.reservedIds||{};
 if(!dest.bank)dest.bank={questions:[],archivedIds:[],revisions:{},reservedIds:{}};
 dest.bank.reservedIds||={};
 for(const [k,ids] of Object.entries(oldReserved))dest.bank.reservedIds[k]=[...new Set([...(dest.bank.reservedIds[k]||[]),...(Array.isArray(ids)?ids:[])])];
 }else {dest=(await vault.snapshot()).entries;for(const [id,value] of Object.entries(snap.entries)){if(id.startsWith('interview:')&&dest[id]){const answer=prompt(`Interview conflict: ${id.slice(10)}. Enter R = Replace Existing, C = Import as Copy, X = Cancel import`,'X');if(answer===null||answer.trim().toUpperCase()==='X')throw Error('Import cancelled without changes');if(answer.trim().toUpperCase()==='R')dest[id]=value;else if(answer.trim().toUpperCase()==='C'){let newId=crypto.randomUUID();dest['interview:'+newId]={...value,id:newId,updatedAt:new Date().toISOString()};}else throw Error('Invalid conflict decision; import cancelled');}else if(id==='bank'&&dest[id]){const old=dest[id];let merged=structuredClone(old);for(const q of value.questions||[]){if(!merged.questions.some(x=>x.id===q.id))merged.questions.push(q);else if(JSON.stringify(merged.questions.find(x=>x.id===q.id))!==JSON.stringify(q)){let decision=prompt(`Question Bank conflict ${q.id}: R to replace, X to cancel`,'X');if(decision?.trim().toUpperCase()!=='R')throw Error('Question Bank conflict: import cancelled');merged.questions=merged.questions.filter(x=>x.id!==q.id).concat(q);}}merged.archivedIds=[...new Set([...(old.archivedIds||[]),...(value.archivedIds||[])])];merged.activeOverrides={...(value.activeOverrides||{}),...(old.activeOverrides||{})};merged.guidance={...(value.guidance||{}),...(old.guidance||{})};for(const [k,v] of Object.entries(value.reservedIds||{}))merged.reservedIds[k]=[...new Set([...(merged.reservedIds[k]||[]),...v])];for(const [k,v] of Object.entries(value.revisions||{}))merged.revisions[k]=[...(merged.revisions[k]||[]),...v];dest.bank=merged;}else if(id==='settings'&&dest[id]){/* Preserve current settings on merge, including locally configured signature. */}else dest[id]=value;}}
 // Validate the complete merged result before any replacement/commit.
 validateSnapshot({schemaVersion:1,mode:'complete',entries:dest});
 await vault.writeMany(dest,true);await loadSession();notify('Encrypted backup restored successfully');}catch(e){notify(e.message,true)}}
async function changePIN(){const oldPin=prompt('Current four-digit PIN:');if(oldPin===null)return;const next=prompt('New four-digit PIN:');if(next===null)return;if(!confirm('Change PIN and re-encrypt local data? Old backups will still require the former PIN. Export a complete backup first.'))return;try{await vault.changePin(oldPin,next);notify('PIN changed and vault re-encrypted')}catch(e){notify(e.message,true)}}
async function uploadSignature(file){if(!file)return;if(!file.type.startsWith('image/'))throw Error('Select an image file');if(file.size>4e6)throw Error('Signature image must be under 4 MB');const img=await createImageBitmap(file),max=700,ratio=Math.min(1,max/Math.max(img.width,img.height));const cv=document.createElement('canvas');cv.width=Math.round(img.width*ratio);cv.height=Math.round(img.height*ratio);const ctx=cv.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,cv.width,cv.height);ctx.drawImage(img,0,0,cv.width,cv.height);state.settings.signatureDataUrl=cv.toDataURL('image/jpeg',.92);await vault.set('settings',state.settings);render();notify('Signature stored in local encrypted vault; not published on GitHub.');}
function redact(s){let out=text(s);const i=state.interview;if(!i)return out;const secrets=[i.candidate?.name,i.candidate?.idNumber,i.candidate?.vessel,...(i.contracts||[]).flatMap(x=>[x.vessel,x.company])].filter(x=>x&&String(x).trim().length>=3);for(const secret of secrets){const escaped=String(secret).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');out=out.replace(new RegExp(escaped,'gi'),'[REDACTED]');}return out.slice(0,4000);}
async function generateAI(){let i=state.interview,url=state.settings.workerUrl?.trim();if(!url){notify('Configure the protected Cloudflare Worker URL under Settings first.',true);return;}if(!/^https:\/\//.test(url)){notify('Worker URL must use HTTPS',true);return;}const assessments=state.sections.map(s=>({competency:s.title,comment:redact(i.sections[s.formNo]?.comment||''),grade:i.sections[s.formNo]?.grade||''}));const assessment={role:i.candidate.rank,contractExperience:i.contracts.map(x=>redact(x.rankPeriod)),initial:Object.fromEntries(Object.entries(i.initial).map(([k,v])=>[k,redact(v)])),inspectionExperience:i.inspections.map((v,j)=>({type:inspectionNames[j],choice:v.choice,comment:redact(v.comments)})),sections:assessments};try{notify('Generating professional AI draft…');const endpoint=url.replace(/\/$/,'')+(url.endsWith('/generate')?'':'/generate');const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',cache:'no-store',body:JSON.stringify({assessment})});let d=await r.json();if(!r.ok)throw Error(d.error||'AI gateway error '+r.status);if(!d.conclusion||typeof d.conclusion!=='string')throw Error('Invalid AI response');state.aiDraft=d.conclusion.trim();render();notify('AI draft ready for review. Not yet saved.')}catch(e){notify('AI request failed: '+e.message,true)}}
async function printDialog(){if(!state.interview)return;await flushPendingSave();printAnnex=false;printFilename=fileName(state.interview);printError='';state.modal='print';renderModal();await refreshPreview();}
function closeModal(){previewGeneration++;state.modal=null;if(printUrl){URL.revokeObjectURL(printUrl);printUrl=null;}printPdf=null;document.querySelector('#modalOverlay')?.remove();}
function renderModal(){document.querySelector('#modalOverlay')?.remove();if(state.modal!=='print')return;let overlay=document.createElement('div');overlay.id='modalOverlay';overlay.className='modalBackdrop';overlay.innerHTML=`<div class="modal"><div class="row spread"><h2>Unified PDF Preview</h2><button class="secondary" data-modal-action="close">✕ Close</button></div><p class="tiny muted">Form 001 MST Rev.2 / 11-2026 · Original layout · Print and Save use the identical PDF.</p><div class="field"><label>PDF Filename (editable)</label><input id="pdfFileName" value="${attr(printFilename)}" placeholder="Master_Candidate_YYYY-MM-DD.pdf"></div><label class="checkline" style="margin:12px 0"><input id="annexToggle" type="checkbox" ${printAnnex?'checked':''}> Include Detailed Annex — 15 Questions (off by default)</label><div id="pdfValidation" class="muted">Preparing the PDF…</div><iframe id="pdfView" class="pdfFrame" title="Official report PDF preview"></iframe><div class="row" style="margin-top:12px"><button id="printAction" data-modal-action="print" disabled>Print</button><button id="savePdfAction" data-modal-action="save" disabled>Save PDF</button><button class="secondary" data-modal-action="refresh">Refresh Preview</button></div><div class="notice">The PDF pages come from the authoritative blank Word form, preserving original branding and footer revision. Signature is private and inserted only when locally loaded.</div></div>`;document.body.appendChild(overlay);overlay.querySelector('#annexToggle').addEventListener('change',async e=>{printAnnex=e.target.checked;let inp=$('#pdfFileName');let base=inp.value.replace(/\.pdf$/i,'').replace(/_Annex$/i,'');printFilename=base+(printAnnex?'_Annex':'')+'.pdf';inp.value=printFilename;await refreshPreview();});overlay.querySelector('#pdfFileName').addEventListener('change',e=>printFilename=e.target.value);overlay.addEventListener('click',async e=>{const action=e.target.closest('[data-modal-action]')?.dataset.modalAction;if(!action)return;if(action==='close')closeModal();if(action==='refresh')await refreshPreview();if(action==='save')savePDF();if(action==='print')printPDF();});}
async function refreshPreview(){
 const box=$('#pdfValidation'),print=$('#printAction'),save=$('#savePdfAction'),frame=$('#pdfView');
 if(!box||!frame)return;
 // A rapid Annex toggle launches another asynchronous PDF build. Earlier builds
 // must never overwrite the newer preview or re-enable stale Print/Save controls.
 const ticket=++previewGeneration;
 const current=()=>ticket===previewGeneration&&state.modal==='print'&&box.isConnected;
 const annex=printAnnex,interview=structuredClone(state.interview),sections=state.sections,signature=state.settings.signatureDataUrl;
 box.className='notice';box.textContent='Checking exact fixed-page text space and generating one canonical PDF…';
 print.disabled=save.disabled=true;frame.removeAttribute('src');
 if(printUrl){URL.revokeObjectURL(printUrl);printUrl=null;}
 printPdf=null;
 try{
  const blob=await buildPDF(interview,{annex,sections,signatureDataUrl:signature});
  if(!current())return;
  printPdf=blob;printUrl=URL.createObjectURL(blob);frame.src=printUrl;
  box.className='notice good';box.textContent='PDF ready. Strict Original Layout validated. Both actions use the same file.';
  print.disabled=save.disabled=false;
 }catch(e){
  if(!current())return;
  printError=e.message;box.className='notice error';
  box.textContent='PDF NOT READY: '+e.message+(/too long|exceeds|overflow/i.test(e.message)?' Return to the identified form field and shorten the text.':' Check the indicated PDF error and retry.')+' Print and Save are disabled.';
  notify('PDF validation: '+e.message,true);
 }
}
function savePDF(){if(!printPdf)return;let name=($('#pdfFileName')?.value||printFilename).trim().replace(/[\\/:*?"<>|]/g,'_');if(!name.toLowerCase().endsWith('.pdf'))name+='.pdf';download(name,printPdf);}
function printPDF(){if(!printPdf||!printUrl)return;try{const frame=$('#pdfView');frame.contentWindow.focus();frame.contentWindow.print();}catch{window.open(printUrl,'_blank','noopener');notify('Use the PDF viewer Print icon if the browser blocks direct printing.');}}
app.addEventListener('submit',async e=>{if(e.target.id!=='authForm')return;e.preventDefault();let pin=e.target.elements.pin.value;if(!/^\d{4}$/.test(pin))return notify('PIN must have four digits',true);try{if(!state.initialized){if(pin!==e.target.elements.pin2.value)throw Error('PIN confirmation does not match');await vault.setup(pin);state.initialized=true;}else await vault.unlock(pin);await loadSession();notify('Local vault unlocked')}catch(ex){notify(ex.message,true)}});
app.addEventListener('click',async e=>{let n=e.target.closest('[data-action]');if(n){e.preventDefault();await onAction(n.dataset.action);return;}n=e.target.closest('[data-tab]');if(n){await goTab(n.dataset.tab);return;}n=e.target.closest('[data-open]');if(n){if(state.interview){await flushPendingSave();if(!leaveInterview())return;}state.interview=await vault.get('interview:'+n.dataset.open);state.tab='candidate';state.openedQ=1;render();return;}n=e.target.closest('[data-expand]');if(n){let j=Number(n.dataset.expand);state.openedQ=state.openedQ===j?null:j;render();return;}n=e.target.closest('[data-reroll]');if(n){let s=state.sections.find(x=>x.formNo===Number(n.dataset.reroll)),old=state.interview.sections[s.formNo].questionId;let q=state.bank.random(s.bankSection,old);if(q)switchQuestion(s.formNo,q.id);return;}n=e.target.closest('[data-guidance-toggle]');if(n){const f=Number(n.dataset.guidanceToggle);state.openGuidanceFormNo=state.openGuidanceFormNo===f?null:f;state.editGuidanceFormNo=null;render();return;}
 n=e.target.closest('[data-guidance-edit]');if(n){const f=Number(n.dataset.guidanceEdit);state.openGuidanceFormNo=f;state.editGuidanceFormNo=state.editGuidanceFormNo===f?null:f;render();return;}
 n=e.target.closest('[data-guidance-save]');if(n){await saveGuidance(Number(n.dataset.guidanceSave));return;}
 n=e.target.closest('[data-question-picker]');if(n){openQuestionPicker(Number(n.dataset.questionPicker));return;}n=e.target.closest('[data-bank-select]');if(n){state.selectedBankId=n.dataset.bankSelect;state.revisionText=state.bank.allApproved().find(x=>x.id===state.selectedBankId)?.text||'';render();return;}});
app.addEventListener('keydown',e=>{const head=e.target.closest('[data-expand]');if(head&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const formNo=Number(head.dataset.expand);state.openedQ=state.openedQ===formNo?null:formNo;render();document.querySelector(`[data-expand="${formNo}"]`)?.focus();}});
app.addEventListener('input',e=>{const el=e.target,p=el.dataset.path;if(!p)return;if(p==='@aiDraft'){state.aiDraft=el.value;return;}if(p==='@newText'){state.newText=el.value;return;}if(p==='@revisionText'){state.revisionText=el.value;return;}if(p==='@workerUrl'){state.settings.workerUrl=el.value;return;}if(p[0]==='@')return;if(!state.interview)return;setPath(state.interview,p,el.value);queueSave();if(p.startsWith('sections.'))updateProgressIndicators();});
app.addEventListener('change',async e=>{const el=e.target;if(el.dataset.questionSelect){if(el.value){const formNo=el.dataset.questionSelect,id=el.value;setTimeout(()=>switchQuestion(formNo,id),0);}return;}if(el.id==='signatureFile'){try{await uploadSignature(el.files[0])}catch(err){notify(err.message,true)}return;}if(el.dataset.path){const p=el.dataset.path;if(p==='@bankSection'){state.bankSection=Number(el.value);state.selectedBankId='';setTimeout(render,0);return;}if(p==='@exportMode'){state.exportMode=el.value;return;}if(p==='@importMode'){state.importMode=el.value;return;}if(p[0]==='@')return;if(state.interview){setPath(state.interview,p,el.value);queueSave();if(p.startsWith('sections.'))updateProgressIndicators();}}});
const offline=$('#connection');function onlineState(){offline.classList.toggle('hidden',navigator.onLine);if(!navigator.onLine){if(state.interview){/*do not evict content; app is unusable until online*/}app.style.pointerEvents='none';app.style.opacity='.5';}else{app.style.pointerEvents='auto';app.style.opacity='1';}}window.addEventListener('online',onlineState);window.addEventListener('offline',onlineState);document.addEventListener('visibilitychange',()=>{if(document.hidden&&vault.unlocked&&state.interview)flushPendingSave().catch(()=>{});});
async function init(){try{const sources=await getSeed();state.seed=sources.seed;state.sections=sources.sections;state.initialized=await vault.connect();render();onlineState();if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});}catch(e){app.innerHTML=`<main class="loginOuter"><div class="panel"><h1>Startup error</h1><p>${h(e.message)}</p><p>Online connection and HTTPS are required. Serve the entire public folder as the GitHub Pages site.</p></div></main>`;}}
init();
