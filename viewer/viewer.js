// Viewer - reads base64 HTML from URL hash and replaces entire document
(function() {
  try {
    const hash = window.location.hash.slice(1);

    if (!hash) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = 'No content provided';
      return;
    }

    // Decode: base64 -> UTF-8 string -> JSON
    const jsonStr = decodeURIComponent(escape(atob(hash)));
    const data = JSON.parse(jsonStr);

    if (!data.html) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = 'Invalid content';
      return;
    }

    // COMPLETELY replace the document with the HTML
    document.open();
    document.write(data.html);
    document.close();

    // Update title if provided
    if (data.title) {
      document.title = data.title;
    }

  } catch (e) {
    console.error('Viewer error:', e);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = 'Error: ' + e.message;
  }
})();
