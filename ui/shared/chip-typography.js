export const FONT='-apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';
export const DEFAULT_RULES=[
  {id:'short',label:'10文字・2区切りまで',maxChars:10,maxChunks:2,size:22,weight:650,maxLines:2},
  {id:'medium',label:'18文字・3区切りまで',maxChars:18,maxChunks:3,size:18,weight:650,maxLines:3},
  {id:'long',label:'26文字・4区切りまで',maxChars:26,maxChunks:4,size:15.5,weight:600,maxLines:4},
  {id:'longest',label:'それ以上',maxChars:Infinity,maxChunks:Infinity,size:14,weight:600,maxLines:4},
];
let measureCanvas;
const measuredWidths=new Map();
const context=()=>{measureCanvas??=document.createElement('canvas');return measureCanvas.getContext('2d');};
const chars=s=>Array.from(s).length;
export function nameMetrics(name){return{chars:chars(name),chunks:name.split('-').filter(Boolean).length};}
export function widthOf(text,size,weight){const key=`${text}|${size}|${weight}`;if(measuredWidths.has(key))return measuredWidths.get(key);const ctx=context();ctx.font=`${weight} ${size}px ${FONT}`;ctx.fontKerning='normal';const width=ctx.measureText(text).width+Math.max(0,chars(text)-1)*size*-.015;if(measuredWidths.size>40000)measuredWidths.clear();measuredWidths.set(key,width);return width;}
function partitions(tokens){
  if(tokens.length===1)return[[tokens[0]]];
  const result=[];
  for(let mask=0;mask<2**(tokens.length-1);mask++){
    const lines=[];let line=tokens[0];
    for(let i=1;i<tokens.length;i++){if(mask&(1<<(i-1))){lines.push(line);line=tokens[i];}else line+=tokens[i];}
    lines.push(line);result.push(lines);
  }
  return result;
}
// Explicit line-break positions for long compound words used by this catalog.
// The name itself is never abbreviated and no extra hyphen is inserted.
const SOFT_CUTS={hyperframes:[5],hyperresearch:[5],documentation:[7],implementation:[8],presentations:[6],spreadsheets:[6],enforcement:[7]};
function withSoftCuts(tokens,size,weight,width){
  return tokens.flatMap(token=>{
    const dash=token.endsWith('-')?'-':'',word=dash?token.slice(0,-1):token,cuts=SOFT_CUTS[word.toLowerCase()];
    if(!cuts||widthOf(token,size,weight)<=width)return[token];
    const points=[0,...cuts,word.length],parts=points.slice(1).map((end,i)=>word.slice(points[i],end));
    parts[parts.length-1]+=dash;return parts;
  });
}
function splitLongToken(token,size,weight,width){
  if(widthOf(token,size,weight)<=width)return[token];
  let best;
  for(let i=3;i<=token.length-3;i++){
    const a=token.slice(0,i),b=token.slice(i),wa=widthOf(a,size,weight),wb=widthOf(b,size,weight);
    if(b.startsWith('-'))continue;
    const cost=Math.max(wa,wb)+Math.abs(wa-wb)*.25;
    if(wa<=width&&wb<=width&&(!best||cost<best.cost))best={lines:[a,b],cost};
  }
  return best?.lines||[token];
}
export function planLabel(name,{width=84.5,height=80,rules=DEFAULT_RULES}={}){
  const metrics=nameMetrics(name),rule=rules.find(r=>metrics.chars<=r.maxChars&&metrics.chunks<=r.maxChunks)||rules.at(-1);
  const tokens=name.match(/[^-]+-?/g)||[name];
  for(let size=rule.size;size>=13;size-=.5){
    const leading=Math.round(size*1.13*2)/2;
    const options=partitions(withSoftCuts(tokens,size,rule.weight,width));
    const candidates=options.filter(lines=>lines.length<=rule.maxLines&&lines.length*leading<=height).map(lines=>{
      const widths=lines.map(line=>widthOf(line,size,rule.weight));
      const mean=widths.reduce((a,b)=>a+b,0)/widths.length;
      const balance=widths.reduce((a,b)=>a+(b-mean)**2,0)/widths.length;
      const lonely=lines.reduce((sum,line)=>sum+(line.replace(/-/g,'').length<=2?150:0),0);
      return{lines,widths,cost:lines.length*240+balance*.65+lonely};
    }).filter(x=>x.widths.every(w=>w<=width+.1)).sort((a,b)=>a.cost-b.cost);
    if(candidates.length){const best=candidates[0];return{...metrics,rule:rule.id,size,weight:rule.weight,leading,lines:best.lines,widths:best.widths,fallback:false};}
  }
  // Only an overlong single token may break inside a word; keep the full name.
  const size=13,leading=15,lines=tokens.flatMap(token=>splitLongToken(token,size,rule.weight,width));
  return{...metrics,rule:rule.id,size,weight:rule.weight,leading,lines,widths:lines.map(s=>widthOf(s,size,rule.weight)),fallback:true};
}
const AUDIO_NAMES=new Set(['earshot','real-sound','hyperframes-audio']);
export function hoverRole(skill){
  if(AUDIO_NAMES.has(skill.name))return{id:'audio',label:'音',color:'#c8ef78',stain:'#304315'};
  if(skill.genres[0]==='media')return{id:'video',label:'映像',color:'#79b7ff',stain:'#193f6b'};
  return{id:skill.genres[0]||'other',label:({image:'画像',ui:'UI・Web',words:'調査・文章',data:'資料・データ',organize:'整理・連携'})[skill.genres[0]]||'スキル',color:'#7ecefd',stain:'#204a5b'};
}
