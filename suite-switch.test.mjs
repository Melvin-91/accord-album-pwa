import test from "node:test";
import assert from "node:assert/strict";
import {requiresManualSwitch,installSuiteSwitch} from "./suite-switch.mjs";
test("iOS standalone plain app switches stay in the installed session",()=>{
  const iphone={standalone:true,userAgent:"iPhone"};
  for(const base of ["https://music-wishlist-monitor.henryfelber.workers.dev/","https://melvin-91.github.io/accord-album-pwa/"]){
    assert.equal(requiresManualSwitch(base,base,iphone),true);
    assert.equal(requiresManualSwitch(base,base,{...iphone,standalone:false}),false);
    assert.equal(requiresManualSwitch(base,base,{standalone:true,userAgent:"Android"}),false);
    assert.equal(requiresManualSwitch(base,base,{standalone:true,platform:"MacIntel",maxTouchPoints:5}),true);
    assert.equal(requiresManualSwitch(base+"#add=1",base,iphone),false);
    assert.equal(requiresManualSwitch(base+"?test=1",base,iphone),false);
    assert.equal(requiresManualSwitch("https://example.org/",base,iphone),false);
  }
});

test("configured shortcut opens without a blocking notification",()=>{
 for(const [target,name] of [["https://melvin-91.github.io/accord-album-pwa/","Apri Accord Album"],["https://music-wishlist-monitor.henryfelber.workers.dev/","Apri Accord Scout"]]){
  let click,assigned=[],notices=[],prevented=0;
  const runtime={navigator:{standalone:true,userAgent:"iPhone"},matchMedia:()=>({matches:true}),document:{addEventListener:(type,fn)=>{assert.equal(type,"click");click=fn}},location:{assign:x=>assigned.push(x)}};
  installSuiteSwitch(target,x=>notices.push(x),runtime);
  const event=href=>({button:0,target:{closest:()=>({href})},preventDefault:()=>prevented++});
  click(event(target+"#add=1"));click(event(target));
  assert.deepEqual(assigned,["shortcuts://run-shortcut?name="+encodeURIComponent(name)]);assert.equal(prevented,1);assert.deepEqual(notices,[]);
 }
});
