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
  const shortcutName = "Apri " + name;
  const shortcutURL = "shortcuts://run-shortcut?name=" + encodeURIComponent(shortcutName);
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor || !requiresManualSwitch(anchor.href,target,platform)) return;
    event.preventDefault();
    notify("Se " + name + " non si apre, verifica il comando rapido «" + shortcutName + "» oppure usa l’icona sulla Home.");
    window.location.assign(shortcutURL);
  });
}
