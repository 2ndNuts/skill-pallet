import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCatalog,createRuntime} from './runtime.js';
import {enrichCatalog,matchingSkills,buildEntries,GENRE_NAMES} from './catalog-model.js';
import {GENRE_STYLES,NEUTRAL_GENRE,genreStyle} from '../shared/genre-palette.js';
import {hoverRole} from '../shared/chip-typography.js';
import {usageIdentity} from './usage-model.js';
import {PREVIEW_SOUND_VOLUME_KEY} from './sound-volume.js';

const skill={id:'/tmp/my-skill/SKILL.md',name:'cross-media',invocation:'tools:cross-media',source:'Tools',summary:'画像と映像を整える。',description:'Media tools.',genres:['image','video'],tags:['絵作り','movie']};

test('all seven catalog genres have distinct approved rim colors, including newly named skills',()=>{
  const colors={audio:'#C8EF78',video:'#79B7FF',image:'#F08B79',ui:'#B59AE8',words:'#E7C84B',data:'#55B9AE',organize:'#DF91B3'};
  assert.deepEqual(Object.keys(GENRE_NAMES),Object.keys(colors));
  assert.equal(new Set(Object.values(GENRE_STYLES).map(style=>style.color)).size,7);
  for(const [id,color]of Object.entries(colors)){
    const entry={name:'new-skill-'+id,genres:[id]};
    assert.equal(hoverRole(entry).color,color);assert.equal(genreStyle(id).color,color);
    assert.equal(hoverRole(entry).label,GENRE_NAMES[id]);
  }
  assert.equal(hoverRole({name:'old-video',genres:['media']}).color,colors.video);
  assert.equal(hoverRole({name:'unclassified'}),NEUTRAL_GENRE);
  assert.equal(genreStyle('__proto__'),NEUTRAL_GENRE);
});

test('a cross-genre skill follows the visible genre without rewriting its catalog metadata',()=>{
  const catalog=enrichCatalog(nativeCatalog([skill])),before=JSON.stringify(catalog);
  assert.equal(hoverRole(catalog[0]).color,genreStyle('image').color);
  for(const genre of ['image','video']){
    const visible=matchingSkills(catalog,{genre});assert.equal(visible.length,1);
    assert.equal(hoverRole(visible[0],genre).color,genreStyle(genre).color);
  }
  assert.equal(JSON.stringify(catalog),before);
});

test('stack rims follow the filtered genre and otherwise use their first visible member',()=>{
  const catalog=enrichCatalog([
    {...skill,key:'a',name:'figma-a',genres:['image','ui']},
    {...skill,key:'b',name:'figma-b',genres:['video','ui']}
  ]);
  const all=buildEntries(catalog)[0];assert.equal(all.kind,'stack');
  assert.equal(hoverRole(all).color,genreStyle('image').color);
  const ui=buildEntries(matchingSkills(catalog,{genre:'ui'}))[0];
  assert.equal(ui.kind,'stack');assert.equal(hoverRole(ui,'ui').color,genreStyle('ui').color);
  const video=buildEntries(matchingSkills(catalog,{genre:'video'}))[0];
  assert.equal(video.kind,'skill');assert.equal(hoverRole(video,'video').color,genreStyle('video').color);
});

test('external metadata overrides stale preview data and matches both genres and hidden tags',()=>{
  const stale={...skill,key:'old',genres:['organize'],tags:['old']};
  const catalog=enrichCatalog(nativeCatalog([skill],[stale]));
  assert.deepEqual(catalog[0].genres,['image','video']);
  assert.deepEqual(catalog[0].tags,['絵作り','movie']);
  assert.equal(matchingSkills(catalog,{genre:'image',query:'絵作り'}).length,1);
  assert.equal(matchingSkills(catalog,{genre:'video',query:'movie'}).length,1);
  assert.equal(matchingSkills(catalog,{genre:'audio'}).length,0);
  assert.equal(matchingSkills(catalog,{query:'old'}).length,0);
});

test('a moved skill retains its usage identity while receiving a new reference path',()=>{
  const moved={...skill,id:'/tmp/new-version/SKILL.md'};
  assert.equal(usageIdentity(skill),usageIdentity(moved));
  assert.equal(nativeCatalog([moved])[0].key,moved.id);
});

test('native bootstrap and catalog-update requests do not fetch the browser preview catalog',async()=>{
  const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
  const calls=[];
  const initial={skills:[skill],usage:{windowDays:30,counts:{[usageIdentity(skill)]:3}},favorites:[]};
  globalThis.window={webkit:{messageHandlers:{skillPallet:{postMessage:async body=>{calls.push(body);return{ok:true,state:initial};}}}},addEventListener(){}};
  globalThis.document={documentElement:{classList:{add(){}}}};
  globalThis.fetch=()=>{throw new Error('Native mode fetched the preview catalog');};
  try{
    const runtime=await createRuntime();
    assert.equal(runtime.native,true);
    await runtime.updateCatalog();
    assert.deepEqual(calls,[{action:'bootstrap'},{action:'updateCatalog'}]);
    assert.equal(runtime.state.usage.counts[usageIdentity(skill)],3);
    assert.equal(runtime.state.skills[0].id,skill.id);
  }finally{Object.assign(globalThis,previous);}
});

test('native volume controls pass the selected step and receive it back in state',async()=>{
  const previous={window:globalThis.window,document:globalThis.document},calls=[];
  let state={skills:[skill],sound:true,soundVolume:1};
  globalThis.window={webkit:{messageHandlers:{skillPallet:{postMessage:async body=>{
    calls.push(body);if(body.action==='soundVolume')state={...state,soundVolume:body.value,sound:body.value>0};
    return{ok:true,state};
  }}}},addEventListener(){}};
  globalThis.document={documentElement:{classList:{add(){}}}};
  try{
    const runtime=await createRuntime();await runtime.soundVolume(2);
    assert.equal(runtime.state.soundVolume,2);assert.equal(runtime.state.sound,true);
    await runtime.soundVolume(0);assert.equal(runtime.state.sound,false);
    assert.deepEqual(calls,[{action:'bootstrap'},{action:'soundVolume',value:2},{action:'soundVolume',value:0}]);
    await assert.rejects(runtime.soundVolume(7));assert.equal(calls.length,3);
  }finally{Object.assign(globalThis,previous);}
});

test('browser volume survives recreation without changing usage history',async()=>{
  const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval};
  const saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  globalThis.window={localStorage:storage,addEventListener(){}};
  globalThis.document={baseURI:'https://example.invalid/interactive/',addEventListener(){}};
  globalThis.fetch=async()=>({ok:true,text:async()=>JSON.stringify({skills:[skill]})});
  globalThis.setInterval=()=>0;
  try{
    const runtime=await createRuntime();assert.equal(runtime.state.soundVolume,0);
    const before=JSON.stringify(runtime.state.usage);await runtime.soundVolume(2);
    assert.equal(saved.get(PREVIEW_SOUND_VOLUME_KEY),'2');assert.equal(JSON.stringify(runtime.state.usage),before);
    const reopened=await createRuntime();assert.equal(reopened.state.soundVolume,2);assert.equal(reopened.state.sound,true);
    await reopened.soundVolume(0);const muted=await createRuntime();assert.equal(muted.state.soundVolume,0);assert.equal(muted.state.sound,false);
  }finally{Object.assign(globalThis,previous);}
});
