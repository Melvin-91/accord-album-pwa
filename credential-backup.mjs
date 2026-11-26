// Versioned, offline-only credential backup. No network or telemetry.
const GROUPS = [
  ["accord-album-owner", "accord-album-token", "accord-album-autosync"],
  ["accord-spotify-client-id", "accord-spotify-redirect-uri", "accord-spotify-access-token", "accord-spotify-refresh-token", "accord-spotify-token-expires", "accord-spotify-token-client-id"],
  ["accord-tidal-client-id-v1", "accord-tidal-token-v1"],
  ["accord-qobuz-session-v1"],
  ["accord-lastfm-api-key"],
  ["accord-music-service-v1", "accord-music-link-target-v1"],
];
const KEYS = new Set(GROUPS.flat());
const FORMAT = "accord-album-credentials-v1", ITERATIONS = 600000, MAX = 262144;
const enc = new TextEncoder(), dec = new TextDecoder("utf-8", {fatal:true});
const b64 = (bytes) => {
  let str = "";
  for (let i=0;i<bytes.length;i+=8192) str += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(str);
};
const unb64 = (str) => {
  if (typeof str !== "string" || str.length > MAX*2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) throw Error("Backup non valido.");
  return Uint8Array.from(atob(str), ch=>ch.charCodeAt(0));
};
function validate(values) {
  if (!values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length) throw Error("Backup vuoto o non valido.");
  for (const [key,value] of Object.entries(values)) {
    if (!KEYS.has(key) || typeof value !== "string" || !value.length || value.length > 65536) throw Error("Backup non valido.");
  }
  if (enc.encode(JSON.stringify(values)).length > MAX) throw Error("Backup troppo grande.");
  return values;
}
async function keyFor(password,salt) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) throw Error("Usa una passphrase di almeno 12 caratteri.");
  const material = await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:ITERATIONS},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
export async function exportCredentials(storage,session,password) {
  const values = Object.create(null);
  for (const key of KEYS) {
    const value = storage.getItem(key) || session.getItem(key);
    if (value) values[key]=value;
  }
  validate(values);
  const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await keyFor(password,salt);
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:enc.encode(FORMAT),tagLength:128},key,enc.encode(JSON.stringify(values)));
  return JSON.stringify({format:FORMAT,kdf:"PBKDF2-SHA256",iterations:ITERATIONS,cipher:"AES-256-GCM",salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(ciphertext))});
}
export async function decryptCredentials(text,password) {
  try {
    if (typeof text!=="string" || text.length>MAX*2) throw Error();
    const record=JSON.parse(text);
    if (record.format!==FORMAT || record.kdf!=="PBKDF2-SHA256" || record.iterations!==ITERATIONS || record.cipher!=="AES-256-GCM") throw Error();
    const salt=unb64(record.salt),iv=unb64(record.iv),data=unb64(record.data);
    if(salt.length!==16 || iv.length!==12 || data.length<17 || data.length>MAX+16) throw Error();
    const key=await keyFor(password,salt);
    const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:enc.encode(FORMAT),tagLength:128},key,data);
    return validate(JSON.parse(dec.decode(clear)));
  } catch { throw Error("Impossibile aprire il backup: passphrase errata o file non valido."); }
}
export function restoreCredentials(storage,session,values) {
  validate(values);
  // Replace only groups present in the backup, avoiding mismatched client/token pairs.
  const affected=GROUPS.filter(group=>group.some(key=>Object.hasOwn(values,key))).flat();
  const revision="accord-music-auth-revision-v1";
  const pending=["accord-tidal-pkce-v1","accord-spotify-code-verifier","accord-spotify-oauth-state","accord-spotify-oauth-redirect","accord-spotify-oauth-client","accord-spotify-oauth-at"];
  const localKeys=[...affected,revision], sessionKeys=[...affected,...pending];
  const snapshots=[[storage,localKeys.map(key=>[key,storage.getItem(key)])],[session,sessionKeys.map(key=>[key,session.getItem(key)])]];
  try {
    storage.setItem(revision,b64(crypto.getRandomValues(new Uint8Array(16))));
    for(const key of affected) {
      if(Object.hasOwn(values,key)) storage.setItem(key,values[key]); else storage.removeItem(key);
      session.removeItem(key);
    }
    for(const key of pending) session.removeItem(key);
  } catch {
    let ok=true;
    for(const [target,items] of snapshots) for(const [key,value] of items) {
      try { if(value===null) target.removeItem(key); else target.setItem(key,value); } catch {ok=false;}
    }
    throw Error(ok?"Ripristino annullato: archivio locale non disponibile.":"Ripristino incompleto: mantieni il backup e non disinstallare l'app.");
  }
  return Object.keys(values).length;
}
