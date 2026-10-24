import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCatalog,createRuntime} from './runtime.js';
import {enrichCatalog,matchingSkills} from './catalog-model.js';
import {usageIdentity} from './usage-model.js';

const skill={id:'/tmp/my-skill/SKILL.md',name:'cross-media',invocation:'tools:cross-media',source:'Tools',summary:'画像と映像を整える。',description:'Media tools.',genres:['image','video'],tags:['絵作り','movie']};

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
