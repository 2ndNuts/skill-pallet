import {GENRE_NAMES} from '../shared/genre-palette.js';
export {GENRE_NAMES};
export const FAMILIES=[
  {id:'figma',name:'Figma',test:s=>s.name.startsWith('figma-')},
  {id:'taste',name:'Taste',test:s=>s.name.split('-').includes('taste')},
  {id:'hyperframes',name:'HyperFrames',test:s=>s.name==='hyperframes'||s.name.startsWith('hyperframes-')},
  {id:'adobe',name:'Adobe',test:s=>s.name.startsWith('adobe-')},
  {id:'google',name:'Google',test:s=>s.name.startsWith('google-')},
  {id:'notion',name:'Notion',test:s=>s.name.startsWith('notion-')||s.name==='event-production-list-notion'},
  {id:'pages',name:'Pages',test:s=>s.source==='Pages'},
];
const EXTRA_GENRES={
  earshot:['audio'],
  'real-sound':['audio','video'],
  'hyperframes-audio':['audio','video'],
  'higgsfield-generate':['video','image','audio'],
  'media-use':['video','image','audio'],
};
export const normalize=value=>value.normalize('NFKC').toLowerCase().trim();
export function enrichCatalog(skills){
  return skills.map(skill=>{
    const genres=(skill.genres?.length?skill.genres:EXTRA_GENRES[skill.name]||['organize']).map(g=>g==='media'?'video':g);
    const family=FAMILIES.find(f=>f.test(skill));
    return{...skill,genres:[...new Set(genres)],family:family?.id||null};
  });
}
export function matchingSkills(skills,{genre='all',query='',favoritesOnly=false,favorites=new Set(),sort='frequent',priority=[],getUsageCount=()=>0}={}){
  const terms=normalize(query).split(/\s+/).filter(Boolean),families=new Map(FAMILIES.map(f=>[f.id,f]));
  const rank=s=>{const i=priority.indexOf(s.name);return i<0?1000:i;};
  return skills.filter(skill=>{
    const haystack=normalize([skill.name,skill.summary,families.get(skill.family)?.name||'',...skill.tags,...skill.genres.map(g=>GENRE_NAMES[g])].join(' '));
    return(genre==='all'||skill.genres.includes(genre))&&(!favoritesOnly||favorites.has(skill.key)||favorites.has(skill.name))&&terms.every(term=>haystack.includes(term));
  }).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name)||a.source.localeCompare(b.source):getUsageCount(b)-getUsageCount(a)||rank(a)-rank(b)||a.name.localeCompare(b.name));
}
export function buildEntries(skills,{query='',expanded=new Set(),sort='frequent'}={}){
  // Searching always returns individual skills, including matches in a folded family.
  if(normalize(query))return skills.map(s=>({...s,kind:'skill'}));
  const families=new Map(FAMILIES.map(f=>[f.id,f])),members=new Map();
  for(const skill of skills)if(skill.family){if(!members.has(skill.family))members.set(skill.family,[]);members.get(skill.family).push(skill);}
  const seen=new Set(),entries=[];
  for(const skill of skills){
    const group=members.get(skill.family);
    if(!group||group.length<2){entries.push({...skill,kind:'skill'});continue;}
    if(seen.has(skill.family))continue;seen.add(skill.family);
    const family=families.get(skill.family),open=expanded.has(family.id);
    entries.push({key:'stack:'+family.id,name:family.name,kind:'stack',family:family.id,members:group,genres:[...new Set(group.flatMap(s=>s.genres))],tags:[],source:'',expanded:open,summary:`${family.name}の${group.length}スキル。クリックで${open?'閉じます':'展開します'}。`});
  }
  return sort==='name'?entries.sort((a,b)=>a.name.localeCompare(b.name)||a.source.localeCompare(b.source)):entries;
}
