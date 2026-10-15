const STORE='dlt-data-v1', CONFIG='dlt-sync-config-v1', SCHEDULE_STORE='dlt-schedule-exceptions-v1';
const OFFICIAL_CLOSURES=[['2026-02-14','2026-02-23','2026年春节彩票市场休市'],['2026-10-01','2026-10-04','2026年国庆彩票市场休市']];
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let draws=[], scheduleExceptions=[], calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1), supabase=null, session=null, syncTimer, toastTimer;
const fmt=n=>String(n).padStart(2,'0');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const officialRecords = new Map();
let refreshing = false;
function validRecord(d, official=false){
  if(!d || typeof d !== 'object') return false;
  const issue=String(d.issue||'');
  if(!/^\d{5}$/.test(issue)) return false;
  const year=2000+Number(issue.slice(0,2)), seq=Number(issue.slice(2));
  const currentYear=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Shanghai'}).format(new Date()));
  if(year<2007 || year>currentYear || seq<1 || seq>200) return false;
  if(![['front',5,35],['back',2,12]].every(([k,n,max])=>Array.isArray(d[k]) && d[k].length===n && new Set(d[k]).size===n && d[k].every(v=>Number.isInteger(v)&&v>=1&&v<=max))) return false;
  if(official){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date||'')) return false;
    const day=new Date(d.date+'T00:00:00+08:00');
    if(!Number.isFinite(day.getTime()) || day>Date.now() || Number(d.date.slice(0,4))!==year) return false;
  }
  return true;
}
function normalizedRecords(rows){
  return (Array.isArray(rows)?rows:[]).filter(d=>validRecord(d)).map(d=>({issue:String(d.issue),date:d.date||'',front:[...d.front],back:[...d.back]}));
}
function mergeOfficial(rows){
  const map=new Map(normalizedRecords(rows).map(d=>[d.issue,d]));
  officialRecords.forEach((d,key)=>map.set(key,d));
  return [...map.values()].sort((a,b)=>b.issue.localeCompare(a.issue));
}
function persistRecords(){
  try{localStorage.setItem(STORE,JSON.stringify(draws))}catch(e){console.warn('本机保存失败',e)}
}
function dataStatus(message){
  let element=document.querySelector('#dataUpdateStatus');
  if(!element){element=document.createElement('p');element.id='dataUpdateStatus';element.setAttribute('role','status');document.querySelector('#overview .section-heading').after(element)}
  element.textContent=message;
}
async function fetchJson(path){
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(new URL(path,location.href),{cache:'no-store',signal:controller.signal});
    if(!response.ok) throw Error(path+': HTTP '+response.status);
    if(!(response.headers.get('content-type')||'').includes('json')) throw Error(path+': 响应不是 JSON');
    return await response.json();
  }finally{clearTimeout(timer)}
}
async function refreshOfficial(){
  if(refreshing) return;
  refreshing=true;
  try{
    // One canonical snapshot avoids latest/history races across deployments.
    const history=await fetchJson('./history.json');
    if(!Array.isArray(history)||!history.length||history.some(d=>!validRecord(d))) throw Error('历史数据校验失败');
    const map=new Map(history.map(d=>[String(d.issue),d]));
    if(map.size!==history.length) throw Error('历史数据存在重复期号');
    const newest=[...map.values()].sort((a,b)=>String(b.issue).localeCompare(String(a.issue)))[0];
    if(!validRecord(newest,true)) throw Error('最新一期缺少可信开奖日期，请检查自动更新任务');
    const previous=[...officialRecords.keys()].sort().at(-1);
    if(previous && newest.issue<previous) throw Error('服务器数据倒退，保留已有记录');
    officialRecords.clear();map.forEach((value,key)=>officialRecords.set(key,value));
    draws=mergeOfficial(draws);persistRecords();renderAll();
    dataStatus(`已读取服务器数据：第 ${newest.issue} 期，开奖日期 ${newest.date}；核查时间 ${new Date().toLocaleString('zh-CN')}。不代表下一期已公布。`);
  }catch(e){
    dataStatus('未能核实最新开奖，当前显示本机历史记录：'+e.message);
  }finally{refreshing=false}
}
async function init(){
  try{
    const raw=localStorage.getItem(STORE);
    // Keep the original data for recovery before filtering poisoned records such as 97171.
    if(raw && !localStorage.getItem(STORE+'-before-repair')) localStorage.setItem(STORE+'-before-repair',raw);
    draws=normalizedRecords(JSON.parse(raw||'[]'));
  }catch(e){draws=[]}
  try{const saved=JSON.parse(localStorage.getItem(SCHEDULE_STORE));scheduleExceptions=Array.isArray(saved)?saved:[]}catch{scheduleExceptions=[]}
  draws=mergeOfficial(draws);
  renderAll();bind();setupCalculator();setupServiceWorker();
  $('#settingsBtn').addEventListener('click',()=>openSettings());
  await refreshOfficial();
  const cfg=readConfig();
  if(cfg.url&&cfg.key){try{await createClient();await loadCloud()}catch(e){$('#syncStatus').title='云同步暂不可用：'+e.message}}
  window.addEventListener('online',refreshOfficial);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOfficial()});
  setInterval(()=>{if(!document.hidden)refreshOfficial()},5*60*1000);
}

function save(){localStorage.setItem(STORE,JSON.stringify(draws));renderAll();if(session&&supabase)syncLater()}
function toast(s){const e=$('#toast');e.textContent=s;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),2500)}
function ballList(ns,back=false){return `<div class="number-list ${back?'back':''}">${ns.map(n=>`<i class="num-chip">${fmt(n)}</i>`).join('')}</div>`}
function renderAll(){renderOverview();renderDraws();renderAnalysis();renderSchedule();fillIssueSelect()}
function renderOverview(){
 $('#drawCount').textContent=draws.length.toLocaleString('zh-CN');
 const latest=draws[0];$('#latestDate').textContent=latest?`第 ${latest.issue} 期`:'尚无记录';$('#latestNumbers').textContent=latest?`${latest.front.map(fmt).join(' · ')}  +  ${latest.back.map(fmt).join(' · ')}`:'添加开奖，开始查看统计';
 const counts=Array(36).fill(0);draws.forEach(d=>d.front.forEach(n=>counts[n]++));const max=Math.max(...counts.slice(1),1);
 $('#frequencyChart').className='frequency-chart';$('#frequencyChart').innerHTML=Array.from({length:35},(_,i)=>i+1).map(n=>`<div class="bar-col" title="${fmt(n)}：${counts[n]} 次"><div class="bar ${counts[n]===max?'hot':''}" style="height:${Math.max(3,counts[n]/max*87)}%"></div><small>${fmt(n)}</small></div>`).join('');
}
function renderDraws(){const list=$('#drawList');list.innerHTML=draws.slice(0,300).map((d,i)=>`<div class="record-row draw-row"><span class="draw-date">${d.issue?`第 ${escapeHtml(d.issue)} 期`:escapeHtml(d.date||'—')}</span>${ballList(d.front)}${ballList(d.back,true)}<button class="delete-btn" title="删除" data-delete="${i}">×</button></div>`).join('');$('#emptyRecords').style.display=draws.length?'none':'block';list.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{if(confirm(`删除第 ${draws[Number(b.dataset.delete)].issue} 期记录？`)){draws.splice(Number(b.dataset.delete),1);save();toast('记录已删除')}})}
function renderAnalysis(){
 const frontMiss=Array(36).fill(0),backMiss=Array(13).fill(0),fSeen=Array(36).fill(false),bSeen=Array(13).fill(false);
 draws.forEach(d=>{for(let n=1;n<=35;n++)if(!fSeen[n]){if(d.front.includes(n))fSeen[n]=true;else frontMiss[n]++}for(let n=1;n<=12;n++)if(!bSeen[n]){if(d.back.includes(n))bSeen[n]=true;else backMiss[n]++}});
 $('#omissionChart').innerHTML=`<div class="heat-section"><b>前区</b>${Array.from({length:35},(_,i)=>{let n=i+1;return `<span class="heat-cell ${frontMiss[n]>=15?'heat-high':''}" title="${fmt(n)} 遗漏 ${frontMiss[n]} 期">${fmt(n)}<small>${frontMiss[n]}</small></span>`}).join('')}</div><div class="heat-section back-heat"><b>后区</b>${Array.from({length:12},(_,i)=>{let n=i+1;return `<span class="heat-cell ${backMiss[n]>=8?'heat-high':''}" title="${fmt(n)} 遗漏 ${backMiss[n]} 期">${fmt(n)}<small>${backMiss[n]}</small></span>`}).join('')}</div>`;
 const recent=draws.slice(0,30).reverse();const vals=recent.map(d=>({issue:d.issue,sum:d.front.reduce((a,b)=>a+b,0),odd:d.front.filter(n=>n%2).length}));const max=Math.max(...vals.map(x=>x.sum),1),min=Math.min(...vals.map(x=>x.sum),1);
 $('#indicatorChart').innerHTML=`<div class="indicator-top"><span>前区和值范围 <b>${min}–${max}</b></span><span>近 <b>${recent.length}</b> 期</span></div><div class="sum-chart">${vals.map(x=>`<span title="${x.issue}期 · 和值${x.sum} · 奇数${x.odd}:偶数${5-x.odd}" style="height:${20+(x.sum/(35*5))*80}%"></span>`).join('')}</div><div class="chart-legend"><i></i>前区和值</div><div class="parity-summary">${[0,1,2,3,4,5].map(k=>{let c=vals.filter(x=>x.odd===k).length;return `<span>${k}奇 ${5-k}偶 <b>${c}</b></span>`}).join('')}</div>`;
 const wheel=(isBack)=>{const nums=isBack?12:35;return `<div class="wheel-head"><span>期号</span>${Array.from({length:nums},(_,i)=>`<small>${fmt(i+1)}</small>`).join('')}</div>`+draws.slice(0,12).map(d=>`<div class="wheel-row"><span>${escapeHtml(d.issue.slice(-3))}</span>${Array.from({length:nums},(_,i)=>`<i class="${(isBack?d.back:d.front).includes(i+1)?'hit':''}"></i>`).join('')}</div>`).join('')};
 $('#frontWheel').innerHTML=wheel(false);$('#backWheel').innerHTML=wheel(true);$('#analysisRange').textContent=`${draws.length.toLocaleString('zh-CN')} 期`;
}
function isoDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function isDrawDay(d){return [1,3,6].includes(d.getDay())}
function closureFor(key){const official=OFFICIAL_CLOSURES.find(([start,end])=>key>=start&&key<=end);if(official)return official[2];return scheduleExceptions.find(x=>x.date===key)?.reason||''}
function drawForDate(key){return draws.find(d=>d.date===key)}
function renderSchedule(){
 const y=calendarMonth.getFullYear(),m=calendarMonth.getMonth(),first=new Date(y,m,1),startOffset=(first.getDay()+6)%7,count=new Date(y,m+1,0).getDate(),today=isoDate(new Date());
 $('#calendarMonth').textContent=`${y}年${m+1}月`;
 const cells=[];for(let i=0;i<42;i++){const n=i-startOffset+1,d=new Date(y,m,n),key=isoDate(d),inMonth=d.getMonth()===m,scheduled=isDrawDay(d),reason=scheduled?closureFor(key):'',record=drawForDate(key),state=record?'recorded':(reason?'closed':(scheduled?'draw':''));const label=record?'已录记录':(reason?'休市':(scheduled?(key===today?'今日开奖':(key<today?'开奖日':'预计开奖')):''));cells.push(`<div class="calendar-day ${inMonth?'':'outside'} ${state} ${key===today?'today':''}" title="${escapeHtml(record?`第${record.issue}期开奖记录`:reason||label||'非开奖日')}"><span>${d.getDate()}</span>${label?`<small>${label}</small>`:''}</div>`)}
 $('#calendarDays').innerHTML=cells.join('');
 const upcoming=[];for(let i=0;i<50&&upcoming.length<6;i++){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+i);if(!isDrawDay(d))continue;const key=isoDate(d),reason=closureFor(key),rec=drawForDate(key),week=['日','一','二','三','四','五','六'][d.getDay()];upcoming.push(`<div class="upcoming-row ${reason?'is-closed':''}"><span class="upcoming-date"><b>${d.getMonth()+1}/${d.getDate()}</b><small>周${week}</small></span><span class="upcoming-status">${reason?'休市':(rec?'已录入':'预计开奖')}<small>${escapeHtml(reason|| (rec?`第 ${rec.issue} 期`:''))}</small></span></div>`)}
 $('#upcomingList').innerHTML=upcoming.join('');
 $('#customExceptions').innerHTML=scheduleExceptions.length?scheduleExceptions.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<span class="exception-chip">${escapeHtml(x.date)} · ${escapeHtml(x.reason)} <button type="button" data-remove-exception="${escapeHtml(x.date)}" aria-label="删除休市日期">×</button></span>`).join(''):'<span class="no-exceptions">尚未添加自定义休市日</span>';
 $('#customExceptions').querySelectorAll('[data-remove-exception]').forEach(b=>b.onclick=()=>{scheduleExceptions=scheduleExceptions.filter(x=>x.date!==b.dataset.removeException);localStorage.setItem(SCHEDULE_STORE,JSON.stringify(scheduleExceptions));renderSchedule();if(session&&supabase)syncLater();toast('休市日期已移除')});
}
function saveException(e){e.preventDefault();const date=$('#exceptionDate').value,reason=$('#exceptionReason').value.trim()||'临时休市';if(!date){return}const d=new Date(`${date}T12:00:00`);if(!isDrawDay(d)){toast('请选择周一、周三或周六的开奖日');return}if(OFFICIAL_CLOSURES.some(([a,b])=>date>=a&&date<=b)){toast('该日期已在官方休市安排中');return}scheduleExceptions=scheduleExceptions.filter(x=>x.date!==date);scheduleExceptions.push({date,reason});localStorage.setItem(SCHEDULE_STORE,JSON.stringify(scheduleExceptions));$('#exceptionForm').reset();renderSchedule();if(session&&supabase)syncLater();toast('休市调整已添加')}
function fillIssueSelect(){const e=$('#compareIssue');if(e)e.innerHTML=draws.map(d=>`<option value="${escapeHtml(d.issue)}">第 ${escapeHtml(d.issue)} 期 · ${d.front.map(fmt).join(' ')} + ${d.back.map(fmt).join(' ')}</option>`).join('')}
function parseNums(s,count,max){const a=s.split(/[\s,，、]+/).filter(Boolean).map(x=>Number(x));if(a.length!==count||a.some(n=>!Number.isInteger(n)||n<1||n>max)||new Set(a).size!==a.length)throw Error(`请填写 ${count} 个不重复的 01–${fmt(max)} 号码`);return a.sort((x,y)=>x-y)}
function randomSet(total,count){const a=Array.from({length:total},(_,i)=>i+1);for(let i=a.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,count).sort((x,y)=>x-y)}
function pick(){const f=randomSet(35,5),b=randomSet(12,2);$('#frontPicks').innerHTML=f.map(n=>`<i>${fmt(n)}</i>`).join('');$('#backPicks').innerHTML=b.map(n=>`<i>${fmt(n)}</i>`).join('')}
function choose(n,k){if(k<0||k>n)return 0;k=Math.min(k,n-k);let x=1;for(let i=1;i<=k;i++)x=x*(n-k+i)/i;return Math.round(x)}
function setupCalculator(){for(let n=5;n<=35;n++)$('#calcFront').insertAdjacentHTML('beforeend',`<option value="${n}" ${n===5?'selected':''}>${n} 个</option>`);for(let n=2;n<=12;n++)$('#calcBack').insertAdjacentHTML('beforeend',`<option value="${n}" ${n===2?'selected':''}>${n} 个</option>`);const calc=()=>{let lines=choose(+$(`#calcFront`).value,5)*choose(+$(`#calcBack`).value,2);let cost=lines*(2+($('#calcAddOn').checked?1:0));$('#calcLines').textContent=`${lines.toLocaleString('zh-CN')} 注`,$('#calcCost').textContent=`${cost.toLocaleString('zh-CN')} 元`};['calcFront','calcBack','calcAddOn'].forEach(id=>$('#'+id).addEventListener('change',calc));calc()}
function prizeTier(f,b){if(f===5&&b===2)return'一等奖';if(f===5&&b===1)return'二等奖';if((f===5&&b===0)||(f===4&&b===2))return'三等奖';if(f===4&&b===1)return'四等奖';if((f===4&&b===0)||(f===3&&b===2))return'五等奖';if((f===3&&b===1)||(f===2&&b===2))return'六等奖';if((f===3&&b===0)||(f===2&&b===1)||(f===1&&b===2)||(f===0&&b===2))return'七等奖';return'未中奖'}
function bind(){
 $$('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.tab));$$('[data-goto]').forEach(b=>b.onclick=()=>showTab(b.dataset.goto));
 $('#heroPick').onclick=()=>{showTab('picker');pick()};$('#generateBtn').onclick=pick;
 $('#addDrawBtn').onclick=$('#emptyAdd').onclick=()=>{const f=$('#drawForm');f.reset();$('#formError').textContent='';$('#drawDialog').showModal()};
 $('#drawForm').addEventListener('submit',e=>{if(e.submitter?.value!=='save')return;e.preventDefault();try{const front=parseNums($('#frontInput').value,5,35),back=parseNums($('#backInput').value,2,12);const issue=$('#drawIssue').value.trim(),date=$('#drawDate').value;if(!issue&&!date)throw Error('请填写期号或开奖日期');if(issue&&!/^\d{4,6}$/.test(issue))throw Error('期号请填写 4–6 位数字');const d={issue:issue||date.replaceAll('-',''),date,front,back};if(draws.some(x=>x.issue===d.issue))throw Error(`第 ${d.issue} 期已存在`);draws.unshift(d);draws.sort((a,b)=>b.issue.localeCompare(a.issue));save();$('#drawDialog').close();toast('开奖记录已保存')}catch(err){$('#formError').textContent=err.message}});
 $('#checkTicket').onclick=()=>{try{if(!draws.length)throw Error('请先导入开奖记录');const f=parseNums($('#myFront').value,5,35),b=parseNums($('#myBack').value,2,12),d=draws.find(x=>x.issue===$('#compareIssue').value);if(!d)throw Error('请选择对照期号');const fh=f.filter(n=>d.front.includes(n)).length,bh=b.filter(n=>d.back.includes(n)).length,tier=prizeTier(fh,bh);$('#matchResult').innerHTML=`<b class="${tier==='未中奖'?'no-win':'win'}">${tier}</b><span>前区命中 ${fh} 个 · 后区命中 ${bh} 个</span><small>按当前规则匹配奖级，奖金金额请以官方当期公布为准。</small>`}catch(err){$('#matchResult').textContent=err.message}};
 $('#prevMonth').onclick=()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderSchedule()};$('#nextMonth').onclick=()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderSchedule()};$('#todayMonth').onclick=()=>{const n=new Date();calendarMonth=new Date(n.getFullYear(),n.getMonth(),1);renderSchedule()};$('#exceptionForm').addEventListener('submit',saveException);
 $('#exportBtn')?.addEventListener('click',exportData);$('#importBtn')?.addEventListener('click',()=>$('#csvFile').click());$('#csvFile')?.addEventListener('change',importCsv);
}
function showTab(name){$$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));$$('.page').forEach(p=>p.classList.toggle('active',p.id===name));window.scrollTo({top:0,behavior:'smooth'})}
function exportData(){const lines=draws.map(d=>[d.issue,...d.front.map(fmt),...d.back.map(fmt)].join(',')).join('\n');const blob=new Blob([lines],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='大乐透开奖记录.csv';a.click();URL.revokeObjectURL(a.href);toast('已导出 CSV 备份')}
async function importCsv(e){const file=e.target.files[0];if(!file)return;try{const rows=(await file.text()).replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean),parsed=rows.map(line=>{const c=line.replaceAll('"','').split(',').map(x=>x.trim());if(c.length<8)throw Error('CSV 格式应为：期号、5 个前区、2 个后区');return{issue:c[0],date:'',front:c.slice(1,6).map(Number),back:c.slice(6,8).map(Number)}});if(parsed.some(d=>!/^\d{4,6}$/.test(d.issue)||d.front.length!==5||new Set(d.front).size!==5||d.front.some(n=>n<1||n>35)||new Set(d.back).size!==2||d.back.some(n=>n<1||n>12)))throw Error('CSV 中存在不符合规则的号码');const map=new Map(draws.map(d=>[d.issue,d]));parsed.forEach(d=>map.set(d.issue,d));draws=[...map.values()].sort((a,b)=>b.issue.localeCompare(a.issue));save();toast(`已导入 ${parsed.length} 期数据`)}catch(err){alert(err.message)}finally{e.target.value=''}}
function readConfig(){try{return JSON.parse(localStorage.getItem(CONFIG))||{}}catch{return{}}}
async function createClient(){if(supabase)return supabase;const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');const c=readConfig();if(!c.url||!c.key)throw Error('请先填写 Supabase 项目 URL 和 anon key');supabase=createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});return supabase}
function openSettings(){const cfg=readConfig();$('#supabaseUrl').value=cfg.url||'';$('#supabaseKey').value=cfg.key||'';$('#settingsError').textContent='';$('#settingsDialog').showModal()}
async function authAction(action){try{const url=$('#supabaseUrl').value.trim(),key=$('#supabaseKey').value.trim();if(!url||!key)throw Error('请先填写 Supabase URL 与 anon key');localStorage.setItem(CONFIG,JSON.stringify({url,key}));supabase=null;const c=await createClient(),email=$('#authEmail').value.trim(),password=$('#authPassword').value;if(!email||!password)throw Error('请输入邮箱和密码');let result=action==='signup'?await c.auth.signUp({email,password}):await c.auth.signInWithPassword({email,password});if(result.error)throw result.error;if(action==='signup'&&!result.data.session){$('#settingsError').textContent='注册成功。请先到邮箱确认账号，再回来登录。';return}session=result.data.session;await loadCloud();$('#settingsDialog').close();setOnline(true);toast('已登录，同步就绪')}catch(e){$('#settingsError').textContent=e.message||'连接失败，请检查设置'}}
async function loadCloud(){const c=await createClient();const {data:{session:s}}=await c.auth.getSession();session=s;if(!session){setOnline(false);return}const {data,error}=await c.from('lotto_user_data').select('payload,updated_at').eq('user_id',session.user.id).maybeSingle();if(error)throw error;if(data?.payload?.draws){draws=mergeOfficial(data.payload.draws);scheduleExceptions=Array.isArray(data.payload.scheduleExceptions)?data.payload.scheduleExceptions:[];localStorage.setItem(STORE,JSON.stringify(draws));localStorage.setItem(SCHEDULE_STORE,JSON.stringify(scheduleExceptions));renderAll()}else{await syncNow()}setOnline(true)}
function setOnline(on){const e=$('#syncStatus');e.classList.toggle('online',on);e.innerHTML=on?'<i></i>云端已同步':'<i></i>仅此设备'}
function syncLater(){clearTimeout(syncTimer);$('#syncStatus').innerHTML='<i></i>同步中';syncTimer=setTimeout(syncNow,700)}
async function syncNow(){if(!session||!supabase)return;try{const {error}=await supabase.from('lotto_user_data').upsert({user_id:session.user.id,payload:{draws,scheduleExceptions},updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw error;setOnline(true)}catch(e){setOnline(false);$('#syncStatus').title='同步失败：'+e.message;toast('云同步失败，请检查连接或稍后重试')}}
function setupServiceWorker(){
  if(!('serviceWorker' in navigator)||!location.protocol.startsWith('http'))return;
  let reloading=false;
  const hadController=Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(hadController&&!reloading){reloading=true;location.reload()}
  });
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
    .then(registration=>registration.update())
    .catch(error=>console.warn('离线组件更新失败',error));
}

$('#signInBtn').onclick=()=>authAction('signin');$('#signUpBtn').onclick=()=>authAction('signup');$('#signOutBtn').onclick=async()=>{try{if(supabase)await supabase.auth.signOut();session=null;setOnline(false);toast('已退出登录')}catch(e){$('#settingsError').textContent=e.message}};
init();
