'use strict';
(() => {
  const native = typeof AndroidPet !== 'undefined' ? AndroidPet : null;
  const overlay = new URLSearchParams(location.search).has('overlay');
  if (overlay) document.body.classList.add('overlay');
  const $ = id => document.getElementById(id);
  const canvas = $('petCanvas'), ctx = canvas.getContext('2d'), wrap = $('petWrap'), stage = $('stage');
  let saved = {};
  try { saved = JSON.parse(native ? native.loadState() : localStorage.getItem('whale-pet-v1')) || {}; } catch (_) {}
  const brain = new PetBrain(saved);
  const idle = new Image(), atlas = new Image(); idle.src = 'idle.png'; atlas.src = 'actions.png';
  // Measured atlas: the generated rows are not equal height. Never divide it into a 4x2 grid.
  const frames = [[0,0,439,483],[439,0,449,483],[888,0,432,483],[1320,0,454,483],
    [0,483,452,404],[452,483,440,404],[892,483,438,404],[1330,483,444,404]];
  const names = {idle:'自在待着',happy:'开心回应',eat:'吃白米饭',sleep:'休息中',drag:'被抱起来',play:'一起玩',roam:'四处游游'};
  let menuOpen=false, stopped=false, dir=1, px=0, py=0, placed=false, last=0, lastStats=0, lastSave=0, lastState='';
  const save=()=>{try {const s=JSON.stringify(brain.save()); if(native)native.saveState(s);else localStorage.setItem('whale-pet-v1',s);}catch(_){}};
  function sync(){
    [['full','fullValue',brain.fullness],['energy','energyValue',brain.energy],['love','loveValue',brain.affection]].forEach(([a,b,v])=>{$(a).value=v;$(b).textContent=Math.round(v);});
    $('stateLabel').textContent=names[brain.kind];$('sleepButton').textContent=brain.sleeping?'叫醒她':'睡一会儿';
    $('wanderButton').textContent='自主活动：'+(brain.wander?'开':'关');
    $('menuStats').textContent=`饱腹 ${Math.round(brain.fullness)} · 精神 ${Math.round(brain.energy)} · 亲密 ${Math.round(brain.affection)}`;
  }
  function move(x,y){
    if(overlay)return;
    px=Math.max(0,Math.min(stage.clientWidth-wrap.offsetWidth,x));py=Math.max(26,Math.min(stage.clientHeight-wrap.offsetHeight-22,y));
    wrap.style.left=px+'px';wrap.style.top=py+'px';
  }
  function showMenu(open=true){menuOpen=open;$('menu').hidden=!open;if(native)native.menuOpen(open);sync();}
  function act(action){if(stopped)return;if(action==='chat'){openChat();return;}brain.act(action);showMenu(false);sync();save();}
  // ---- 和 DSH 说话 ----
  const chatLog=$('chatLog'),chatInput=$('chatInput'),chatNote=$('chatNote');
  let chatBusy=false;
  function chatAdd(who,text){
    const d=document.createElement('div');d.className='line '+who;d.textContent=(who==='me'?'你：':'小鲸鱼：')+text;
    chatLog.appendChild(d);chatLog.scrollTop=chatLog.scrollHeight;
    while(chatLog.children.length>30)chatLog.removeChild(chatLog.firstChild);
  }
  function openChat(){
    $('chat').hidden=false;showMenu(false);
    // menuOpen 负责把小窗放大腾地方；chatMode 负责让窗口拿到输入焦点
    // —— 悬浮窗默认带 FLAG_NOT_FOCUSABLE，不去掉的话输入法根本弹不出来。
    if(native){
      if(typeof native.menuOpen==='function')native.menuOpen(true);
      if(typeof native.chatMode==='function')native.chatMode(true);
    }
    chatInput.value='';
    setTimeout(()=>{try{chatInput.focus();}catch(_){}},150);
  }
  function closeChat(){
    $('chat').hidden=true;
    if(native){
      if(typeof native.chatMode==='function')native.chatMode(false);
      if(typeof native.menuOpen==='function')native.menuOpen(false);
    }
  }
  function sendChat(){
    const text=(chatInput.value||'').trim();if(!text||chatBusy)return;
    chatAdd('me',text);chatInput.value='';
    if(!native){chatAdd('pet','（演示页没有原生桥，到手机悬浮窗上跟我说话吧）');return;}
    chatBusy=true;
    showThinking('正在理解你的话…');
    brain.say('让我想想…',Date.now(),15000);
    brain.change('play',15000,Date.now());   // 等待时让她蹦跶，别傻站着
    native.chat(text);
  }
  function showThinking(label){
    const box=$('chatThink');if(!box)return;
    box.hidden=false;$('chatThinkText').textContent=label;
  }
  function hideThinking(){const box=$('chatThink');if(box)box.hidden=true;}
  function draw(now){
    ctx.clearRect(0,0,480,500);if(stopped)return;
    const k=brain.kind, t=now/1000;
    let index=-1;
    if(k==='happy'||k==='play')index=Math.floor(now/400)%2;
    if(k==='eat')index=2+Math.floor(now/440)%2;
    if(k==='sleep')index=4+Math.floor(now/1500)%2;
    if(k==='drag')index=6+Math.floor(now/300)%2;
    ctx.save();ctx.translate(240,470);
    const bounce=k==='play'?-Math.abs(Math.sin(t*5))*42:(k==='sleep'?Math.sin(t*1.7)*2:Math.sin(t*2.4)*5);
    ctx.translate(0,bounce);
    const tilt=k==='drag'?Math.sin(t*7)*.09:(k==='roam'?Math.sin(t*4)*.05:Math.sin(t*1.2)*.012);
    ctx.rotate(tilt);
    if(index>=0 && atlas.complete && atlas.naturalWidth){
      const r=frames[index], scale=.91;const w=r[2]*scale,h=r[3]*scale;
      ctx.drawImage(atlas,...r,-w/2,-h,w,h);
    }else if(idle.complete&&idle.naturalWidth){ctx.drawImage(idle,-221,-442,442,442);}
    ctx.restore();
    $('effect').textContent=k==='happy'?'♡':k==='sleep'?'zZ':k==='play'?'✦':'';
  }
  function loop(ts){
    requestAnimationFrame(loop);if(document.hidden||stopped)return;
    if(ts-last<32)return;const dt=Math.min(100,ts-last||33);last=ts;const now=Date.now();brain.tick(now);
    if(!placed&&!overlay){move((stage.clientWidth-wrap.offsetWidth)/2,65);placed=true;}
    if(brain.kind==='roam'&&!menuOpen){
      if(native)native.moveBy(dir*dt*.025,0);
      else {const old=px;move(px+dir*dt*.025,py);if(px===old)dir*=-1;}
    }
    draw(now);$('bubble').textContent=now<brain.messageUntil?brain.message:'';
    if(now-lastStats>500){sync();lastStats=now;}
    if(now-lastSave>10000||brain.kind!==lastState){save();lastSave=now;lastState=brain.kind;}
  }
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>act(b.dataset.action)));
  $('menuClose').onclick=()=>showMenu(false);
  $('chatClose').onclick=closeChat;
  $('chatForm').addEventListener('submit',e=>{e.preventDefault();sendChat();});
  $('stop').onclick=()=>{save();if(native){native.closePet();return;}stopped=true;showMenu(false);wrap.hidden=true;$('restore').hidden=false;};
  $('restore').onclick=()=>{stopped=false;wrap.hidden=false;$('restore').hidden=true;brain.act('pet');};
  canvas.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act('pet');}if(e.key==='Escape')showMenu(false);});
  // Android handles raw screen coordinates, so moving the overlay cannot feed back into drag deltas.
  if(!native){
    let pointer=null,holdTimer=0,tapTimer=0,lastTap=0;
    canvas.onpointerdown=e=>{if(stopped)return;canvas.setPointerCapture(e.pointerId);pointer={id:e.pointerId,x:e.clientX,y:e.clientY,px,py,drag:false,held:false};
      holdTimer=setTimeout(()=>{if(pointer&&!pointer.drag){pointer.held=true;showMenu();}},550);};
    canvas.onpointermove=e=>{if(!pointer||pointer.id!==e.pointerId)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
      if(!pointer.drag&&Math.hypot(dx,dy)>8){clearTimeout(holdTimer);clearTimeout(tapTimer);pointer.drag=true;brain.drag(true);showMenu(false);}
      if(pointer.drag)move(pointer.px+dx,pointer.py+dy);};
    function end(e,cancel){if(!pointer||pointer.id!==e.pointerId)return;clearTimeout(holdTimer);
      if(pointer.drag){brain.drag(false);save();}else if(!cancel&&!pointer.held){const now=Date.now();if(now-lastTap<300){clearTimeout(tapTimer);act('play');lastTap=0;}else{lastTap=now;tapTimer=setTimeout(()=>act('pet'),300);}}
      pointer=null;}
    canvas.onpointerup=e=>end(e,false);canvas.onpointercancel=e=>end(e,true);
  }
  window.pet={act,showMenu,setDragging:active=>{brain.drag(active);showMenu(false);sync();save();},turn:()=>{dir*=-1;},save,
    snapshot:()=>({...brain.save(),kind:brain.kind,message:brain.message}),resetPosition:()=>move((stage.clientWidth-wrap.offsetWidth)/2,65),
    // 原生层把 DSH 的回复/播报/进度推回来
    onReply:text=>{chatBusy=false;hideThinking();
      chatAdd('pet',text);brain.say(text.length>60?text.slice(0,60)+'…':text,Date.now(),9000);},
    onPush:text=>{if(!text)return;brain.say(text,Date.now(),9000);if($('chat')&&!$('chat').hidden)chatAdd('pet',text);},
    onProgress:json=>{try{const p=JSON.parse(json);if(!p.busy)return;
      const secs=Math.round((p.elapsedMs||0)/1000);
      showThinking((p.phase||'正在想…')+(secs>=2?`（已 ${secs} 秒）`:''));
    }catch(_){}}};
  window.addEventListener('resize',()=>{if(placed)move(px,py);});
  document.addEventListener('visibilitychange',()=>{save();last=0;});window.addEventListener('pagehide',save);
  sync();requestAnimationFrame(loop);
})();
