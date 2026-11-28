import test from "node:test";
import assert from "node:assert/strict";
import {sendTransfer,pendingTransfers,acknowledgeTransfers} from "./transfer-queue.mjs";
test("reciprocal mailboxes preserve formats, receipts and concurrent sends",async t=>{
  const remote={version:1,sent:[],received:[]};
  let own,revision=0,conflict=true;
  t.mock.method(globalThis,"fetch",async (url,opts)=>{
    const peer=url.includes("/music-wishlist-monitor");
    if(!url.includes("/contents/")) return Response.json({private:true});
    if(opts.method==="PUT"){
      assert.equal(peer,false);
      if(conflict){conflict=false;return new Response(null,{status:409})}
      const data=JSON.parse(opts.body);
      if(own)assert.equal(data.sha,String(revision));
      own=JSON.parse(Buffer.from(data.content,"base64").toString());revision++;
      return Response.json({});
    }
    const box=peer?remote:own;
    return box?Response.json({sha:String(revision),content:Buffer.from(JSON.stringify(box)).toString("base64")}):new Response(null,{status:404});
  });
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:k=>k.endsWith("owner")?"Melvin-91":"test"}});
  t.after(()=>delete globalThis.localStorage);
  await sendTransfer("Artista","È", "CD");
  await sendTransfer("artista","È", "CD");
  await sendTransfer("Artista","È", "Vinyl");
  assert.equal(own.sent.length,2);
  remote.sent.push({...own.sent[0],id:crypto.randomUUID()});
  const rows=await pendingTransfers();
  assert.equal(rows.length,1);
  await acknowledgeTransfers(rows);await acknowledgeTransfers(rows);
  assert.deepEqual(await pendingTransfers(),[]);
  assert.equal(own.received.length,1);
});

test("offline wish intent is persistent and last explicit choice replaces previous choice",async t=>{
 const {queueWishIntent,localWishIntents}=await import("./transfer-queue.mjs");
 const storage=new Map();Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 t.after(()=>delete globalThis.localStorage);
 queueWishIntent("Artist","Album","CD",true);queueWishIntent("Artist","Album","Vinyl",true);queueWishIntent("Artist","Album","CD",false);
 assert.equal(localWishIntents().length,2);assert.equal(localWishIntents().find(x=>x.format==="CD").wanted,false);assert.equal(localWishIntents().find(x=>x.format==="Vinyl").wanted,true);
});

test("Scout purchase retries update one existing card and preserve the other format", async () => {
 const {importMatchedPurchases}=await import("./transfer-queue.mjs");
 const {createCollectionStore,COLLECTION_KEY}=await import("./collection-store.mjs");
 const {physicalKey}=await import("./physical-collection.mjs");
 const {scoutIdentity}=await import("./album-qol-v2.mjs");
 const album={id:"A".repeat(22),artist:"Artist",name:"Record",year:"2019",status:"queued",rating:null,genres:[],primary_genre:"",notes:"",cover_sha256:null,collections:[],tags:[],url:"https://open.spotify.com/album/"+"A".repeat(22)};
 const disk=new Map([[COLLECTION_KEY,JSON.stringify({albums:[album],physical:[{artist:"Artist",title:"Record",cd:true,vinyl:false}]})]]);
 const storage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)};
 const store=createCollectionStore(storage),receipts=[];
 const row={id:crypto.randomUUID(),artist:"Artist",album:"Record",automatic:true,format:"Vinyl"};
 let synced=false;
 const deps={store,albumKey:scoutIdentity,physicalKey,sync:async()=>synced,markPending(){},acknowledge:async rows=>receipts.push(...rows)};
 assert.deepEqual(await importMatchedPurchases([row],deps),[row]);
 assert.equal(receipts.length,0);
 synced=true;
 assert.deepEqual(await importMatchedPurchases([row],deps),[]);
 assert.deepEqual(receipts,[row]);
 const reopened=createCollectionStore(storage);
 assert.equal(reopened.state.albums.length,1);
 assert.deepEqual(reopened.state.physical,[{artist:"Artist",title:"Record",cd:true,vinyl:true}]);
});
