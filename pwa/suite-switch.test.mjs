import test from "node:test";
import assert from "node:assert/strict";
import {requiresManualSwitch} from "./suite-switch.mjs";
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
