// AdhanPush: adhan/iqama notices sent by the server (worker/ cron + Web Push), so they arrive with the app closed.
// The page keeps its own chime and full-screen countdown; only its system notification is replaced.
//
// How index.html uses it (load with <script src="push.js"></script> after adhan.min.js):
//   const pushSettings = () => { const p = place(); return { lat: p.lat, lng: p.lng, tz: zone(), method: S.method,
//     iqama: S.iqama, preAdhan: S.preAdhan || "on", muezzin: S.muezzin || "off", warn: S.warn }; };
//   - the "allow notifications" tap:  AdhanPush.enable(pushSettings()).then(notifyUI)   (call it in the tap itself)
//   - changed(), after save():         AdhanPush.sync(pushSettings())   (debounced; nothing happens if not subscribed)
//   - once at start:                   AdhanPush.ready.then(() => { AdhanPush.sync(pushSettings()); notifyUI(); })
//   - notify():                        if (AdhanPush.active) return;   (the server sends it instead)
//   - an "off" button:                 AdhanPush.disable().then(notifyUI)
//   - notifyUI():                      switch (AdhanPush.status()):
//       "unsupported"   no Web Push in this browser
//       "needs-install" iPhone/iPad Safari tab: add to the home screen first, then open from there
//       "default"       can be turned on (show the button)
//       "denied"        blocked in the phone's settings
//       "on"            subscribed; the server sends the notices
//   window fires "adhanpush" whenever `active` changes.
(function () {
  // VAPID public key; the matching private key is the Worker's VAPID_PRIVATE secret.
  const VAPID_PUBLIC = "BNME4gKOTucDrwSiRm4XipIx1g8NW1AtwgdizW6p2xk1TLgsN52CBReyGwpM5uAEt2Y-IT2ealFE2t7ulturtcA";
  const API = "api/subscribe";
  const FLAG = "adhan-push";   // localStorage "1" while this device is subscribed, so status() is right at first paint

  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  const supported = isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  let active = false;
  try { active = supported && localStorage.getItem(FLAG) === "1" && Notification.permission === "granted"; } catch (e) {}

  function setActive(on) {
    try { on ? localStorage.setItem(FLAG, "1") : localStorage.removeItem(FLAG); } catch (e) {}
    if (on === active) return;
    active = on;
    window.dispatchEvent(new Event("adhanpush"));
  }

  function status() {
    if (!supported) return iOS && !standalone ? "needs-install" : "unsupported";
    if (Notification.permission === "denied") return "denied";
    return active && Notification.permission === "granted" ? "on" : "default";
  }

  function keyBytes() {
    const s = atob(VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }

  function sameKey(sub) {
    const k = sub.options && sub.options.applicationServerKey;
    if (!k) return true;
    const a = new Uint8Array(k), b = keyBytes();
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }

  // The page registers sw.js too; subscribing needs it active, which `ready` waits for.
  async function registration() {
    if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
    return navigator.serviceWorker.ready;
  }

  async function current() {
    const reg = await registration();
    return reg.pushManager.getSubscription();
  }

  function payload(s) {
    return { lat: s.lat, lng: s.lng, tz: s.tz, method: s.method, iqama: s.iqama, preAdhan: s.preAdhan, muezzin: s.muezzin, warn: s.warn };
  }

  async function post(sub, settings) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), settings: payload(settings) }),
    });
    if (!r.ok) throw new Error(`subscribe: HTTP ${r.status}`);
  }

  // Call from a tap: the permission prompt only shows for a user gesture on iPhone.
  async function enable(settings) {
    if (!supported) return status();
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") { setActive(false); return status(); }
    try {
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes() });
      await post(sub, settings);
      AdhanPush.lastError = null;
      setActive(true);
    } catch (e) {
      AdhanPush.lastError = e;
      setActive(false);
    }
    return status();
  }

  // Settings changed: send them, at most once per 1.5 s of changes.
  let timer = 0, latest = null, waiting = [];
  function sync(settings) {
    latest = settings;
    clearTimeout(timer);
    return new Promise(resolve => {
      waiting.push(resolve);
      timer = setTimeout(async () => {
        const done = waiting;
        waiting = [];
        try {
          if (supported && Notification.permission === "granted") {
            const sub = await current();
            if (sub) { await post(sub, latest); setActive(true); } else setActive(false);
          } else if (supported) setActive(false);
        } catch (e) { AdhanPush.lastError = e; }
        done.forEach(r => r(status()));
      }, 1500);
    });
  }

  async function disable() {
    if (!supported) return status();
    try {
      const sub = await current();
      if (sub) {
        await fetch(API, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe();
      }
    } catch (e) { AdhanPush.lastError = e; }
    setActive(false);
    return status();
  }

  // Check the real subscription once; `ready` resolves with the status afterwards.
  const ready = !supported ? Promise.resolve(status()) : current()
    .then(sub => setActive(!!sub && Notification.permission === "granted"))
    .catch(() => {})
    .then(status);

  const AdhanPush = {
    status, enable, sync, disable, ready,
    get active() { return active; },
    lastError: null,
  };
  window.AdhanPush = AdhanPush;
})();
