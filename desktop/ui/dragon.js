(() => {
  'use strict';
  let loaded = false;
  async function start() {
    if (loaded || !document.querySelector('.dshwv-img')) return;
    loaded = true;
    observer.disconnect();
    for (const src of ['/render.js', '/shape.js', '/input.js']) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src; script.onload = resolve; script.onerror = reject;
        document.body.append(script);
      });
    }
  }
  const observer = new MutationObserver(() => start().catch(console.error));
  observer.observe(document.body, { childList: true, subtree: true });
  start().catch(console.error);
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const target = new URL(link.href, location.href);
    if (['https:', 'http:'].includes(target.protocol)) {
      event.preventDefault();
      window.whaleDesktop?.openExternal(target.href);
    }
  }, true);
})();
