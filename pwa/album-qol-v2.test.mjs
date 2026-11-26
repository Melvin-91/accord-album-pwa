import test from "node:test";import assert from "node:assert/strict";import {sortRows,collectionStats,listeningCandidates,scoutLink} from "./album-qol-v2.mjs";
const rows=[{id:"1",name:"B",artist:"A",genres:["Metal"],album:{rating:4,year:2020,status:"queued"},physical:{cd:true}},{id:"2",name:"A",artist:"B",genres:[],album:{rating:2,year:2000},physical:{vinyl:true}}];
test("sort and collection stats",()=>{assert.equal(sortRows(rows,"rating",true)[0].id,"1");assert.equal(sortRows(rows,"title")[0].id,"2");assert.equal(collectionStats(rows).cd,1);assert.equal(collectionStats(rows).vinyl,1);assert.equal(listeningCandidates(rows,{"1":120000},3).length,1);assert(new URL(scoutLink("A","B","CD")).hash.includes("format=CD"))});

import {importIntent,scoutSnapshot} from "./album-qol-v2.mjs";
test("explicit Scout purchase and private snapshot",()=>{assert.deepEqual(importIntent("#purchase=1&artist=A&album=B&format=CD"),{artist:"A",title:"B",cd:true,vinyl:false});assert.equal(importIntent("#purchase=1&artist=A&album=B&format=X"),null);assert.equal(scoutSnapshot({format:"music-wishlist-personal-backup",version:1,wishlist:[{artist:"A",album:"B",format:"CD"}],purchases:[{purchase_total:12.30}]}).spend,12.30);assert.throws(()=>scoutSnapshot({wishlist:[]}))});

import {personalCards,readScoutPersonal,validPersonalCover} from "./album-qol-v2.mjs";
test("export personal artwork only and read Scout without writes",async()=>{const data=personalCards(rows,{});assert.equal(data.cards.length,2);assert(!("cover" in data.cards[0]));assert(!validPersonalCover("https://x"));let calls=0;const r=await readScoutPersonal("test",async(url,opts)=>{calls++;assert.equal(opts.headers.Authorization,"Bearer test");assert(url.includes("music-wishlist-monitor/contents/"));return Response.json(url.includes("wishlist.json")?[{artist:"A",album:"B",format:"CD"}]:[])});assert.equal(r.rows.length,1);assert.equal(calls,2)});

test("new local addition dates are sortable; old unknown dates stay unknown; listening can filter rating",()=>{assert.equal(sortRows(rows,"added",true,{}, {},{"2":100})[0].id,"2");assert.equal(listeningCandidates(rows,{},0,4).length,1)});
