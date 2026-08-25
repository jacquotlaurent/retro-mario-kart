/* Rendu du QR code (SVG) à partir de la librairie vendorisée dans vendor/. */
(function () {
  'use strict';
  function render(container, text, size) {
    if (typeof qrcode !== 'function') return;
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 2;
    var total = n + quiet * 2;
    var parts = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) parts.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }
    container.innerHTML =
      '<svg viewBox="0 0 ' + total + ' ' + total + '" width="' + size + '" height="' + size + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="QR code pour rejoindre la partie">' +
      '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
      '<path d="' + parts.join('') + '" fill="#111"/></svg>';
  }
  window.RetroQr = { render: render };
})();
