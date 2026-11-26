import test from "node:test";
import assert from "node:assert/strict";
import {installedAppURL} from "./suite-switch.mjs";
test("iOS standalone app switch uses installed PWA URL without browser fallback",()=>{
  const scout="https://music-wishlist-monitor.henryfelber.workers.dev/";
  const album="https://melvin-91.github.io/accord-album-pwa/";
  const iphone={standalone:true,userAgent:"iPhone"};
  for(const base of [scout,album]){
    assert.equal(installedAppURL(base,base,iphone),base.replace("https:","webapp:"));
    assert.equal(installedAppURL(base,base,{...iphone,standalone:false}),null);
    assert.equal(installedAppURL(base,base,{standalone:true,userAgent:"Android"}),null);
    assert.equal(installedAppURL(base,base,{standalone:true,platform:"MacIntel",maxTouchPoints:5}),base.replace("https:","webapp:"));
    assert.equal(installedAppURL(base+"#add=1",base,iphone),null);
    assert.equal(installedAppURL(base+"?token=not-real",base,iphone),null);
    assert.equal(installedAppURL("https://example.org/",base,iphone),null);
  }
});
