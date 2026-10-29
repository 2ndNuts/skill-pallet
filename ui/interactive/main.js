import {DEFAULT_RULES,planLabel,hoverRole} from '../shared/chip-typography.js';
import {genreStyle} from '../shared/genre-palette.js';
import {createWoodGrid} from './wood-grid.js';
import {createInertialScroll} from './inertial-scroll.js';
import {createGenreSwipe} from './genre-swipe.js';
import {createGenreTransition,trayPose} from './genre-transition.js';
import {GENRE_NAMES,enrichCatalog,matchingSkills,buildEntries} from './catalog-model.js';
import {stageFor,STAGES,usageIdentity} from './usage-model.js';
import {createRuntime,nativeCatalog} from './runtime.js';
import {createUISound} from './ui-audio.js';
import {soundVolume,volumeFromState,nextSoundVolume,soundVolumeIcon} from './sound-volume.js';
import {createArrivalReplay} from './arrival-motion.js';
import {MOTION} from './motion-tokens.js';

async function boot(){
const $=s=>document.querySelector(s),trayStage=$('.grid-stage'),traySurface=$('.tray-surface'),grid=$('#grid'),viewport=$('#viewport'),tooltip=$('#tooltip'),stage=$('#stage-frame'),palette=$('.palette');
const runtime=await createRuntime().catch(error=>{
  const output=$('#action-status');output.textContent='アプリを読み込めませんでした：'+error.message;output.hidden=false;throw error;
});
const uiSound=createUISound({native:runtime.native,sendNative:(kind,take,strength)=>runtime.soundCue(kind,take,strength)});
let catalog=enrichCatalog(nativeCatalog(runtime.state.skills||[]));
let priority=catalog.map(s=>s.name);
const favorites=new Set(runtime.native?runtime.state.favorites:['cinetic','anime-grilling','earshot']),expanded=new Set();
let usageCounts=runtime.state.usage?.counts||{},actionTimer,lastNativeError='',hoverSoundTimer=null,keyboardPress=null;
const arrivalReplay=createArrivalReplay({sequence:runtime.state.arrivalSequence??0,playArrival:!runtime.native||runtime.state.playArrival!==false});
let lastNativeStatus=runtime.state.status||'';
let lastWindowDragSequence=-1;
let wasCollectionMoving=false;
const catalogSignature=skills=>JSON.stringify((skills||[]).map(s=>[s.id,s.name,s.summary,s.description,s.source,s.invocation,s.genres,s.tags]));
let catalogStamp=runtime.native?catalogSignature(runtime.state.skills):'',favoriteStamp=JSON.stringify([...favorites].sort());
let rules=DEFAULT_RULES.map(r=>({...r})),genre='all',query='',favoritesOnly=false,sort='frequent',scale=1,wood,inertia,genreSwipe,genreTransition,outgoingSurface=null,lastPointer=null,activeKey=null,inspectedKey=null,selectedKey=null,tipTimer=null,renderFrame=null,layoutAction=null;
const plans=new Map(),entriesByKey=new Map(),duplicates=new Set(catalog.filter(s=>catalog.some(x=>x.key!==s.key&&x.name===s.name)).map(s=>s.name));
const genreNames=[['all','すべて'],...Object.entries(GENRE_NAMES)];
viewport.setAttribute('aria-description','縦スクロールで一覧を移動し、横フリックで隣のジャンルへ切り替えます。');
const useCount=entry=>entry.kind==='stack'?0:usageCounts[usageIdentity(entry)]||0;
const patina=entry=>stageFor(useCount(entry));
const isFavorite=entry=>favorites.has(runtime.native?entry.key:entry.name);
const matches=()=>matchingSkills(catalog,{genre,query,favoritesOnly,favorites,sort,priority,getUsageCount:useCount});
const entryFor=button=>entriesByKey.get(button.dataset.key);
const buttonFor=key=>[...grid.querySelectorAll('.skill-chip')].find(b=>b.dataset.key===key);
function actionStatus(message,error=false){
  const output=$('#action-status');clearTimeout(actionTimer);output.replaceChildren();output.hidden=!message;output.classList.toggle('error',error);
  if(message){const text=document.createElement('span'),close=document.createElement('button');text.textContent=message;close.type='button';close.className='status-close';close.textContent='×';close.setAttribute('aria-label','案内を閉じる');close.addEventListener('click',()=>actionStatus(''));output.append(text,close);}
  if(message&&!error)actionTimer=setTimeout(()=>{output.hidden=true;},3500);
}
function applyPatina(button,entry){
  const stage=patina(entry);button.dataset.patinaStage=String(stage.stage);button.dataset.usageCount=String(useCount(entry));
  button.style.setProperty('--chip-ink',stage.ink);button.style.setProperty('--chip-hover-ink',stage.ink);
  button.setAttribute('aria-description',entry.kind==='stack'?entry.summary:`${entry.summary} 直近30日：${useCount(entry)}回。`);
  wood?.setPatina(entry.key,stage);
}
function updateRuntime(state){
  const nextCounts=state.usage?.counts||{},usageChanged=JSON.stringify(nextCounts)!==JSON.stringify(usageCounts);
  usageCounts=nextCounts;
  let rebuild=false;
  const volume=soundVolume(volumeFromState(state));
  uiSound.setVolume(volume.value);
  for(const id of ['#sound','#native-sound']){
    const button=$(id);button.removeAttribute('aria-pressed');button.innerHTML=soundVolumeIcon(volume.value);button.dataset.volume=String(volume.value);
    button.setAttribute('aria-label','操作音の音量：'+volume.label);
    button.title=`音量：${volume.label}${volume.value===2?'（標準より約6dB大きい）':''}。クリックで${soundVolume(nextSoundVolume(volume.value)).label}へ切り替えます。`;
  }
  if(runtime.native){
    const stamp=catalogSignature(state.skills);
    if(stamp!==catalogStamp){catalogStamp=stamp;catalog=enrichCatalog(nativeCatalog(state.skills||[]));priority=catalog.map(s=>s.name);duplicates.clear();for(const skill of catalog)if(catalog.some(x=>x.key!==skill.key&&x.name===skill.name))duplicates.add(skill.name);rebuild=true;}
    const nextFavoriteStamp=JSON.stringify([...(state.favorites||[])].sort());
    if(nextFavoriteStamp!==favoriteStamp){favoriteStamp=nextFavoriteStamp;favorites.clear();for(const key of state.favorites||[])favorites.add(key);rebuild=true;}
    $('#native-permission').hidden=!!state.trusted;$('#native-refresh').disabled=!!state.loading||!!state.inserting;$('#catalog-setup').disabled=!!state.inserting;$('#native-format').value=state.format||'slash';
    $('#pin').setAttribute('aria-pressed',String(!!state.pinned));
    $('#pin').title=state.pinned?'最前面への固定を解除':'最前面に固定';
    if(arrivalReplay.observe(state.arrivalSequence)){
      clearTimeout(hoverSoundTimer);hideTip();
      const hovered=grid.querySelector('.is-hover');if(hovered)leave(hovered);
      queueLayout();
    }
    for(const button of grid.querySelectorAll('.skill-chip'))button.disabled=!!state.inserting;
    grid.setAttribute('aria-busy',String(!!state.inserting));
    const nextError=state.error?state.status:'';if(nextError&&nextError!==lastNativeError)actionStatus(nextError,true);lastNativeError=nextError;
    if(state.status&&state.status!==lastNativeStatus&&!state.error)actionStatus(state.status);lastNativeStatus=state.status||'';
  }
  $('#usage-save-state').textContent=state.usageError||'';$('#usage-save-state').hidden=!state.usageError;
  if(state.usageError&&runtime.native)actionStatus(state.usageError,true);
  if(rebuild&&wood)renderCards({preserveScroll:true});
  else if(usageChanged){for(const button of grid.querySelectorAll('.skill-chip'))applyPatina(button,entryFor(button));}
  if(inspectedKey&&entriesByKey.has(inspectedKey))inspect(entriesByKey.get(inspectedKey));
}
function roleFor(entry){
  return hoverRole(entry,genre);
}
function hideTip(){clearTimeout(tipTimer);tooltip.hidden=true;for(const b of grid.querySelectorAll('[aria-describedby]'))b.removeAttribute('aria-describedby');}
function showTip(button,entry){
  if(genreTransition?.active)return;
  if(activeKey!==entry.key)return;
  tooltip.querySelector('p').textContent=entry.summary;tooltip.style.setProperty('--tip-color',roleFor(entry).color);tooltip.hidden=false;
  const b=button.getBoundingClientRect(),t=tooltip.getBoundingClientRect();
  const left=Math.max(12,Math.min(innerWidth-t.width-12,b.left+b.width/2-t.width/2));
  let top=b.top-t.height-9;if(top<8)top=b.bottom+9;top=Math.max(8,Math.min(innerHeight-t.height-8,top));
  tooltip.style.left=`${left}px`;tooltip.style.top=`${top}px`;button.setAttribute('aria-describedby','tooltip');
}
function inspect(entry){
  inspectedKey=entry.key;const role=roleFor(entry),plan=plans.get(entry.key);
  $('#detail-name').textContent=entry.name;$('#detail-summary').textContent=entry.summary;
  $('#detail-category').textContent=entry.genres.map(g=>GENRE_NAMES[g]).filter(Boolean).join('・');$('.inspector').style.setProperty('--detail-color',role.color);
  $('#type-name').textContent=entry.name;
  $('#usage-detail').textContent=entry.kind==='stack'?'中のスキルごとに色が育ちます。':`直近30日：${useCount(entry)}回 · ${patina(entry).label}`;
  if(entry.kind==='stack')$('#type-details').textContent=`${entry.members.length}枚のスキルをまとめたスタック`;
  else if(plan)$('#type-details').textContent=`${plan.chars}文字 / ${plan.chunks}区切り → ${plan.size}px・${plan.weight} / ${plan.lines.length}行${plan.fallback?'（語内改行あり）':''}`;
}
function enter(button,immediate=false,sounded=true){
  if(genreTransition?.active)return;
  if((inertia?.moving||genreSwipe?.active||wood?.collectionMoving)&&!immediate)return;const entry=entryFor(button);if(!entry)return;const changed=activeKey!==entry.key;activeKey=entry.key;
  grid.querySelector('.is-hover')?.classList.remove('is-hover');button.classList.add('is-hover');wood.hover(entry.key);inspect(entry);hideTip();
  tipTimer=setTimeout(()=>showTip(button,entry),immediate?0:MOTION.tooltipDwell);
  if(changed&&sounded){clearTimeout(hoverSoundTimer);hoverSoundTimer=setTimeout(()=>{if(activeKey===entry.key&&!inertia?.moving&&!wood.collectionMoving)uiSound.hover(entry.key,performance.now());},MOTION.hoverDwell);}
}
function leave(button){button.classList.remove('is-hover');if(activeKey===button.dataset.key){clearTimeout(hoverSoundTimer);activeKey=null;wood.hover(null);hideTip();}}
function pointAt(button,event){const b=button.querySelector('.chip-print').getBoundingClientRect();wood.pointer(button.dataset.key,(event.clientX-b.left)/b.width*2-1,(event.clientY-b.top)/b.height*2-1);}
function restoreHover(){
  if(!lastPointer||genreSwipe?.active||genreTransition?.active)return;const button=document.elementFromPoint(lastPointer.clientX,lastPointer.clientY)?.closest('.skill-chip');
  if(button&&grid.contains(button)){enter(button,false,false);pointAt(button,lastPointer);}
}
function ensureVisible(button){
  const b=button.getBoundingClientRect(),v=viewport.getBoundingClientRect(),top=(b.top-v.top)/scale+viewport.scrollTop,bottom=top+b.height/scale;
  if(top<viewport.scrollTop)viewport.scrollTop=top;else if(bottom>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=bottom-viewport.clientHeight;
}
function toggleStack(entry){
  const button=buttonFor(entry.key),b=button.getBoundingClientRect(),r=grid.getBoundingClientRect(),opening=!expanded.has(entry.family);
  layoutAction={family:entry.family,opening,spawn:{x:(b.left-r.left+b.width/2)/scale,y:(b.top-r.top+b.height/2)/scale}};
  opening?expanded.add(entry.family):expanded.delete(entry.family);
  renderCards({preserveScroll:true,focusKey:entry.key,revealFamily:opening?entry.family:null});
}
async function selectEntry(button,event){
  const cancelled=button.dataset.cancelClick==='true';button.dataset.cancelClick='false';if(cancelled&&event?.detail>0)return;
  const entry=entryFor(button);if(!entry||runtime.state.inserting||genreTransition?.active)return;
  wood.tap(entry.key);
  if(entry.kind==='stack'){toggleStack(entry);return;}
  if(event?.altKey){
    if(runtime.native){try{await runtime.favorite(entry);}catch(error){actionStatus(error.message,true);}}
    else{favorites.has(entry.name)?favorites.delete(entry.name):favorites.add(entry.name);renderCards();}
    return;
  }
  selectedKey=entry.key;grid.querySelector('.is-selected')?.classList.remove('is-selected');button.classList.add('is-selected');wood.select(entry.key);inspect(entry);$('#invocation').textContent='/'+entry.invocation;
  wood.pending(entry.key,true);
  try{
    await runtime.invoke(entry);inspect(entry);
    if(runtime.native)actionStatus(runtime.state.status||'入力欄に追加しました。',!!runtime.state.error);
    uiSound.success(performance.now());
  }catch(error){actionStatus(error.message,true);}finally{wood.pending(entry.key,false);}
}
function applyType(button,entry,cellWidth){
  const same=entry.kind!=='stack'&&duplicates.has(entry.name),plan=planLabel(entry.name,{width:cellWidth-18,height:entry.kind==='stack'?64:same?68:80,rules});plans.set(entry.key,plan);
  button.style.setProperty('--name-size',`${plan.size}px`);button.style.setProperty('--name-weight',String(plan.weight));button.style.setProperty('--name-leading',`${plan.leading}px`);
  button.querySelector('.skill-name').replaceChildren(...plan.lines.map(line=>{const s=document.createElement('span');s.textContent=line;return s;}));
  button.dataset.chars=String(plan.chars);button.dataset.chunks=String(plan.chunks);button.dataset.size=String(plan.size);button.dataset.weight=String(plan.weight);button.dataset.lines=String(plan.lines.length);button.dataset.rule=plan.rule;button.dataset.fallback=String(plan.fallback);
}
function syncLayout(){
  if(!wood)return;const available=stage.parentElement.getBoundingClientRect().width,baseHeight=runtime.native?665:690;scale=Math.min(1,available/460,runtime.native?innerHeight/baseHeight:1);const height=runtime.native?innerHeight/scale:baseHeight;palette.style.setProperty('--scale',String(scale));palette.style.height=`${height}px`;stage.style.width=`${460*scale}px`;stage.style.height=`${height*scale}px`;document.documentElement.style.setProperty('--scaled-stage-height',`${height*scale}px`);
  const gridRect=grid.getBoundingClientRect(),items=[];
  for(const button of grid.querySelectorAll('.skill-chip')){
    const rect=button.getBoundingClientRect(),entry=entryFor(button),size=rect.width/scale,x=(rect.left-gridRect.left)/scale,y=(rect.top-gridRect.top)/scale;
    applyType(button,entry,size);
    applyPatina(button,entry);
    const spawn=layoutAction?.opening&&button.dataset.parentStack===layoutAction.family&&y<viewport.scrollTop+viewport.clientHeight+20?layoutAction.spawn:null;
    items.push({key:entry.key,x,y,size,role:roleFor(entry),patina:patina(entry),stack:entry.kind==='stack',animate:!!layoutAction,spawn,print:button.querySelector('.chip-print'),button});
  }
  wood.layout(items,viewport.clientWidth,viewport.clientHeight,viewport.scrollTop,trayStage.clientWidth);layoutAction=null;
  if(arrivalReplay.take(items.length>0&&!document.hidden))wood.startIntro();
  if(inspectedKey&&entriesByKey.has(inspectedKey))inspect(entriesByKey.get(inspectedKey));
}
function queueLayout(){cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(()=>{renderFrame=null;syncLayout();});}
function cancelStartup(){if(genreTransition?.active)return;arrivalReplay.cancel();wood?.cancelIntro();wood?.finishCollectionMotion();wood?.resetWindowMotion();uiSound.endWindowMove(performance.now());}
function handoffToScroll(){arrivalReplay.cancel();wood?.cancelIntro();wood?.finishCollectionMotion();clearTimeout(hoverSoundTimer);hideTip();const hovered=grid.querySelector('.is-hover');if(hovered)leave(hovered);}
function makeCard(entry,parent=null){
  let pressedBounds=null;
  entriesByKey.set(entry.key,entry);const isStack=entry.kind==='stack',button=document.createElement('button');button.type='button';button.className='skill-chip'+(isStack?' stack-chip':'')+(selectedKey===entry.key?' is-selected':'');button.dataset.key=entry.key;button.dataset.name=entry.name;button.dataset.kind=entry.kind;button.dataset.genres=entry.genres.join(' ');if(entry.family)button.dataset.family=entry.family;if(parent)button.dataset.parentStack=parent;
  button.setAttribute('aria-label',isStack?`${entry.name}（${entry.members.length}スキル）`:entry.name+(duplicates.has(entry.name)?'（'+entry.source+'）':''));button.style.setProperty('--hover-color',roleFor(entry).color);
  if(isStack){button.setAttribute('aria-expanded',String(entry.expanded));if(entry.expanded)button.setAttribute('aria-controls','stack-members-'+entry.family);}
  const print=document.createElement('span');print.className='chip-print';print.style.opacity='0';print.style.pointerEvents='none';const box=document.createElement('span');box.className='name-box';const name=document.createElement('span');name.className='skill-name';box.append(name);print.append(box);button.append(print);
  if(isStack){
    const count=document.createElement('span');count.className='stack-count';count.textContent=entry.members.length+' スキル';const mark=document.createElement('span');mark.className='stack-mark';mark.textContent=entry.expanded?'−':'+';mark.setAttribute('aria-hidden','true');print.append(count,mark);
  }else{
    if(isFavorite(entry)){const star=document.createElement('span');star.className='favorite-indicator';star.textContent='★';star.setAttribute('aria-hidden','true');print.append(star);}
    if(duplicates.has(entry.name)){const source=document.createElement('span');source.className='origin';source.textContent=entry.source;print.append(source);}
  }
  applyPatina(button,entry);
  button.addEventListener('pointerenter',event=>{enter(button);pointAt(button,event);});button.addEventListener('pointermove',event=>pointAt(button,event));button.addEventListener('pointerleave',event=>{if(!button.hasPointerCapture(event.pointerId))leave(button);});
  button.addEventListener('pointerdown',event=>{if(event.button!==0||button.disabled||runtime.state.inserting||genreTransition?.active)return;pressedBounds=button.querySelector('.chip-print').getBoundingClientRect();button.dataset.cancelClick='false';button.focus({preventScroll:true});pointAt(button,event);clearTimeout(hoverSoundTimer);hideTip();wood.press(entry.key,true);button.setPointerCapture(event.pointerId);});
  button.addEventListener('pointerup',event=>{const b=pressedBounds??button.querySelector('.chip-print').getBoundingClientRect(),outside=event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom;pressedBounds=null;button.dataset.cancelClick=String(outside);wood.press(entry.key,false,{cancelled:outside});if(outside)leave(button);if(button.hasPointerCapture(event.pointerId))button.releasePointerCapture(event.pointerId);});
  button.addEventListener('pointercancel',()=>{pressedBounds=null;button.dataset.cancelClick='true';wood.press(entry.key,false,{cancelled:true});leave(button);});button.addEventListener('lostpointercapture',()=>wood.press(entry.key,false));button.addEventListener('focus',()=>{enter(button,true);wood.pointer(entry.key,0,0);});button.addEventListener('blur',()=>{if(keyboardPress?.id===entry.key){keyboardPress=null;wood.press(entry.key,false,{cancelled:true});}leave(button);});button.addEventListener('click',event=>selectEntry(button,event));
  button.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '){
      event.preventDefault();if(event.repeat||button.disabled||runtime.state.inserting||genreTransition?.active)return;
      keyboardPress={id:entry.key,key:event.key};button.dataset.cancelClick='false';clearTimeout(hoverSoundTimer);hideTip();wood.press(entry.key,true);return;
    }
    if(event.key==='Escape'){if(keyboardPress?.id===entry.key){keyboardPress=null;wood.press(entry.key,false,{cancelled:true});}if(parent){event.preventDefault();toggleStack(entriesByKey.get('stack:'+parent));}else hideTip();return;}
    const offset=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-4,ArrowDown:4})[event.key];
    if(offset!==undefined){event.preventDefault();const buttons=[...grid.querySelectorAll('.skill-chip')],i=buttons.indexOf(button);buttons[Math.max(0,Math.min(buttons.length-1,i+offset))]?.focus();}
  });
  button.addEventListener('keyup',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();if(keyboardPress?.id!==entry.key||keyboardPress.key!==event.key)return;
    keyboardPress=null;wood.press(entry.key,false);if(!button.disabled&&!runtime.state.inserting)selectEntry(button,event);
  });return button;
}
function makePanel(entry){
  const section=document.createElement('section');section.className='stack-section';section.dataset.stack=entry.family;section.setAttribute('aria-label',entry.name+'のスキル');
  const header=document.createElement('div');header.className='stack-section-header';const title=document.createElement('strong');title.textContent=entry.name;const count=document.createElement('span');count.textContent=entry.members.length+' スキル';const close=document.createElement('button');close.type='button';close.textContent='閉じる ↑';close.setAttribute('aria-label',entry.name+'を閉じる');close.addEventListener('click',()=>toggleStack(entry));header.append(title,count,close);
  const members=document.createElement('div');members.className='stack-members';members.id='stack-members-'+entry.family;for(const skill of entry.members)members.append(makeCard({...skill,kind:'skill'},entry.family));section.append(header,members);return section;
}
function renderCards({preserveScroll=false,focusKey=null,revealFamily=null,genreChange=false}={}){
  if(!genreChange)genreTransition?.cancel();
  const oldScroll=viewport.scrollTop;hideTip();activeKey=null;wood?.hover(null);wood?.press(null,false);plans.clear();entriesByKey.clear();const skills=matches(),entries=buildEntries(skills,{query,expanded,sort});grid.replaceChildren();
  let pending=[];
  entries.forEach((entry,index)=>{
    grid.append(makeCard(entry));if(entry.kind==='stack'&&entry.expanded)pending.push(entry);
    if(index%4===3||index===entries.length-1){for(const group of pending)grid.append(makePanel(group));pending=[];}
  });
  viewport.scrollTop=preserveScroll?oldScroll:0;inertia?.reset();
  const stacks=entries.filter(e=>e.kind==='stack').length;$('#count').textContent=`${skills.length} スキル${stacks?' · '+stacks+' スタック':''}`;$('#count').dataset.skills=String(skills.length);$('#count').dataset.stacks=String(stacks);$('#empty').hidden=skills.length>0;
  const needsCatalog=runtime.native&&catalog.length===0;
  $('#empty-message').textContent=needsCatalog?'カタログを作成して、スキルを並べましょう。':favoritesOnly?'お気に入りのスキルがありません。':'該当するスキルがありません';$('#catalog-setup').hidden=!needsCatalog;
  if(!skills.length){inspectedKey=null;$('#detail-name').textContent=needsCatalog?'カタログを作成する':'見つかりませんでした';$('#detail-summary').textContent=needsCatalog?'Codexへの依頼を送信すると、更新した一覧がここに反映されます。':'別の言葉に変えるか、ジャンルの絞り込みを外してください。';$('#detail-category').textContent='';$('#usage-detail').textContent='';}
  else inspect(entriesByKey.get(selectedKey)||entries[0]);
  if(focusKey){const button=buttonFor(focusKey);if(button){ensureVisible(button);button.focus({preventScroll:true});}}
  if(revealFamily){const section=grid.querySelector(`[data-stack="${revealFamily}"]`),first=section?.querySelector('.skill-chip');if(first)ensureVisible(first);}
  queueLayout();
}
function renderRules(){
  $('#rules').replaceChildren(...rules.map((rule,index)=>{
    const row=document.createElement('div');row.className='rule';const heading=document.createElement('strong');heading.textContent=rule.label;row.append(heading);
    const controls=document.createElement('div');controls.className='rule-inputs';
    const sizeLabel=document.createElement('label');sizeLabel.textContent='上限';const input=document.createElement('input');input.type='number';input.min='13';input.max='26';input.step='.5';input.value=String(rule.size);input.setAttribute('aria-label',rule.label+'の文字サイズ');sizeLabel.append(input,document.createTextNode('px'));
    const weightLabel=document.createElement('label');weightLabel.textContent='太さ';const weight=document.createElement('select');weight.setAttribute('aria-label',rule.label+'のウェイト');for(const value of[500,550,600,650,700]){const opt=document.createElement('option');opt.value=String(value);opt.textContent=String(value);opt.selected=value===rule.weight;weight.append(opt);}weightLabel.append(weight);
    const limit=document.createElement('span');limit.className='line-limit';limit.textContent=`最大${rule.maxLines}行`;
    input.addEventListener('input',()=>{const size=Number(input.value);if(size>=13&&size<=26){rules[index].size=size;queueLayout();}});weight.addEventListener('change',()=>{rules[index].weight=Number(weight.value);queueLayout();});
    controls.append(sizeLabel,weightLabel,limit);row.append(controls);return row;
  }));
}
function applyGenre(id){
  genre=id;
  for(const button of $('#genres').children)button.setAttribute('aria-pressed',String(button.dataset.genre===id));
  layoutAction=null;renderCards({genreChange:true});return true;
}
function selectGenre(id){
  if(runtime.state.inserting||runtime.state.loading||keyboardPress)return false;
  return genreTransition?genreTransition.request(id):applyGenre(id);
}
$('#genres').replaceChildren(...genreNames.map(([id,label])=>{
  const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.genre=id;b.setAttribute('aria-pressed',String(id==='all'));b.style.setProperty('--genre-color',genreStyle(id).color);
  b.addEventListener('click',()=>{genreSwipe?.cancel();selectGenre(id);});return b;
}));
$('#genre-color-legend').replaceChildren(...Object.entries(GENRE_NAMES).map(([id,label])=>{
  const item=document.createElement('span'),dot=document.createElement('i');dot.style.background=genreStyle(id).color;
  item.append(dot,document.createTextNode(label));return item;
}));
$('.search-wrap').addEventListener('submit',e=>e.preventDefault());$('#search').addEventListener('input',event=>{query=event.target.value;layoutAction=null;renderCards();});
$('#favorites').addEventListener('click',()=>{favoritesOnly=!favoritesOnly;$('#favorites').setAttribute('aria-pressed',String(favoritesOnly));renderCards();});$('#sort').addEventListener('change',event=>{sort=event.target.value;renderCards();});
$('#reset').addEventListener('click',()=>{rules=DEFAULT_RULES.map(r=>({...r}));renderRules();queueLayout();});
$('#native-permission').addEventListener('click',()=>runtime.permission().catch(error=>actionStatus(error.message,true)));
const requestCatalogUpdate=()=>runtime.updateCatalog().catch(error=>actionStatus(error.message,true));
$('#native-refresh').addEventListener('click',requestCatalogUpdate);$('#catalog-setup').addEventListener('click',requestCatalogUpdate);
$('#native-format').addEventListener('change',event=>runtime.format(event.target.value).catch(error=>actionStatus(error.message,true)));
$('#native-sound').addEventListener('click',()=>runtime.soundVolume(nextSoundVolume(volumeFromState(runtime.state))).catch(error=>actionStatus(error.message,true)));
$('#sound').addEventListener('click',()=>runtime.soundVolume(nextSoundVolume(volumeFromState(runtime.state))).catch(error=>actionStatus(error.message,true)));
$('#pin').addEventListener('click',()=>runtime.pin(!runtime.state.pinned).catch(error=>actionStatus(error.message,true)));
$('#usage-legend').replaceChildren(...STAGES.map(stage=>{
  const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=stage.color;
  item.append(swatch,document.createTextNode(stage.maximum===null?`${stage.minimum}以上`:`${stage.minimum}〜${stage.maximum}`));return item;
}));
$('#usage-mode-note').textContent=runtime.native?'追記成功時の使用を30日間記録します。':'この試作ではチップの選択を30日間記録します。アプリの履歴とは別に保存します。';
runtime.subscribe(updateRuntime);updateRuntime(runtime.state);
viewport.addEventListener('scroll',()=>{
  hideTip();wood?.setScroll(viewport.scrollTop);const focused=document.activeElement;
  if(!inertia?.moving&&!genreSwipe?.active&&focused?.matches('.skill-chip')&&activeKey===focused.dataset.key){const r=focused.getBoundingClientRect(),v=viewport.getBoundingClientRect();if(r.top>=v.top-1&&r.bottom<=v.bottom+1)tipTimer=setTimeout(()=>showTip(focused,entryFor(focused)),80);}
},{passive:true});window.addEventListener('scroll',hideTip,{passive:true});window.addEventListener('resize',()=>{genreTransition?.cancel();if(wood?.introPlaying)wood.cancelIntro();hideTip();queueLayout();});
viewport.addEventListener('pointermove',event=>{lastPointer={clientX:event.clientX,clientY:event.clientY};},{passive:true});viewport.addEventListener('pointerleave',()=>{lastPointer=null;},{passive:true});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();$('#search').focus();$('#search').select();}if(event.key==='Escape'){hideTip();actionStatus('');}});
document.addEventListener('pointerdown',cancelStartup,{capture:true});document.addEventListener('keydown',cancelStartup,{capture:true});
window.addEventListener('blur',()=>{keyboardPress=null;genreSwipe?.cancel();wood?.press(null,false);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){genreTransition?.cancel();keyboardPress=null;clearTimeout(hoverSoundTimer);genreSwipe?.cancel();inertia?.stop();wood?.cancelIntro();wood?.finishCollectionMotion();wood?.resetWindowMotion();wood?.resetPresses();uiSound.endWindowMove(performance.now());}else queueLayout();});
window.addEventListener('skill-pallet-window-motion',event=>{
  if(!wood||document.hidden||!wood.receiveWindowMotion({...event.detail,vx:event.detail.vx/scale,vy:event.detail.vy/scale}))return;
  if(event.detail.dragging)uiSound.windowActivity(true,performance.now());
  if(event.detail.dragging&&event.detail.sequence!==lastWindowDragSequence){
    lastWindowDragSequence=event.detail.sequence;lastPointer=null;arrivalReplay.cancel();wood.cancelIntro();wood.finishCollectionMotion();
    clearTimeout(hoverSoundTimer);hideTip();const hovered=grid.querySelector('.is-hover');if(hovered)leave(hovered);
  }
});
// Catalog update intentionally passes keyboard focus to Codex while the palette
// remains visible. A focus change alone must not cancel its requested arrival.
window.addEventListener('blur',()=>{clearTimeout(hoverSoundTimer);hideTip();});
try{
  await document.fonts.ready;wood=await createWoodGrid($('#wood'),{
    onContact:({index,now})=>uiSound.contact(index,now),
    onMotionFrame:({contacts,moving,dragging,scrolling,transporting,collectionMoving,now,elapsed})=>{
      uiSound.collisionFrame(contacts,now,elapsed,moving||dragging||scrolling||transporting);
      if(wasCollectionMoving&&!collectionMoving&&!inertia?.moving)restoreHover();wasCollectionMoving=collectionMoving;
    }
  });
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  genreTransition=createGenreTransition({initial:genre,order:genreNames.map(([id])=>id),reduced:()=>reduced.matches,
    onStart({to,instant}){
      inertia?.stop();handoffToScroll();
      if(renderFrame!==null){cancelAnimationFrame(renderFrame);renderFrame=null;syncLayout();}
      if(!instant){
        outgoingSurface=traySurface.cloneNode(true);outgoingSurface.classList.add('tray-outgoing');outgoingSurface.setAttribute('aria-hidden','true');outgoingSurface.inert=true;
        for(const element of outgoingSurface.querySelectorAll('[id]'))element.removeAttribute('id');
        for(const element of outgoingSurface.querySelectorAll('[aria-controls],[aria-describedby]')){element.removeAttribute('aria-controls');element.removeAttribute('aria-describedby');}
        trayStage.append(outgoingSurface);outgoingSurface.querySelector('.grid-viewport').scrollTop=viewport.scrollTop;
        wood.retainOutgoing(outgoingSurface.querySelectorAll('.skill-chip'));uiSound.beginScroll(performance.now());
      }
      trayStage.dataset.genreTransition='moving';grid.inert=true;$('#empty').inert=true;grid.setAttribute('aria-busy','true');
      applyGenre(to);cancelAnimationFrame(renderFrame);renderFrame=null;syncLayout();wood.finishCollectionMotion();
    },
    onFrame({elapsed,direction,at,instant}){
      if(instant)return;
      const pose=trayPose(elapsed,trayStage.clientWidth,direction);
      traySurface.style.transform=`translate3d(${pose.incoming}px,0,0)`;
      if(outgoingSurface)outgoingSurface.style.transform=`translate3d(${pose.outgoing}px,0,0)`;
      wood.setTrayMotion(pose.incoming,pose.outgoing,at);
    },
    onFinish({instant,cancelled}){
      wood.finishTransition({silent:instant||cancelled});outgoingSurface?.remove();outgoingSurface=null;
      traySurface.style.transform='';trayStage.dataset.genreTransition='idle';grid.inert=false;$('#empty').inert=false;
      grid.setAttribute('aria-busy',String(!!runtime.state.inserting));uiSound.endScroll(performance.now());restoreHover();
    }
  });
  genreSwipe=createGenreSwipe(trayStage,{
    getScale:()=>scale,
    onStart(){inertia?.stop();handoffToScroll();uiSound.beginScroll(performance.now());},
    onEnd(){uiSound.endScroll(performance.now());restoreHover();},
    onSwitch(direction){
      if(runtime.state.inserting||runtime.state.loading||keyboardPress)return false;
      const current=genreNames.findIndex(([id])=>id===(genreTransition?.target??genre)),next=Math.max(0,Math.min(genreNames.length-1,current+direction));
      return next!==current?selectGenre(genreNames[next][0]):false;
    }
  });
  viewport.addEventListener('keydown',event=>{if(genreTransition.active&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))event.preventDefault();},{capture:true});
  trayStage.addEventListener('wheel',event=>{if(genreTransition.active)event.preventDefault();},{passive:false});
  inertia=createInertialScroll(viewport,{getScale:()=>scale,shouldHandleWheel:()=>!genreSwipe.active&&!genreTransition.active,onStart(){handoffToScroll();uiSound.beginScroll(performance.now());},onSettle(){uiSound.endScroll(performance.now());restoreHover();}});
  wood.setFrameHook((dt,now,elapsed)=>{
    genreTransition.tick(now);
    if(renderFrame!==null){cancelAnimationFrame(renderFrame);renderFrame=null;syncLayout();}
    inertia.tick(elapsed);wood.setScroll(viewport.scrollTop);
    palette.dataset.startup=wood.introPlaying?'playing':'settled';palette.dataset.windowMotion=wood.windowMotionState;
  });renderRules();renderCards();
  $('#ready').textContent=`${catalog.length}件を読み込みました。スタックを押すと中のスキルを展開できます。`;
}catch(error){const message=error?.message||'木目を読み込めませんでした。';$('#ready').textContent='読み込みエラー：'+message;actionStatus('読み込みエラー：'+message,true);console.error(error);}
}
boot().catch(error=>{const output=document.querySelector('#action-status');output.textContent='画面を開けませんでした：'+error.message;output.hidden=false;output.classList.add('error');console.error(error);});
