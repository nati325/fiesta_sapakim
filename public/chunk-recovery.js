/* Reload once if Next.js fails to load a hashed chunk after a deploy.
   Installed PWAs often keep a stale HTML shell that points at deleted files. */
(function () {
  var FLAG = 'fiesta_chunk_reload';

  function isChunkError(value) {
    if (!value) return false;
    var text = typeof value === 'string' ? value : String(value.message || value.name || value);
    return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(text);
  }

  function reloadOnce() {
    try {
      if (sessionStorage.getItem(FLAG) === '1') return;
      sessionStorage.setItem(FLAG, '1');
    } catch (err) {
      if (/[?&]chunk_reload=1(?:&|$)/.test(location.search)) return;
      var join = location.search ? '&' : '?';
      location.replace(location.pathname + location.search + join + 'chunk_reload=1' + location.hash);
      return;
    }
    location.reload();
  }

  window.addEventListener(
    'error',
    function (event) {
      if (isChunkError(event.message) || isChunkError(event.error) || isChunkError(event.filename)) {
        reloadOnce();
      }
    },
    true
  );

  window.addEventListener('unhandledrejection', function (event) {
    if (isChunkError(event.reason)) reloadOnce();
  });
})();
