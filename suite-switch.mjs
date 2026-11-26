// Plain app switches only; action/deep links retain their explicit HTTPS payload.
export function installedAppURL(href, target, platform) {
  if (!platform.standalone || !( /iPhone|iPad|iPod/i.test(platform.userAgent || "") || (/Mac/i.test(platform.platform || "") && platform.maxTouchPoints > 1))) return null;
  const url = new URL(href), base = new URL(target);
  if (url.protocol !== "https:" || url.origin !== base.origin || url.pathname !== base.pathname || url.search || url.hash || url.username || url.password) return null;
  return "webapp://" + base.host + base.pathname;
}
export function installSuiteSwitch(target, notify) {
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor) return;
    const nativeURL = installedAppURL(anchor.href, target, {
      standalone: navigator.standalone === true || matchMedia("(display-mode: standalone)").matches,
      userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints
    });
    if (!nativeURL) return;
    event.preventDefault();
    const message = "Se iOS non apre l’altra app, passa alla sua icona sulla Home. Non serve effettuare un nuovo accesso.";
    // No automatic HTTPS fallback: that would open a separate storage context.
    try { location.assign(nativeURL); }
    catch { notify(message); return; }
    let left = false;
    const hide = () => { if (document.hidden) left = true; };
    document.addEventListener("visibilitychange", hide);
    setTimeout(() => {
      document.removeEventListener("visibilitychange", hide);
      if (!left && !document.hidden) notify(message);
    }, 1800);
  });
}
