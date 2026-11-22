(function initialiseDoorAccessSetting() {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;
  if (location.hostname !== "boxoffice.etix.com" ||
      !/^\/ticket\/admin\/performanceAdmin\/[^/]+\/unassignedSeat\.spa$/.test(location.pathname)) return;

  let sequence = 0;
  let retry = null;
  document.addEventListener("etix-support:door-access-configured", (event) => {
    try { if (JSON.parse(event.detail)?.id === sequence) { clearInterval(retry); retry = null; } } catch (_error) {}
  });
  function configure(stored) {
    const enabled = EtixCore.mergeSettings(stored).enhancements.doorAccessColumn === true;
    const id = ++sequence;
    clearInterval(retry);
    const send = () => document.dispatchEvent(new CustomEvent("etix-support:door-access-configure", {detail: JSON.stringify({id, enabled})}));
    // The MAIN and isolated scripts can initialise in either order.
    retry = setInterval(send, 1000);
    send();
  }
  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["etix.settings"]) configure(changes["etix.settings"].newValue);
  });
  extensionApi.storage.local.get("etix.settings").then((stored) => configure(stored["etix.settings"])).catch(() => {});
})();
