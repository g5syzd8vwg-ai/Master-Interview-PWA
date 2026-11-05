// Dependency-free PDF generator. Uses raster backgrounds of the authoritative
// Rev.2 Word form plus vector-fill text. PDF is generated once for preview/print/save.
const W=595.304,H=841.89;
const enc=new TextEncoder();
const cp1252=new Map([[0x20ac,128],[0x201a,130],[0x0192,131],[0x201e,132],[0x2026,133],[0x2020,134],[0x2021,135],[0x02c6,136],[0x2030,137],[0x0160,138],[0x2039,139],[0x0152,140],[0x017d,142],[0x2018,145],[0x2019,146],[0x201c,147],[0x201d,148],[0x2022,149],[0x2013,150],[0x2014,151],[0x02dc,152],[0x2122,153],[0x0161,154],[0x203a,155],[0x0153,156],[0x017e,158],[0x0178,159]]);
function latinText(s){s=String(s??'');for(const c of s){let n=c.codePointAt(0);if(n===10||n===13||n===9)continue;if((n>=32&&n<=126)||(n>=160&&n<=255)||cp1252.has(n))continue;throw Error('PDF supports English/Western text only. Unsupported character in: '+s.slice(0,48));}return s;}
function pdfString(s){latinText(s);let out='';for(const c of s){let n=c.codePointAt(0);if(n===10){out+='\\n';continue}if(n===13)continue;if(n===9){out+=' ';continue}if(n===40||n===41||n===92){out+='\\'+c;continue;}if(n>126)out+='\\'+(cp1252.get(n)||n).toString(8).padStart(3,'0');else out+=c;}return'('+out+')';}
function bytes(data){return data instanceof Uint8Array?data:enc.encode(data)}
function join(items){const len=items.reduce((a,x)=>a+bytes(x).length,0),out=new Uint8Array(len);let p=0;for(const it of items){const b=bytes(it);out.set(b,p);p+=b.length;}return out;}
function wrap(s,width,size=9,bold=false){latinText(s);const cv=wrap.canvas||(wrap.canvas=document.createElement('canvas'));const ctx=cv.getContext('2d');ctx.font=`${bold?'bold ':''}${size}px Times New Roman`;const out=[];for(const paragraph of String(s).split('\n')){let line='';for(const w of paragraph.split(/\s+/).filter(Boolean)){if(ctx.measureText(w).width>width+0.8)throw Error('A word is too long for the original PDF cell: '+w.slice(0,45));const attempt=line?line+' '+w:w;if(line&&ctx.measureText(attempt).width>width){out.push(line);line=w;}else line=attempt;}out.push(line);}return out;}
class PDF {
 constructor(){this.obj=[null];this.pages=[];this.font=this.add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');this.bold=this.add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');this.catalog=this.add(null);this.pagesRoot=this.add(null);}
 add(content){this.obj.push(content);return this.obj.length-1;}
 set(id,content){this.obj[id]=content;}
 stream(source,dictionary=''){const b=bytes(source);return this.add(join([`<< /Length ${b.length} ${dictionary} >>\nstream\n`,b,'\nendstream']));}
 image(jpeg,width,height){return this.stream(jpeg,`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`);}
 page(background,commands,images={}){const content=this.stream(commands.join('\n'));const xobjs=Object.entries({Im0:background,...images}).map(([n,id])=>`/${n} ${id} 0 R`).join(' ');const id=this.add(`<< /Type /Page /Parent ${this.pagesRoot} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${this.font} 0 R /F2 ${this.bold} 0 R >> /XObject << ${xobjs} >> >> /Contents ${content} 0 R >>`);this.pages.push(id);}
 finish(){this.set(this.pagesRoot,`<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map(n=>`${n} 0 R`).join(' ')}] >>`);this.set(this.catalog,`<< /Type /Catalog /Pages ${this.pagesRoot} 0 R >>`);const chunks=['%PDF-1.4\n%\xD3\xD4\xD5\xD6\n'];const offsets=[0];let length=bytes(chunks[0]).length;for(let i=1;i<this.obj.length;i++){const head=`${i} 0 obj\n`,body=bytes(this.obj[i]),tail='\nendobj\n';offsets.push(length);chunks.push(head,body,tail);length+=bytes(head).length+body.length+bytes(tail).length;}let start=length;chunks.push(`xref\n0 ${this.obj.length}\n0000000000 65535 f \n`);for(let i=1;i<this.obj.length;i++)chunks.push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');chunks.push(`trailer\n<< /Size ${this.obj.length} /Root ${this.catalog} 0 R >>\nstartxref\n${start}\n%%EOF\n`);return new Blob(chunks,{type:'application/pdf'});}
}
const layout=(x,yTop,size,s,bold=false)=>`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${(H-yTop-size).toFixed(1)} Tm ${pdfString(s)} Tj ET`;
const imagePlacement=(n,x,yTop,w,h)=>`q ${w} 0 0 ${h} ${x} ${(H-yTop-h).toFixed(1)} cm /${n} Do Q`;
const line=(x1,y1,x2,y2)=>`${x1} ${(H-y1).toFixed(1)} m ${x2} ${(H-y2).toFixed(1)} l S`;
const rectify=(x,y,w,h)=>`${x} ${(H-y-h).toFixed(1)} ${w} ${h} re S`;
async function loadJpg(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Missing official form assets');let b=new Uint8Array(await r.arrayBuffer());let im=await createImageBitmap(new Blob([b],{type:'image/jpeg'}));return{bytes:b,w:im.width,h:im.height};}
async function fromDataURL(url){const image=new Image();await new Promise((ok,err)=>{image.onload=ok;image.onerror=err;image.src=url});const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);const blob=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg',.93));return{bytes:new Uint8Array(await blob.arrayBuffer()),w:canvas.width,h:canvas.height};}
function cell(cmd,value,x1,y1,x2,y2,label,options={}){let s=String(value??'').trim();if(!s)return;const pad=options.pad??1.4,size=options.size??9.0,lh=options.lh??(size+1.7),width=x2-x1-pad*2,height=y2-y1-pad*2;const ll=wrap(s,width,size,!!options.bold);if(ll.length*lh>height+0.7)throw Error(`${label}: text exceeds the fixed original PDF cell (${ll.length} lines, available ${Math.floor(height/lh)}). Shorten the text.`);for(let i=0;i<ll.length;i++)cmd.push(layout(x1+pad,y1+pad+i*lh,size,ll[i],!!options.bold));}
function slot(cmd,value,x,y,w,h,label,opts){cell(cmd,value,x,y,x+w,y+h,label,opts);}
function yesNo(cmd,state,yesX,noX,y){let s=String(state||'').toLowerCase();if(s==='yes')cmd.push(layout(yesX,y,11,'X',true));if(s==='no')cmd.push(layout(noX,y,11,'X',true));}
const B1=[538.9,554.4,569.9,585.4,600.9,646.4,676.9,707.4,737.9,768.5];
const B2=[65.2,95.9,126.4,156.9,187.5];
const C2=[258.6,304.1,379.6,485.1,545.6,576.1,606.6,697.1,772.7];
const C3=[80.9,126.4,156.9,172.4,187.9,203.4,233.9,294.5];
const A=[343.0,358.5,374.0,389.5,405.0,447.9];
const CT=[233.2,248.7,264.2,279.8];
function formatGrade(s){s=s||{};const comment=(s.comment||'').trim(),grade=s.grade||'';return grade?(comment?comment+' — '+grade:grade):comment;}
function basePages(interview){const cmd=[[],[],[]];const c=interview.candidate||{},contracts=interview.contracts||[],a=interview.initial||{},b=interview.inspections||[],sc=interview.sections||{},it=interview.interviewer||{};
 // Page 1 candidate details
 slot(cmd[0],c.date,128,103,172,16,'Candidate Date',{size:10.5});slot(cmd[0],c.vessel,361,103,184,16,'Vessel',{size:10});slot(cmd[0],`${c.rank||''} ${c.name||''}`.trim(),174,120,127,16,'Rank / Name',{size:9.6});slot(cmd[0],c.idNumber,172,137,130,16,'ID number',{size:9.5});
 contracts.forEach((r,i)=>{if(i>=3)return;slot(cmd[0],r.company,85.2,CT[i]+.3,148,CT[i+1]-CT[i]-.7,'Contract '+(i+1)+' Company',{size:8.8});slot(cmd[0],r.vessel,234,CT[i]+.3,170,CT[i+1]-CT[i]-.7,'Contract '+(i+1)+' Vessel',{size:8.8});slot(cmd[0],r.rankPeriod,404,CT[i]+.3,149,CT[i+1]-CT[i]-.7,'Contract '+(i+1)+' Rank / Period',{size:8.8});});
 const aKeys=['shipType','tradingArea','cargo','mixedCrew','english'];aKeys.forEach((k,i)=>slot(cmd[0],a[k],262.6,A[i]+.15,290,A[i+1]-A[i]-.2,'Section A '+k,{size:9.2}));
 b.forEach((r,i)=>{let page=i<9?0:1,j=i<9?i:i-9,rows=page===0?B1:B2,top=rows[j],bottom=rows[j+1];yesNo(cmd[page],r.choice,282,326,top+2);slot(cmd[page],r.comments,347.8,top+.2,204.5,bottom-top-.4,'Section B item '+(i+1),{size:8.8});});
 for(let k=1;k<=15;k++){let page=k<=8?1:2,ix=k<=8?k-1:k-9,arr=page===1?C2:C3;slot(cmd[page],formatGrade(sc[k]),347.5,arr[ix]+.3,205.3,arr[ix+1]-arr[ix]-.6,'Section C competency '+k,{size:8.65,lh:10.25});}
 yesNo(cmd[2],interview.acceptable,485,520,342.5);
 slot(cmd[2],interview.remarks,85.5,409.5,467,50,'Section E REMARKS',{size:10,lh:15.7,pad:1.1});
 if(interview.purpose==='newcomer')cmd[2].push(layout(326,501.6,10.6,'X',true));if(interview.purpose==='promotion')cmd[2].push(layout(326,516.1,10.6,'X',true));
 if(interview.method==='office')cmd[2].push(layout(192,501.6,10.6,'X',true));if(interview.method==='camera')cmd[2].push(layout(192,516.0,10.6,'X',true));if(interview.method==='telephone')cmd[2].push(layout(192,530.2,10.6,'X',true));
 slot(cmd[2],it.name,420,501.4,132,13.8,'Completed by Name',{size:9.0,pad:1.6});slot(cmd[2],it.position,432,515.7,120,13.8,'Completed by Position',{size:9.0,pad:1.4});slot(cmd[2],it.date,416,529.8,135,13.8,'Completed by Date',{size:9,pad:1.6});
 return cmd;
}
function annexPages(interview,sections,logo){const rowInputs=sections.map(s=>({formNo:s.formNo,section:s.title,q:interview.sections?.[s.formNo]}));if(rowInputs.some(r=>!r.q?.questionId||!r.q?.questionText))throw Error('Annex requires all 15 actual selected questions; some sections have no verified question available.');const all=[];let cmd=[],y=100,index=0;const complete=()=>{let page=[...cmd];page.push(layout(85,779,10,'Form 001 MST _ Rev.2 / 11-2026'));page.push(layout(85,793,9,'The form is used for Master for initial interview and Chief Officer promotion.'));page.push(layout(539,780,10,String(4+index)));page.unshift(imagePlacement('ImLogo',491,12,64,57));all.push(page);index++;cmd=[];y=100;};
 const header=()=>{cmd.push(layout(86,68,14,'DETAILED INTERVIEW ANNEX',true));cmd.push(layout(86,88,9,'Selected Interview Questions — Form 001 MST Rev.2 / 11-2026'));cmd.push(layout(87,114,10,'No.',true),layout(134,114,10,'Competency',true),layout(330,114,10,'Selected Question (ID and full original wording)',true));cmd.push(line(85,132,553,132));y=132;};
 header();for(const r of rowInputs){let text=String(r.q.questionId)+' — '+String(r.q.questionText);const nameLines=wrap(r.section,184,8.5),textLines=wrap(text,216,8.5),height=Math.max(nameLines.length,textLines.length)*11+10;if(height>614)throw Error('Annex question '+r.q.questionId+' is too long for one page without splitting.');if(y+height>746){complete();header();}cmd.push(layout(90,y+4,9,String(r.formNo)));nameLines.forEach((s,i)=>cmd.push(layout(134,y+4+i*11,8.5,s)));textLines.forEach((s,i)=>cmd.push(layout(330,y+4+i*11,8.5,s)));cmd.push(line(85,y+height,553,y+height));y+=height;}complete();return all;
}
/** @param {Object} interview raw saved interview; options {annex,sections,signatureDataUrl} */
export async function buildPDF(interview,options={}){const pdf=new PDF();const backgrounds=await Promise.all([1,2,3].map(i=>loadJpg('./assets/form-'+i+'.jpg')));const commands=basePages(interview);
 let signature=null;if(options.signatureDataUrl&&String(interview.interviewer?.name||'').trim()==='Capt. Roman Fedorov')signature=await fromDataURL(options.signatureDataUrl);
 backgrounds.forEach((b,i)=>{const bg=pdf.image(b.bytes,b.w,b.h),images={};if(i===2&&signature){const id=pdf.image(signature.bytes,signature.w,signature.h),maxH=76,maxW=94,scale=Math.min(maxH/signature.h,maxW/signature.w);images.ImSig=id;commands[i].push(layout(408,568,9,'Signature:'));commands[i].push(imagePlacement('ImSig',428,583,Math.round(signature.w*scale),Math.round(signature.h*scale)));}commands[i].unshift(imagePlacement('Im0',0,0,W,H));pdf.page(bg,commands[i],images);});
 if(options.annex){const logo=await loadJpg('./assets/annex-logo.jpg');const logoObj=pdf.image(logo.bytes,logo.w,logo.h);for(const pg of annexPages(interview,options.sections,logoObj))pdf.page(logoObj,pg,{ImLogo:logoObj});}
 return pdf.finish();
}
