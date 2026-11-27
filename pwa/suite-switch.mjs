// Navigate to the existing installed PWA using its configured iOS shortcut.
export function requiresManualSwitch(href,target,platform) {
 if (!platform.standalone || !(/iPhone|iPad|iPod/i.test(platform.userAgent||"") || (/Mac/i.test(platform.platform||"") && platform.maxTouchPoints>1))) return false;
 try {const u=new URL(href),b=new URL(target);return u.protocol==="https:"&&u.origin===b.origin&&u.pathname===b.pathname&&!u.search&&!u.hash&&!u.username&&!u.password;}catch{return false}
}
export function companionShortcutURL(target) {
 return "shortcuts://run-shortcut?name="+encodeURIComponent(new URL(target).hostname==="melvin-91.github.io"?"Apri Accord Album":"Apri Accord Scout");
}
export function installSuiteSwitch(target,notify,runtime={navigator,matchMedia,document,location:window.location}) {
 const nav=runtime.navigator,platform={standalone:nav.standalone===true||runtime.matchMedia("(display-mode: standalone)").matches,userAgent:nav.userAgent,platform:nav.platform,maxTouchPoints:nav.maxTouchPoints};
 if(!requiresManualSwitch(target,target,platform))return;
 const shortcut=companionShortcutURL(target);
 runtime.document.addEventListener("click",event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const anchor=event.target?.closest?.("a[href]");
  if(!anchor||!requiresManualSwitch(anchor.href,target,platform))return;
  event.preventDefault();
  try{runtime.location.assign(shortcut)}catch{notify("Verifica il comando rapido configurato oppure apri l’app dalla Home.")}
 },true);
}
