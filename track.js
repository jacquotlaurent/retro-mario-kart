/* ═══════════════════════════════════════════════════════════════════════════
   Le circuit : tracé SVG, cases, et déplacement du kart.

   Le tracé est généré à partir d'une poignée de points (spline de
   Catmull-Rom fermée) : pour modifier la forme du circuit, il suffit de
   bouger les coordonnées de POINTS ci-dessous.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Coordonnées dans le viewBox 1000 × 640. Le premier point est la ligne
  // de départ / d'arrivée, et le kart tourne dans le sens des points.
  var POINTS = [
    [500, 500], [700, 545], [880, 460], [910, 280], [770, 150],
    [600, 205], [450, 135], [255, 150], [110, 265], [150, 435], [305, 545],
  ];

  function catmullRomPath(pts, tension) {
    var n = pts.length, d = 'M ' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      var c1 = [p1[0] + (p2[0] - p0[0]) / 6 * tension, p1[1] + (p2[1] - p0[1]) / 6 * tension];
      var c2 = [p2[0] - (p3[0] - p1[0]) / 6 * tension, p2[1] - (p3[1] - p1[1]) / 6 * tension];
      d += ' C ' + c1[0].toFixed(1) + ' ' + c1[1].toFixed(1) +
           ', ' + c2[0].toFixed(1) + ' ' + c2[1].toFixed(1) +
           ', ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d + ' Z';
  }

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) node.setAttribute(k, attrs[k]);
    return node;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Construit le circuit dans un <svg> et renvoie un contrôleur.
   * @param {SVGSVGElement} svg
   * @param {{cases:number}} opts
   */
  function buildTrack(svg, opts) {
    var cases = (opts && opts.cases) || 20;
    var d = catmullRomPath(POINTS, 1);

    var defs = el('defs');
    defs.innerHTML =
      '<pattern id="grass" width="64" height="64" patternUnits="userSpaceOnUse">' +
        '<rect width="64" height="64" fill="#2f7d32"/>' +
        '<rect width="32" height="32" fill="#37913b"/>' +
        '<rect x="32" y="32" width="32" height="32" fill="#37913b"/>' +
      '</pattern>' +
      '<pattern id="damier" width="24" height="24" patternUnits="userSpaceOnUse">' +
        '<rect width="24" height="24" fill="#fff"/>' +
        '<rect width="12" height="12" fill="#111"/>' +
        '<rect x="12" y="12" width="12" height="12" fill="#111"/>' +
      '</pattern>';
    svg.appendChild(defs);

    svg.appendChild(el('rect', { x: 0, y: 0, width: 1000, height: 640, fill: 'url(#grass)' }));

    // Vibure : bordure rouge et blanche, puis bitume, puis ligne médiane
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#e33b2e', 'stroke-width': 96, 'stroke-linejoin': 'round' }));
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#f6f2e8', 'stroke-width': 96, 'stroke-linejoin': 'round', 'stroke-dasharray': '26 26' }));
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#3b3b46', 'stroke-width': 82, 'stroke-linejoin': 'round' }));
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#4a4a57', 'stroke-width': 74, 'stroke-linejoin': 'round' }));

    var ref = el('path', { d: d, fill: 'none', stroke: 'none' });
    svg.appendChild(ref);
    var L = ref.getTotalLength ? ref.getTotalLength() : 2000;

    svg.appendChild(el('path', {
      d: d, fill: 'none', stroke: 'rgba(255,255,255,.45)', 'stroke-width': 3,
      'stroke-dasharray': (L / cases / 3).toFixed(1) + ' ' + (L / cases / 3).toFixed(1),
    }));

    // Une encoche par case, pour qu'on voie physiquement le kart progresser
    var ticks = el('g', { class: 'ticks' });
    for (var i = 0; i < cases; i++) {
      var len = (i / cases) * L;
      var p = ref.getPointAtLength(len);
      var q = ref.getPointAtLength((len + 1) % L);
      var a = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      ticks.appendChild(el('rect', {
        x: -1.5, y: -32, width: 3, height: 64, rx: 1.5,
        fill: i === 0 ? 'transparent' : 'rgba(255,255,255,.22)',
        transform: 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ') rotate(' + a.toFixed(1) + ')',
      }));
    }
    svg.appendChild(ticks);

    // Ligne d'arrivée
    var start = ref.getPointAtLength(0);
    var startNext = ref.getPointAtLength(6);
    var startAngle = Math.atan2(startNext.y - start.y, startNext.x - start.x) * 180 / Math.PI;
    var finish = el('g', {
      transform: 'translate(' + start.x.toFixed(1) + ',' + start.y.toFixed(1) + ') rotate(' + startAngle.toFixed(1) + ')',
    });
    finish.appendChild(el('rect', { x: -12, y: -37, width: 24, height: 74, fill: 'url(#damier)' }));
    svg.appendChild(finish);

    // Le kart. Dessin original (aucun visuel officiel n'est utilisé) : un
    // petit pilote à casquette rouge dans un kart rouge, vu de dessus.
    // Le kart est agrandi : il doit rester lisible depuis le fond de la salle.
    var kart = el('g', { class: 'kart' });
    kart.innerHTML =
      '<ellipse cx="0" cy="16" rx="26" ry="9" fill="rgba(0,0,0,.28)"/>' +
      '<rect x="-20" y="-19" width="15" height="10" rx="3" fill="#1b1b22"/>' +
      '<rect x="-20" y="9"  width="15" height="10" rx="3" fill="#1b1b22"/>' +
      '<rect x="8"   y="-20" width="16" height="11" rx="3" fill="#1b1b22"/>' +
      '<rect x="8"   y="9"  width="16" height="11" rx="3" fill="#1b1b22"/>' +
      '<rect x="-22" y="-13" width="46" height="26" rx="10" fill="#e5322a"/>' +
      '<rect x="-22" y="-13" width="46" height="8"  rx="4"  fill="#ff5a4d"/>' +
      '<rect x="16"  y="-9"  width="10" height="18" rx="4"  fill="#c22a22"/>' +
      '<circle cx="-2" cy="0" r="10" fill="#f6c9a0"/>' +
      '<path d="M -12 -1 a 10 10 0 0 1 20 0 z" fill="#e5322a"/>' +
      '<rect x="-13" y="-3" width="9" height="4" rx="2" fill="#c22a22"/>' +
      '<circle cx="1" cy="-4" r="1.6" fill="#3a2a1c"/>' +
      '<circle cx="1" cy="4"  r="1.6" fill="#3a2a1c"/>';
    svg.appendChild(kart);

    var api = {
      cases: cases,
      progress: 0,           // avancement absolu, en cases (peut dépasser un tour)
      _anim: null,
      _place: function (progress) {
        var len = ((progress / cases) * L) % L;
        if (len < 0) len += L;
        var p = ref.getPointAtLength(len);
        var q = ref.getPointAtLength((len + 4) % L);
        var a = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
        kart.setAttribute('transform',
          'translate(' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ') rotate(' + a.toFixed(2) + ') scale(1.45)');
      },
      /** Place le kart instantanément (au chargement d'un écran). */
      jumpTo: function (progress) {
        if (api._anim) cancelAnimationFrame(api._anim);
        api.progress = progress;
        api._place(progress);
      },
      /** Fait glisser le kart jusqu'à la case demandée. */
      moveTo: function (progress, done) {
        if (Math.abs(progress - api.progress) < 0.001) { if (done) done(); return; }
        if (api._anim) cancelAnimationFrame(api._anim);
        var from = api.progress, delta = progress - from;
        var duration = Math.min(1600, 380 + Math.abs(delta) * 260);
        var t0 = performance.now();
        function frame(now) {
          var t = Math.min(1, (now - t0) / duration);
          api.progress = from + delta * easeInOutCubic(t);
          api._place(api.progress);
          if (t < 1) api._anim = requestAnimationFrame(frame);
          else { api._anim = null; api.progress = progress; if (done) done(); }
        }
        api._anim = requestAnimationFrame(frame);
      },
      element: kart,
    };

    api._place(0);
    return api;
  }

  window.RetroTrack = { build: buildTrack, POINTS: POINTS };
})();
