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
