export function sortRows(rows,mode="artist",reverse=false,durations={},positions={}){
 const text=(a,b)=>String(a||"").localeCompare(String(b||""),"it",{numeric:true,sensitivity:"base"});
 const value=r=>mode==="year"?Number(r.album?.year)||null:mode==="rating"?r.album?.rating??null:mode==="duration"?durations[r.id]??null:mode==="position"?positions[r.id]??null:null;
 return rows.slice().sort((a,b)=>{let n;if(["year","rating","duration","position"].includes(mode)){const x=value(a),y=value(b);if(x==null||y==null){if(x!=null)return -1;if(y!=null)return 1;n=0}else n=x-y}else n=mode==="title"?text(a.name,b.name):text(a.artist,b.artist);return (reverse?-1:1)*(n||text(a.artist,b.artist)||text(a.name,b.name))});
}
export function collectionStats(rows,durations={}){
 const genres={},artists={},decades={},ratings={};let cd=0,vinyl=0,queued=0,totalDuration=0,knownDuration=0;
 for(const r of rows){if(r.physical?.cd)cd++;if(r.physical?.vinyl)vinyl++;if(r.album?.status==="queued")queued++;if(Number.isFinite(durations[r.id])&&durations[r.id]>0){totalDuration+=durations[r.id];knownDuration++}const artist=r.artist||"Non indicato";artists[artist]=(artists[artist]||0)+1;for(const g of new Set(r.genres||[]))genres[g]=(genres[g]||0)+1;const year=Number(r.album?.year);if(year>0){const decade=Math.floor(year/10)*10;decades[decade]=(decades[decade]||0)+1}if(Number.isFinite(r.album?.rating)){const k=r.album.rating;ratings[k]=(ratings[k]||0)+1}}
 const ranked=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10);
 return {total:rows.length,cd,vinyl,queued,totalDuration,knownDuration,genres:ranked(genres),artists:ranked(artists),decades:ranked(decades),ratings:ranked(ratings)};
}
export function listeningCandidates(rows,durations,minutes){return rows.filter(r=>r.album&&(!minutes||Number.isFinite(durations[r.id])&&durations[r.id]>0&&durations[r.id]<=minutes*60000))}
export function scoutLink(artist,title,format){const url=new URL("https://music-wishlist-monitor.henryfelber.workers.dev/wishlist");url.hash=new URLSearchParams({add:"1",artist,album:title,format}).toString();return url.href}

export function importIntent(hash){const p=new URLSearchParams(String(hash||"").replace(/^#/,""));if(p.get("purchase")!=="1")return null;const artist=p.get("artist")?.trim(),title=p.get("album")?.trim(),format=p.get("format");return artist&&title&&artist.length<=200&&title.length<=200&&["CD","Vinyl"].includes(format)&&!/[\x00-\x1f]/.test(artist+title)?{artist,title,cd:format==="CD",vinyl:format==="Vinyl"}:null}
export function scoutIdentity(artist,title){return [artist,title].map(v=>String(v||"").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()).join("|")}
export function scoutSnapshot(data){
 if(data?.format!=="music-wishlist-personal-backup"||data.version!==1||!Array.isArray(data.wishlist)||!Array.isArray(data.purchases)||data.wishlist.length>1000||data.purchases.length>10000)throw Error("Backup Scout non valido.");
 const rows=data.wishlist.map(r=>{if(typeof r.artist!=="string"||typeof r.album!=="string"||!r.artist.trim()||!r.album.trim()||!["CD","Vinyl"].includes(r.format))throw Error("Supporto non valido");return {artist:r.artist.slice(0,200),album:r.album.slice(0,200),format:r.format,priority:r.priority==="paused"?"paused":"active"}});
 const purchases=data.purchases.filter(r=>Number.isFinite(r.purchase_total)&&r.purchase_total>0);
 return {rows,purchases:data.purchases.length,known:purchases.length,spend:purchases.reduce((sum,r)=>sum+Math.round(r.purchase_total*100),0)/100,imported_at:new Date().toISOString()};
}
