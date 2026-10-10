const STORE='dlt-data-v1', CONFIG='dlt-sync-config-v1', SCHEDULE_STORE='dlt-schedule-exceptions-v1';

const OFFICIAL_CLOSURES=[
 ['2026-02-14','2026-02-23','2026年春节彩票市场休市'],
 ['2026-10-01','2026-10-04','2026年国庆彩票市场休市']
];

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

let draws=[],
scheduleExceptions=[],
calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1),
supabase=null,
session=null,
syncTimer,
toastTimer;


const fmt=n=>String(n).padStart(2,'0');

const escapeHtml=s=>String(s??'')
.replace(/[&<>"']/g,c=>({
'&':'&amp;',
'<':'&lt;',
'>':'&gt;',
'"':'&quot;',
"'":'&#39;'
}[c]));


async function init(){

  try{
    draws=JSON.parse(localStorage.getItem(STORE))||[];
  }catch(e){
    draws=[];
  }


  // 强制读取最新开奖
 try{
    const r=await fetch(
      "data/latest.json?t="+Date.now()
    );

    const latest = await r.json();

    if(latest && latest.issue){

      const newLatest={
          issue:String(latest.issue),
          date:latest.date || '',
          front:latest.front.map(Number),
          back:latest.back.map(Number)
      };

      draws=[
          newLatest,
          ...draws.filter(
            d=>String(d.issue)!==String(latest.issue)
          )
      ];
    }

}catch(e){
    console.log("latest.json读取失败",e);
}


  try{

    const savedExceptions=
      JSON.parse(
        localStorage.getItem(SCHEDULE_STORE)
      );

    scheduleExceptions=
      Array.isArray(savedExceptions)
      ? savedExceptions
      : [];

  }catch(e){

    scheduleExceptions=[];

  }


  draws=draws
.map(d=>({
    issue:String(d.issue||''),
    date:d.date||'',
    front:Array.isArray(d.front)?d.front.map(Number):[],
    back:Array.isArray(d.back)?d.back.map(Number):[]
}))
.filter(d=>d.front.length===5 && d.back.length===2)
.sort(
    (a,b)=>
    Number(b.issue)-Number(a.issue)
);


  localStorage.setItem(
    STORE,
    JSON.stringify(draws)
  );


  renderAll();
  bind();
  setupCalculator();
  setupServiceWorker();


  const cfg=readConfig();

  if(cfg.url&&cfg.key){

    $('#syncStatus').title='已配置云同步';

    try{
      await createClient();
      await loadCloud();

    }catch(e){

      $('#syncStatus').title=
      '云同步暂不可用：'+e.message;

    }

  }


  $('#settingsBtn')
  .addEventListener(
    'click',
    ()=>openSettings()
  );

}
function save(){
  localStorage.setItem(
    STORE,
    JSON.stringify(draws)
  );

  renderAll();

  if(session&&supabase)
    syncLater();
}


function toast(s){
  const e=$('#toast');

  e.textContent=s;

  e.classList.add('show');

  clearTimeout(toastTimer);

  toastTimer=setTimeout(
    ()=>e.classList.remove('show'),
    2500
  );
}


function ballList(ns,back=false){

  return `
  <div class="number-list ${back?'back':''}">
  ${
    ns.map(n=>
      `<i class="num-chip">${fmt(n)}</i>`
    ).join('')
  }
  </div>`;

}


function renderAll(){

  renderOverview();

  renderDraws();

  renderAnalysis();

  renderSchedule();

  fillIssueSelect();

}



function renderOverview(){

  $('#drawCount').textContent=
    draws.length.toLocaleString('zh-CN');


  const latest = draws[0];


  $('#latestDate').textContent=
    latest
   `第 ${latest.issue} 期`
    : '尚无记录';


  $('#latestNumbers').textContent=
    latest
    ? `${latest.front.map(fmt).join(' · ')} + ${latest.back.map(fmt).join(' · ')}`
    : '添加开奖，开始查看统计';



  const counts=Array(36).fill(0);


  draws.forEach(d=>
    d.front.forEach(n=>counts[n]++)
  );


  const max=Math.max(
    ...counts.slice(1),
    1
  );


  $('#frequencyChart').className=
    'frequency-chart';


  $('#frequencyChart').innerHTML=
  Array.from(
    {length:35},
    (_,i)=>i+1
  )
  .map(n=>

    `<div class="bar-col"
    title="${fmt(n)}：${counts[n]} 次">

    <div class="bar ${
      counts[n]===max?'hot':''
    }"
    style="height:${Math.max(
      3,
      counts[n]/max*87
    )}%"></div>

    <small>${fmt(n)}</small>

    </div>`

  ).join('');

}



function renderDraws(){

 const list=$('#drawList');


 list.innerHTML=
 draws.slice(0,300)
 .map((d,i)=>

 `<div class="record-row draw-row">

 <span class="draw-date">
 ${
 d.issue
 ? `第 ${escapeHtml(d.issue)} 期`
 : escapeHtml(d.date||'—')
 }
 </span>

 ${ballList(d.front)}

 ${ballList(d.back,true)}

 <button class="delete-btn"
 title="删除"
 data-delete="${i}">
 ×
 </button>

 </div>`

 ).join('');



 $('#emptyRecords').style.display=
 draws.length?'none':'block';



 list.querySelectorAll('[data-delete]')
 .forEach(b=>

 b.onclick=()=>{

 if(confirm(
 `删除第 ${draws[Number(b.dataset.delete)].issue} 期记录？`
 )){

 draws.splice(
 Number(b.dataset.delete),
 1
 );

 save();

 toast('记录已删除');

 }

 }

 );

}
function renderAnalysis(){

 const frontMiss=Array(36).fill(0),
 backMiss=Array(13).fill(0),
 fSeen=Array(36).fill(false),
 bSeen=Array(13).fill(false);


 draws.forEach(d=>{

 for(let n=1;n<=35;n++){

  if(!fSeen[n]){

   if(d.front.includes(n))
     fSeen[n]=true;
   else
     frontMiss[n]++;

  }

 }


 for(let n=1;n<=12;n++){

  if(!bSeen[n]){

   if(d.back.includes(n))
     bSeen[n]=true;
   else
     backMiss[n]++;

  }

 }

 });



 $('#analysisRange').textContent=
 `${draws.length.toLocaleString('zh-CN')} 期`;

}



function showTab(name){

 $$('.tab')
 .forEach(t=>
 t.classList.toggle(
 'active',
 t.dataset.tab===name
 )
 );


 $$('.page')
 .forEach(p=>
 p.classList.toggle(
 'active',
 p.id===name
 )
 );

 window.scrollTo({
  top:0,
  behavior:'smooth'
 });

}



function readConfig(){

 try{

 return JSON.parse(
 localStorage.getItem(CONFIG)
 )||{};

 }catch{

 return {};

 }

}



async function createClient(){

 if(supabase)
 return supabase;


 const {
 createClient
 }=
 await import(
 'https://esm.sh/@supabase/supabase-js@2'
 );


 const c=readConfig();


 if(!c.url||!c.key)
 throw Error(
 '请先填写 Supabase 项目 URL 和 anon key'
 );


 supabase=createClient(
 c.url,
 c.key,
 {
 auth:{
 persistSession:true,
 autoRefreshToken:true,
 detectSessionInUrl:true
 }
 }
 );


 return supabase;

}



function setupServiceWorker(){

 if(
 'serviceWorker' in navigator &&
 location.protocol.startsWith('http')
 )

 navigator.serviceWorker
 .register('./sw.js')
 .catch(()=>{});

}



$('#signInBtn').onclick=
()=>authAction('signin');


$('#signUpBtn').onclick=
()=>authAction('signup');


$('#signOutBtn').onclick=
async()=>{

 try{

 if(supabase)
 await supabase.auth.signOut();


 session=null;

 setOnline(false);

 toast('已退出登录');


 }catch(e){

 $('#settingsError').textContent=
 e.message;

 }

};



init();
