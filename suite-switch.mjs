// iOS does not provide supported cross-PWA link capture. Preserve the installed sessions.
export function requiresManualSwitch(href, target, platform) {
  if (!platform.standalone || !(/iPhone|iPad|iPod/i.test(platform.userAgent || "") || (/Mac/i.test(platform.platform || "") && platform.maxTouchPoints > 1))) return false;
  const url = new URL(href), base = new URL(target);
  return url.protocol === "https:" && url.origin === base.origin && url.pathname === base.pathname && !url.search && !url.hash && !url.username && !url.password;
}
export function installSuiteSwitch(target, notify) {
  const platform = {
    standalone: navigator.standalone === true || matchMedia("(display-mode: standalone)").matches,
    userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints
  };
  if (!requiresManualSwitch(target,target,platform)) return;
  const name = new URL(target).hostname === "melvin-91.github.io" ? "Accord Album" : "Accord Scout";
  const message = "Per aprire " + name + " con gli accessi già configurati, usa il selettore app di iPhone oppure la sua icona sulla Home. iOS non permette il passaggio diretto tra queste app web.";
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor || !requiresManualSwitch(anchor.href,target,platform)) return;
    event.preventDefault();
    // No external navigation, no token transfer, and no unsupported URL scheme.
    notify(message);
    window.alert(message);
  });
}
