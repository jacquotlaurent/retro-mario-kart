/* ═══════════════════════════════════════════════════════════════════════════
   Effets de l'écran animateur : confettis, bruitages, secousse.
   Tout est synthétisé (Web Audio + canvas) : aucun fichier son ni image à
   télécharger, et donc rien qui puisse manquer à l'appel le jour J.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = window.RETRO_CONFIG || {};
  var ctx = null;

  function audio() {
    if (!CFG.SOUND) return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Une note carrée façon console 8 bits. */
  function blip(freq, start, duration, gain, type) {
    var ac = audio();
    if (!ac) return;
    var osc = ac.createOscillator();
    var vol = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, ac.currentTime + start);
    vol.gain.setValueAtTime(0.0001, ac.currentTime + start);
    vol.gain.exponentialRampToValueAtTime(gain || 0.13, ac.currentTime + start + 0.012);
    vol.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration);
    osc.connect(vol).connect(ac.destination);
    osc.start(ac.currentTime + start);
    osc.stop(ac.currentTime + start + duration + 0.02);
  }

  var SOUNDS = {
    boost: function (strength) {
      var base = 523.25, steps = Math.min(4, Math.max(1, strength));
      for (var i = 0; i < steps + 1; i++) blip(base * Math.pow(1.26, i), i * 0.07, 0.16);
    },
    hit: function (strength) {
      var base = 330;
      for (var i = 0; i < Math.min(3, strength); i++) blip(base / Math.pow(1.3, i), i * 0.09, 0.22, 0.14, 'sawtooth');
    },
    lap: function () {
      [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach(function (f, i) {
        blip(f, i * 0.11, 0.2, 0.15);
      });
    },
    join: function () { blip(880, 0, 0.08); blip(1174.7, 0.08, 0.12); },
  };

  function play(name, strength) {
    var fn = SOUNDS[name];
    if (fn) { try { fn(strength || 1); } catch (_) {} }
  }

  // ─── Confettis ───────────────────────────────────────────────────────────

  var COLORS = ['#e5322a', '#ffd23f', '#39a0ed', '#3ec46d', '#ffffff', '#ff8a3d'];

  function confetti(canvas, count) {
    if (!CFG.CONFETTI || !canvas) return;
    var ctx2d = canvas.getContext('2d');
    var w = canvas.width = canvas.offsetWidth;
    var h = canvas.height = canvas.offsetHeight;
    var pieces = [];
    for (var i = 0; i < (count || 160); i++) {
      pieces.push({
        x: Math.random() * w, y: -20 - Math.random() * h * 0.6,
        vx: (Math.random() - 0.5) * 2.4, vy: 2.5 + Math.random() * 4.5,
        size: 6 + Math.random() * 8, rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.28,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
    var start = performance.now();
    function frame(now) {
      var elapsed = now - start;
      ctx2d.clearRect(0, 0, w, h);
      for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.045;
        ctx2d.save();
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rot);
        ctx2d.globalAlpha = Math.max(0, 1 - elapsed / 4200);
        ctx2d.fillStyle = p.color;
        ctx2d.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx2d.restore();
      }
      if (elapsed < 4200) requestAnimationFrame(frame);
      else ctx2d.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(frame);
  }

  // ─── Secousse ────────────────────────────────────────────────────────────

  function shake(element, intensity) {
    if (!element) return;
    element.classList.remove('secousse-forte', 'secousse-legere');
    void element.offsetWidth; // force le redémarrage de l'animation CSS
    element.classList.add(intensity >= 3 ? 'secousse-forte' : 'secousse-legere');
    setTimeout(function () {
      element.classList.remove('secousse-forte', 'secousse-legere');
    }, 700);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  }

  window.RetroFx = { play: play, confetti: confetti, shake: shake, vibrate: vibrate, unlockAudio: audio };
})();
