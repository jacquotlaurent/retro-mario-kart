/* ═══════════════════════════════════════════════════════════════════════════
   Le circuit : tracé SVG, décor, et déplacement du kart.

   Le tracé est généré à partir d'une poignée de points (spline de Catmull-Rom
   fermée) : pour modifier la forme du circuit, il suffit de bouger les
   coordonnées de POINTS ci-dessous. Le décor de bord de piste se place tout
   seul par rapport au tracé, il suit donc la forme sans réglage manuel.

   Tous les dessins sont originaux : aucun visuel officiel n'est utilisé.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Coordonnées dans le viewBox 1000 × 640. Le premier point est la ligne de
     départ, et le kart tourne dans le sens des points : la longue ligne droite
     du bas vers la droite, l'épingle, la remontée, la chicane du haut, puis la
     descente par la gauche. */
  var POINTS = [
    // longue ligne droite du bas, de gauche à droite
    [250, 552], [470, 562], [690, 552],
    // virage 1 : grand droite, appui long
    [822, 524], [892, 448],
    // courte ligne droite montante
    [884, 366],
    // virage 2 : gauche serré
    [802, 296],
    // chicane droite-gauche, étalée pour que le bord intérieur reste net
    [716, 330], [640, 306], [578, 240],
    // ligne droite du haut, de droite à gauche
    [468, 212], [330, 186],
    // virage 3 : épingle du haut-gauche
    [196, 146], [124, 222],
    // ligne droite de gauche, du haut vers le bas
    [118, 336],
    // virage 4 : grand gauche de retour
    [152, 444], [198, 514],
  ];

  // Une tension un peu inférieure à 1 resserre les virages : la spline colle
  // davantage aux points, au lieu de tout arrondir.
  var TENSION = 0.56;

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

  function el(name, attrs, contenu) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) node.setAttribute(k, attrs[k]);
    if (contenu) node.innerHTML = contenu;
    return node;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ─── Décor ───────────────────────────────────────────────────────────────

  function arbre(x, y, taille) {
    var k = taille || 1;
    return el('g', { transform: 'translate(' + x + ',' + y + ') scale(' + k + ')' },
      '<ellipse cx="0" cy="9" rx="14" ry="5" fill="rgba(0,0,0,.22)"/>' +
      '<rect x="-3.5" y="-3" width="7" height="13" rx="2.5" fill="#6d4a2b"/>' +
      '<circle cx="-7" cy="-7" r="9.5" fill="#276b30"/>' +
      '<circle cx="7"  cy="-6" r="8.5" fill="#276b30"/>' +
      '<circle cx="0"  cy="-13" r="11" fill="#2f8039"/>' +
      '<circle cx="-3" cy="-16" r="5" fill="#3d9447"/>');
  }

  function buisson(x, y) {
    return el('g', { transform: 'translate(' + x + ',' + y + ')' },
      '<ellipse cx="0" cy="5" rx="12" ry="4" fill="rgba(0,0,0,.18)"/>' +
      '<circle cx="-6" cy="0" r="7" fill="#2f8039"/>' +
      '<circle cx="5"  cy="1" r="6" fill="#276b30"/>' +
      '<circle cx="0"  cy="-4" r="7.5" fill="#3d9447"/>');
  }

  /* Pile de pneus vue de dessus : des anneaux concentriques, coiffés d'une
     touche de couleur comme les protections de bord de piste. */
  function pneus(x, y, couleur) {
    return el('g', { transform: 'translate(' + x + ',' + y + ')' },
      '<circle r="11.5" fill="rgba(0,0,0,.25)"/>' +
      '<circle r="10.5" fill="#1e2027"/>' +
      '<circle r="7.5"  fill="' + couleur + '"/>' +
      '<circle r="4.5"  fill="#2b2e38"/>' +
      '<circle r="1.8"  fill="#14161b"/>');
  }

  function chevron(x, y, angle) {
    return el('g', { transform: 'translate(' + x + ',' + y + ') rotate(' + angle + ')' },
      '<rect x="-15" y="-11" width="30" height="22" rx="4" fill="#ffd23f" stroke="#1b1b22" stroke-width="2.5"/>' +
      '<path d="M -8 -6 L 1 0 L -8 6 Z" fill="#1b1b22"/>' +
      '<path d="M 1 -6 L 10 0 L 1 6 Z" fill="#1b1b22"/>');
  }

  /* Tribune : le public de la rétro, au bord de la ligne droite. */
  function tribune(x, y, angle) {
    var gradins = '';
    var teintes = ['#ffd23f', '#39a0ed', '#3ec46d', '#ff8a3d', '#f2f4ff', '#e5322a'];
    for (var rang = 0; rang < 3; rang++) {
      for (var place = 0; place < 11; place++) {
        gradins += '<circle cx="' + (-40 + place * 8) + '" cy="' + (-6 + rang * 8) + '" r="2.6" fill="' +
                   teintes[(rang * 11 + place * 5) % teintes.length] + '"/>';
      }
    }
    return el('g', { transform: 'translate(' + x + ',' + y + ') rotate(' + angle + ')' },
      '<rect x="-48" y="-20" width="96" height="40" rx="6" fill="rgba(0,0,0,.22)"/>' +
      '<rect x="-48" y="-22" width="96" height="40" rx="6" fill="#39405c"/>' +
      '<rect x="-48" y="-22" width="96" height="9"  rx="4" fill="#e5322a"/>' +
      gradins);
  }

  function etang(x, y) {
    return el('g', { transform: 'translate(' + x + ',' + y + ')' },
      '<ellipse rx="62" ry="38" fill="#1f6f9c"/>' +
      '<ellipse rx="55" ry="32" fill="#2f92c7"/>' +
      '<ellipse cx="-14" cy="-9" rx="20" ry="8" fill="#49a9da" opacity=".7"/>' +
      '<ellipse cx="16" cy="8" rx="13" ry="5" fill="#49a9da" opacity=".55"/>');
  }

  function ballon(x, y, couleur) {
    return el('g', { transform: 'translate(' + x + ',' + y + ')' },
      '<circle r="14" fill="' + couleur + '"/>' +
      '<circle cx="-5" cy="-5" r="4.5" fill="#fff" opacity=".45"/>' +
      '<path d="M -4 12 L 4 12 L 0 18 Z" fill="' + couleur + '"/>' +
      '<path d="M 0 18 q 5 5 -1 9" stroke="#f2f4ff" stroke-width="1.4" fill="none" opacity=".6"/>');
  }

  /** Bande d'accélération peinte sur l'asphalte. */
  function turbo(x, y, angle) {
    return el('g', { transform: 'translate(' + x + ',' + y + ') rotate(' + angle + ')' },
      '<path d="M -14 -20 L -2 0 L -14 20 L -6 20 L 6 0 L -6 -20 Z" fill="#ff8a3d" opacity=".95"/>' +
      '<path d="M 0 -20 L 12 0 L 0 20 L 8 20 L 20 0 L 8 -20 Z" fill="#ffd23f" opacity=".95"/>');
  }

  // ─── Le kart de l'équipe ─────────────────────────────────────────────────

  /* Six personnes vues de dessus : le pilote devant, cinq équipiers derrière.
     Chacun a sa teinte de cheveux pour qu'on distingue l'équipe d'un coup
     d'œil depuis le fond de la salle. */
  var EQUIPIERS = [
    { x:  15, y:   0, peau: '#f6c9a0', cheveux: '#ffd23f', pilote: true },  // casquette claire : le rouge se noyait dans le châssis
    { x:   0, y: -11, peau: '#e8b489', cheveux: '#3f2a1b' },
    { x:   0, y:  11, peau: '#8d5a3b', cheveux: '#141110' },
    { x: -17, y: -12, peau: '#f6c9a0', cheveux: '#c98a2e' },
    { x: -17, y:   0, peau: '#c98a63', cheveux: '#7d47c9' },
    { x: -17, y:  12, peau: '#f2d2b6', cheveux: '#39a0ed' },
  ];

  function roue(x, y) {
    return '<rect x="' + x + '" y="' + y + '" width="17" height="12" rx="4" fill="#15161b"/>' +
           '<rect x="' + (x + 4) + '" y="' + (y + 3.5) + '" width="9" height="5" rx="2.5" fill="#4a4d59"/>';
  }

  function dessinerKart() {
    var svg = '' +
      '<ellipse cx="-2" cy="22" rx="36" ry="11" fill="rgba(0,0,0,.3)"/>' +
      roue(-28, -25) + roue(-28, 13) + roue(11, -26) + roue(11, 14) +
      // châssis, cerné de sombre pour se détacher de l'asphalte
      '<rect x="-31" y="-18" width="60" height="36" rx="12" fill="#8f1c16"/>' +
      '<rect x="-29" y="-16" width="56" height="32" rx="10" fill="#e5322a"/>' +
      '<rect x="-29" y="-16" width="56" height="9"  rx="5"  fill="#ff5a4d" opacity=".85"/>' +
      // museau et volant
      '<rect x="21" y="-9" width="8" height="18" rx="4" fill="#a8221b"/>' +
      '<circle cx="24" cy="0" r="3.6" fill="none" stroke="#2a1f16" stroke-width="1.8"/>';

    EQUIPIERS.forEach(function (p) {
      // La nuque (ou la casquette) couvre l'arrière du crâne : tout le monde
      // regarde vers l'avant du kart.
      svg +=
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="5.8" fill="' + p.peau + '"/>' +
        '<path d="M ' + p.x + ' ' + (p.y - 5.8) + ' A 5.8 5.8 0 0 0 ' + p.x + ' ' + (p.y + 5.8) + ' Z" fill="' + p.cheveux + '"/>';
      if (p.pilote) {
        svg += '<path d="M ' + p.x + ' ' + (p.y - 5.8) + ' A 5.8 5.8 0 0 1 ' + p.x + ' ' + (p.y + 5.8) +
               ' Z" fill="' + p.cheveux + '" opacity=".55"/>' +
               '<rect x="' + (p.x + 4.6) + '" y="' + (p.y - 2.6) + '" width="5" height="5.2" rx="2.4" fill="' + p.cheveux + '"/>';
      }
      svg +=
        '<circle cx="' + (p.x + 2.7) + '" cy="' + (p.y - 2.1) + '" r="1.15" fill="#2a1f16"/>' +
        '<circle cx="' + (p.x + 2.7) + '" cy="' + (p.y + 2.1) + '" r="1.15" fill="#2a1f16"/>';
    });

    return svg;
  }

  // ─── Construction ────────────────────────────────────────────────────────

  /**
   * Construit le circuit dans un <svg> et renvoie un contrôleur.
   * @param {SVGSVGElement} svg
   * @param {{cases:number}} opts
   */
  function buildTrack(svg, opts) {
    var cases = (opts && opts.cases) || 20;
    var d = catmullRomPath(POINTS, TENSION);

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

    // Chemin de référence, invisible : il sert à mesurer et à positionner.
    var ref = el('path', { d: d, fill: 'none', stroke: 'none' });
    svg.appendChild(ref);
    var L = ref.getTotalLength ? ref.getTotalLength() : 2400;

    // Centre du circuit : sert à savoir de quel côté est « dehors ».
    var centre = POINTS.reduce(function (acc, p) {
      return { x: acc.x + p[0] / POINTS.length, y: acc.y + p[1] / POINTS.length };
    }, { x: 0, y: 0 });

    /** Point situé à `ecart` unités perpendiculairement à la piste. */
    function aCote(fraction, ecart) {
      var len = ((fraction % 1) + 1) % 1 * L;
      var p = ref.getPointAtLength(len);
      var q = ref.getPointAtLength((len + 6) % L);
      var tx = q.x - p.x, ty = q.y - p.y;
      var norme = Math.hypot(tx, ty) || 1;
      var nx = -ty / norme, ny = tx / norme;
      var dehors = ((p.x - centre.x) * nx + (p.y - centre.y) * ny) >= 0 ? 1 : -1;
      return {
        x: p.x + nx * ecart * dehors,
        y: p.y + ny * ecart * dehors,
        angle: Math.atan2(ty, tx) * 180 / Math.PI,
      };
    }

    // ─ décor intérieur, posé avant la piste
    var fond = el('g', { class: 'decor-fond' });
    fond.appendChild(etang(628, 396));
    [[430, 300], [520, 288], [742, 350], [470, 452], [690, 462]].forEach(function (c) {
      fond.appendChild(buisson(c[0], c[1]));
    });
    [[330, 320, 1.45], [764, 430, 1.3], [388, 428, 1.25], [548, 284, 1.15]].forEach(function (c) {
      fond.appendChild(arbre(c[0], c[1], c[2]));
    });
    svg.appendChild(fond);

    // ─ la piste : vibure rouge et blanche, bitume, ligne médiane
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#e33b2e', 'stroke-width': 96, 'stroke-linejoin': 'round' }));
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#f6f2e8', 'stroke-width': 96, 'stroke-linejoin': 'round', 'stroke-dasharray': '26 26' }));
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#3b3b46', 'stroke-width': 82, 'stroke-linejoin': 'round' }));
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: '#4a4a57', 'stroke-width': 74, 'stroke-linejoin': 'round' }));
    svg.appendChild(el('path', {
      d: d, fill: 'none', stroke: 'rgba(255,255,255,.45)', 'stroke-width': 3,
      'stroke-dasharray': (L / cases / 3).toFixed(1) + ' ' + (L / cases / 3).toFixed(1),
    }));

    // ─ bandes d'accélération, peintes sur l'asphalte
    [0.09, 0.44, 0.72].forEach(function (f) {
      var p = aCote(f, 0);
      svg.appendChild(turbo(p.x, p.y, p.angle));
    });

    // ─ décor de bord de piste, calé sur le tracé
    var bord = el('g', { class: 'decor-bord' });
    [[0.235, '#e5322a'], [0.252, '#f2f4ff'], [0.269, '#e5322a'],   // extérieur du virage de droite
     [0.435, '#f2f4ff'], [0.452, '#e5322a'],                        // sortie de la chicane
     [0.665, '#e5322a'], [0.682, '#f2f4ff'], [0.699, '#e5322a']     // enchaînement du haut-gauche
    ].forEach(function (c) {
      var p = aCote(c[0], 72);
      bord.appendChild(pneus(p.x, p.y, c[1]));
    });
    [0.20, 0.33, 0.60, 0.79].forEach(function (f) {
      var p = aCote(f, 78);
      bord.appendChild(chevron(p.x, p.y, p.angle));
    });
    var t = aCote(0.045, -88);
    bord.appendChild(tribune(t.x, t.y, t.angle));
    [[0.30, 88], [0.52, 86], [0.88, 90], [0.96, 94]].forEach(function (c) {
      var p = aCote(c[0], c[1]);
      bord.appendChild(arbre(p.x, p.y, 1.25));
    });
    svg.appendChild(bord);

    // ─ ballons, au-dessus du reste
    [[262, 262, '#ffd23f'], [806, 486, '#39a0ed'], [546, 470, '#3ec46d']].forEach(function (b) {
      svg.appendChild(ballon(b[0], b[1], b[2]));
    });

    // ─ une encoche par case, pour voir physiquement le kart progresser
    var ticks = el('g', { class: 'ticks' });
    for (var i = 1; i < cases; i++) {
      var p = aCote(i / cases, 0);
      ticks.appendChild(el('rect', {
        x: -1.5, y: -32, width: 3, height: 64, rx: 1.5, fill: 'rgba(255,255,255,.22)',
        transform: 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ') rotate(' + p.angle.toFixed(1) + ')',
      }));
    }
    svg.appendChild(ticks);

    // ─ ligne d'arrivée
    var depart = aCote(0, 0);
    var finish = el('g', {
      transform: 'translate(' + depart.x.toFixed(1) + ',' + depart.y.toFixed(1) + ') rotate(' + depart.angle.toFixed(1) + ')',
    });
    finish.appendChild(el('rect', { x: -13, y: -37, width: 26, height: 74, fill: 'url(#damier)' }));
    svg.appendChild(finish);

    // ─ le kart
    var kart = el('g', { class: 'kart' });
    kart.innerHTML = dessinerKart();
    svg.appendChild(kart);

    var api = {
      cases: cases,
      progress: 0,           // avancement absolu, en cases (peut dépasser un tour)
      _anim: null,
      _place: function (progress) {
        var p = aCote(progress / cases, 0);
        kart.setAttribute('transform',
          'translate(' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ') rotate(' + p.angle.toFixed(2) + ') scale(1.1)');
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
