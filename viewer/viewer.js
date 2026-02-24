// Viewer - reads HTML from storage using key in URL hash, then renders it
(function() {
  const key = window.location.hash.slice(1);

  if (!key) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = 'No content key provided';
    return;
  }

  browser.storage.local.get(key).then(result => {
    const html = result[key];
    browser.storage.local.remove(key);

    if (!html) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = 'Content not found (may have already been opened)';
      return;
    }

    document.open();
    document.write(html);
    document.close();

  }).catch(e => {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = 'Error: ' + e.message;
  });
})();
