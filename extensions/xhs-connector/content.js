(function () {
  const PAGE_SOURCE = 'altselfs_xhs_page';
  const EXTENSION_SOURCE = 'altselfs_xhs_extension';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE || !data.type || !data.requestId) return;

    chrome.runtime.sendMessage(
      {
        source: PAGE_SOURCE,
        type: data.type,
      },
      (payload) => {
        window.postMessage(
          {
            source: EXTENSION_SOURCE,
            type: `${data.type}_RESULT`,
            requestId: data.requestId,
            payload: payload || {
              ok: false,
              error: chrome.runtime.lastError?.message || '浏览器扩展无响应',
            },
          },
          event.origin
        );
      }
    );
  });
})();
