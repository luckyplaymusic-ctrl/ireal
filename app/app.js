/* Estudio trombón — app web local. Los archivos del usuario se guardan en IndexedDB de este aparato. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600); }
  function fmt(s) { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function norm(s) { return String(s).normalize('NFC').toLowerCase(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- Almacén local de archivos (IndexedDB) ---------- */
  var dbP = new Promise(function (res, rej) {
    var r = indexedDB.open('estudio-trombon', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('files', { keyPath: 'name' }); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
  function tx(mode, fn) { return dbP.then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('files', mode); var out = fn(t.objectStore('files')); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { rej(t.error); }; }); }); }
  var lib = []; // metadatos {name,type,size}
  function refreshLib() {
    return dbP.then(function (db) { return new Promise(function (res) {
      var out = []; var c = db.transaction('files').objectStore('files').openCursor();
      c.onsuccess = function () { var cur = c.result; if (cur) { out.push({ name: cur.value.name, type: cur.value.type, size: cur.value.size }); cur.continue(); } else { res(out); } };
    }); }).then(function (l) { lib = l.sort(function (a, b) { return a.name.localeCompare(b.name, 'es', { numeric: true }); }); renderLib(); renderBlocks(); });
  }
  function getBlob(name) { return dbP.then(function (db) { return new Promise(function (res) { var r = db.transaction('files').objectStore('files').get(name); r.onsuccess = function () { res(r.result ? r.result.blob : null); }; }); }); }
  function kind(type, name) { if (/pdf/.test(type) || /\.pdf$/i.test(name)) return 'pdf'; if (/^audio\//.test(type) || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return 'audio'; return 'otro'; }

  $('fileIn').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []); if (!files.length) return;
    toast('Guardando ' + files.length + ' archivo(s)…');
    var chain = Promise.resolve();
    files.forEach(function (f) { chain = chain.then(function () { return tx('readwrite', function (s) { return s.put({ name: f.name, type: f.type || '', size: f.size, blob: f, added: Date.now() }); }); }); });
    chain.then(function () { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); toast('Guardado: ' + files.length + ' archivo(s)'); e.target.value = ''; return refreshLib(); })
      .catch(function () { toast('No se ha podido guardar. ¿Queda espacio en el aparato?'); });
  });
  function renderLib() {
    var ul = $('libList'); ul.innerHTML = '';
    if (!lib.length) { ul.innerHTML = '<li><span>Aún no hay archivos. Añade el libro de McChesney, el de Concone, la transcripción de Chet y los audios.</span></li>'; }
    lib.forEach(function (f) {
      var li = document.createElement('li'); var k = kind(f.type, f.name);
      li.innerHTML = '<span>' + (k === 'pdf' ? '📄 ' : k === 'audio' ? '🎵 ' : '') + esc(f.name) + ' · ' + (f.size / 1048576).toFixed(1) + ' MB</span>';
      var open = document.createElement('button'); open.type = 'button'; open.textContent = 'Abrir';
      open.onclick = function () { if (k === 'pdf') openPdf(f.name, 1, null); else if (k === 'audio') { loadAudio(f.name); showTab('audio'); } };
      var del = document.createElement('button'); del.type = 'button'; del.textContent = 'Borrar';
      del.onclick = function () { if (del.dataset.sure) { tx('readwrite', function (s) { return s.delete(f.name); }).then(refreshLib); } else { del.dataset.sure = '1'; del.textContent = '¿Seguro?'; setTimeout(function () { delete del.dataset.sure; del.textContent = 'Borrar'; }, 3000); } };
      li.appendChild(open); li.appendChild(del); ul.appendChild(li);
    });
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) { $('storeInfo').textContent = lib.length + ' archivo(s) · ' + (e.usage / 1048576).toFixed(0) + ' MB usados de ' + (e.quota / 1073741824).toFixed(1) + ' GB disponibles'; });
  }

  /* ---------- Asociación ejercicio → archivo/página ---------- */
  var maps = LS.get('maps', {});
  function saveMaps() { LS.set('maps', maps); }
  function resolveFile(res) {
    var m = maps[res.clave]; var want = res.tipo === 'pdf' ? 'pdf' : 'audio';
    if (m && m.archivo && lib.some(function (f) { return f.name === m.archivo; })) return m.archivo;
    if (res.archivo) {
      var a = norm(res.archivo);
      var exact = lib.filter(function (f) { return norm(f.name) === a; })[0]; if (exact) return exact.name;
      var part = lib.filter(function (f) { return kind(f.type, f.name) === want && norm(f.name).indexOf(a.replace(/\.(pdf|mp3|wav)$/i, '')) >= 0; })[0]; if (part) return part.name;
    }
    return null;
  }
  function pick(res, cb) {
    var want = res.tipo === 'pdf' ? 'pdf' : 'audio';
    var list = lib.filter(function (f) { return kind(f.type, f.name) === want; });
    $('pickerTitle').textContent = 'Elige el archivo para «' + res.texto + '»';
    var ul = $('pickerList'); ul.innerHTML = '';
    if (!list.length) ul.innerHTML = '<li><span>No hay ' + (want === 'pdf' ? 'PDF' : 'audios') + ' en la biblioteca. Añádelos en la pestaña Biblioteca.</span></li>';
    list.forEach(function (f) {
      var li = document.createElement('li'); li.innerHTML = '<span>' + esc(f.name) + '</span>';
      var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Elegir';
      b.onclick = function () { maps[res.clave] = Object.assign({}, maps[res.clave], { archivo: f.name }); saveMaps(); $('picker').hidden = true; renderBlocks(); cb(f.name); };
      li.appendChild(b); ul.appendChild(li);
    });
    $('picker').hidden = false;
  }
  $('pickerCancel').onclick = function () { $('picker').hidden = true; };

  /* ---------- Visor de PDF ---------- */
  var pdf = { doc: null, name: null, page: 1, clave: null, rendering: false };
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  function openPdf(name, page, clave) {
    if (!window.pdfjsLib) { toast('El visor de PDF necesita conexión la primera vez.'); return; }
    $('viewer').classList.remove('closed');
    var go = function () { pdf.page = Math.min(Math.max(1, page || 1), pdf.doc.numPages); pdf.clave = clave; renderPage(); if (window.innerWidth < 900) $('viewer').scrollIntoView({ behavior: 'smooth' }); };
    if (pdf.name === name && pdf.doc) { go(); return; }
    getBlob(name).then(function (b) { if (!b) throw new Error('no'); return b.arrayBuffer(); })
      .then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; })
      .then(function (doc) { pdf.doc = doc; pdf.name = name; $('pdfName').textContent = name; go(); })
      .catch(function () { toast('No se ha podido abrir el PDF.'); });
  }
  function renderPage() {
    if (!pdf.doc || pdf.rendering) return; pdf.rendering = true;
    pdf.doc.getPage(pdf.page).then(function (p) {
      var wrap = $('pdfWrap'); var w = wrap.clientWidth || 600; var v1 = p.getViewport({ scale: 1 });
      var scale = w / v1.width; var dpr = window.devicePixelRatio || 1; var vp = p.getViewport({ scale: scale * dpr });
      var c = $('pdfCanvas'); c.width = vp.width; c.height = vp.height; c.style.width = (vp.width / dpr) + 'px';
      $('pdfEmpty').hidden = true;
      return p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }).then(function () { pdf.rendering = false; $('pdfPage').textContent = pdf.page + ' / ' + pdf.doc.numPages; $('pdfWrap').scrollTop = 0; $('pdfMark').hidden = !pdf.clave; })
      .catch(function () { pdf.rendering = false; });
  }
  $('pdfPrev').onclick = function () { if (pdf.doc && pdf.page > 1) { pdf.page--; renderPage(); } };
  $('pdfNext').onclick = function () { if (pdf.doc && pdf.page < pdf.doc.numPages) { pdf.page++; renderPage(); } };
  $('pdfMark').onclick = function () { if (!pdf.clave) return; maps[pdf.clave] = Object.assign({}, maps[pdf.clave], { archivo: pdf.name, pagina: pdf.page }); saveMaps(); renderBlocks(); toast('Guardada la página ' + pdf.page + ' para este ejercicio'); };
  $('pdfClose').onclick = function () { $('viewer').classList.add('closed'); };
  var swipeX = null;
  $('pdfWrap').addEventListener('touchstart', function (e) { swipeX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  $('pdfWrap').addEventListener('touchend', function (e) { if (swipeX === null) return; var dx = e.changedTouches[0].clientX - swipeX; if (Math.abs(dx) > 70) (dx < 0 ? $('pdfNext') : $('pdfPrev')).click(); swipeX = null; });
  window.addEventListener('resize', function () { clearTimeout(renderPage._t); renderPage._t = setTimeout(renderPage, 200); });
  if (window.innerWidth < 900) $('viewer').classList.add('closed');

  /* ---------- Audio con velocidad y bucle ---------- */
  var audio = $('audio'); var loopAB = { a: null, b: null }; var audioURL = null;
  function setRate(v) { $('rate').value = v; $('rateVal').textContent = v + ' %'; var r = v / 100; audio.defaultPlaybackRate = r; audio.playbackRate = r; audio.preservesPitch = true; audio.mozPreservesPitch = true; audio.webkitPreservesPitch = true; }
  function loadAudio(name) {
    getBlob(name).then(function (b) { if (!b) { toast('No encuentro ese audio en la biblioteca.'); return; }
      if (audioURL) URL.revokeObjectURL(audioURL); audioURL = URL.createObjectURL(b); audio.src = audioURL; $('audioName').textContent = '🎵 ' + name; loopAB = { a: null, b: null }; showLoop();
      audio.addEventListener('loadedmetadata', function once() { audio.removeEventListener('loadedmetadata', once); setRate(+$('rate').value); }); });
  }
  $('rate').addEventListener('input', function () { setRate(+this.value); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-rate]'), function (b) { b.onclick = function () { setRate(+b.dataset.rate); }; });
  function showLoop() { $('loopInfo').textContent = loopAB.a === null ? 'Sin bucle' : ('Bucle ' + fmt(loopAB.a) + (loopAB.b !== null ? ' → ' + fmt(loopAB.b) : ' → (marca B)')); }
  $('loopA').onclick = function () { loopAB.a = audio.currentTime; if (loopAB.b !== null && loopAB.b <= loopAB.a) loopAB.b = null; showLoop(); };
  $('loopB').onclick = function () { if (loopAB.a === null) { toast('Marca primero el punto A'); return; } if (audio.currentTime > loopAB.a) { loopAB.b = audio.currentTime; audio.currentTime = loopAB.a; } showLoop(); };
  $('loopOff').onclick = function () { loopAB = { a: null, b: null }; showLoop(); };
  audio.addEventListener('timeupdate', function () { if (loopAB.a !== null && loopAB.b !== null && audio.currentTime >= loopAB.b) audio.currentTime = loopAB.a; });
  setRate(100);

  /* ---------- Sonido compartido ---------- */
  var actx = null;
  function ctx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; }
  function blip(t, freq, dur, vol) { var c = ctx(); var o = c.createOscillator(); var g = c.createGain(); o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02); }
  function bell(n) { var c = ctx(); for (var i = 0; i < (n || 1); i++) blip(c.currentTime + i * 0.22, 1320, 0.18, 0.5); if (navigator.vibrate) navigator.vibrate(200); }

  /* ---------- Metrónomo ---------- */
  var metro = { on: false, bpm: LS.get('bpm', 80), next: 0, beat: 0, timer: null };
  function setBpm(v) { metro.bpm = Math.min(240, Math.max(30, Math.round(v))); $('bpm').value = metro.bpm; $('bpmOut').textContent = metro.bpm; LS.set('bpm', metro.bpm); }
  function dots() { var n = +$('beats').value; var d = $('beatDots'); d.innerHTML = ''; for (var i = 0; i < Math.max(n, 1); i++) { var s = document.createElement('span'); if (i === 0 && n > 1) s.className = 'accent'; d.appendChild(s); } }
  function schedule() {
    var c = ctx(); var n = +$('beats').value; var spb = 60 / metro.bpm;
    while (metro.next < c.currentTime + 0.12) {
      var acc = n > 1 && metro.beat % n === 0;
      blip(metro.next, acc ? 1760 : 1100, 0.05, acc ? 0.9 : 0.6);
      if ($('swing').checked) blip(metro.next + spb * 2 / 3, 900, 0.03, 0.25);
      (function (b, at) { setTimeout(function () { var sp = $('beatDots').children; for (var i = 0; i < sp.length; i++) sp[i].classList.toggle('on', i === b % Math.max(n, 1)); }, Math.max(0, (at - c.currentTime) * 1000)); })(metro.beat, metro.next);
      metro.next += spb; metro.beat++;
    }
  }
  function metroStart() { var c = ctx(); metro.on = true; metro.beat = 0; metro.next = c.currentTime + 0.08; schedule(); metro.timer = setInterval(schedule, 25); $('metroToggle').textContent = '■ Parar metrónomo'; wake(true); }
  function metroStop() { metro.on = false; clearInterval(metro.timer); $('metroToggle').textContent = '▶ Metrónomo'; }
  $('metroToggle').onclick = function () { metro.on ? metroStop() : metroStart(); };
  $('bpm').addEventListener('input', function () { setBpm(+this.value); });
  $('bpmDown').onclick = function () { setBpm(metro.bpm - 2); };
  $('bpmUp').onclick = function () { setBpm(metro.bpm + 2); };
  $('beats').onchange = dots;
  var taps = [];
  $('tap').onclick = function () { var t = performance.now(); taps = taps.filter(function (x) { return t - x < 3000; }); taps.push(t); if (taps.length > 1) { var d = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); setBpm(60000 / d); } };
  setBpm(metro.bpm); dots();

  /* ---------- Bloqueo de pantalla ---------- */
  var lock = null;
  function wake(on) { try { if (on && 'wakeLock' in navigator && !lock) navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {}); } catch (e) {} }

  /* ---------- EMOM ---------- */
  var emom = { on: false, t0: 0, iv: 0 };
  $('emomToggle').onclick = function () {
    if (emom.on) { emom.on = false; clearInterval(emom.iv); $('emomToggle').textContent = '▶ Empezar EMOM'; $('clockInfo').textContent = 'Parado'; return; }
    var mins = Math.max(1, +$('emomMin').value || 3), rounds = Math.max(1, +$('emomRounds').value || 5);
    ctx(); emom.on = true; emom.t0 = Date.now(); var last = -1; bell(1); wake(true);
    $('emomToggle').textContent = '■ Parar EMOM';
    emom.iv = setInterval(function () {
      var el = (Date.now() - emom.t0) / 1000; var r = Math.floor(el / (mins * 60));
      if (r >= rounds) { clearInterval(emom.iv); emom.on = false; bell(3); $('clock').textContent = '00:00'; $('clockInfo').textContent = '¡Terminado!'; $('emomToggle').textContent = '▶ Empezar EMOM'; return; }
      if (r !== last) { if (last >= 0) bell(2); last = r; }
      $('clock').textContent = fmt(mins * 60 - (el - r * mins * 60)); $('clockInfo').textContent = 'Ronda ' + (r + 1) + ' de ' + rounds;
    }, 250);
  };

  /* ---------- Plan y sesión ---------- */
  var plan = null, session = null, run = { on: false, idx: 0, t0: 0, iv: 0 };
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function loadPlan() {
    return fetch('plan.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (p) { LS.set('plan-cache', p); return p; })
      .catch(function () { return LS.get('plan-cache', null); })
      .then(function (p) {
        if (!p) { $('blocks').innerHTML = '<p class="muted">No se ha podido cargar el plan. Conéctate a internet y vuelve a abrir la app.</p>'; return; }
        plan = p; $('weekLabel').textContent = p.semana || ''; $('aviso').textContent = p.aviso || '';
        var sel = $('sessionSel'); sel.innerHTML = '';
        var t = todayISO(); var pickId = null;
        p.sesiones.forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.titulo + ' · ' + total(s) + ' min'; sel.appendChild(o); if (!pickId && s.fecha >= t) pickId = s.id; });
        sel.value = LS.get('session', null) && p.sesiones.some(function (s) { return s.id === LS.get('session'); }) && LS.get('session-day') === t ? LS.get('session') : (pickId || p.sesiones[p.sesiones.length - 1].id);
        selectSession(sel.value);
      });
  }
  function total(s) { return s.bloques.reduce(function (a, b) { return a + (b.min || 0); }, 0); }
  $('sessionSel').onchange = function () { LS.set('session', this.value); LS.set('session-day', todayISO()); selectSession(this.value); };
  function selectSession(id) { session = plan.sesiones.filter(function (s) { return s.id === id; })[0]; stopRun(); $('notes').value = LS.get('notes-' + id, ''); renderBlocks(); }
  $('notes').addEventListener('input', function () { if (session) LS.set('notes-' + session.id, this.value); });
  $('copyNotes').onclick = function () {
    var txt = 'Apuntes de ' + (session ? session.titulo : 'la sesión') + ' (' + new Date().toLocaleDateString('es-ES') + '):\n' + $('notes').value;
    var fallback = function () { $('notes').select(); toast('Selecciona y copia el texto'); };
    try { navigator.clipboard.writeText(txt).then(function () { toast('Copiado. Pégalo en el chat con Claude.'); }, fallback); } catch (e) { fallback(); }
  };

  function resButton(res) {
    if (res.tipo === 'link' || res.tipo === 'ireal') {
      var a = document.createElement('a'); a.href = res.url; a.textContent = (res.tipo === 'ireal' ? '🎹 iReal: ' : '↗ ') + res.texto; if (res.tipo === 'link') { a.target = '_blank'; a.rel = 'noopener'; } return a;
    }
    var b = document.createElement('button'); b.type = 'button';
    if (res.tipo === 'metro') { b.textContent = '⏱ Metrónomo ' + res.bpm; b.onclick = function () { setBpm(res.bpm); showTab('metro'); if (!metro.on) metroStart(); }; return b; }
    var file = resolveFile(res);
    if (!file) { b.className = 'missing'; b.textContent = (res.tipo === 'pdf' ? '📄 ' : '🎵 ') + res.texto + ' · asignar archivo'; b.onclick = function () { pick(res, function (n) { if (res.tipo === 'pdf') openPdf(n, 1, res.clave); else { loadAudio(n); showTab('audio'); } }); }; return b; }
    if (res.tipo === 'pdf') { var m = maps[res.clave] || {}; var pg = m.pagina || res.pagina || 1; b.textContent = '📄 ' + res.texto + ' · pág. ' + pg; b.onclick = function () { openPdf(file, pg, res.clave); }; if (!m.pagina && !res.pagina) b.textContent += ' (busca la página y pulsa «Guardar página»)'; }
    else { b.textContent = '🎵 ' + res.texto; b.onclick = function () { loadAudio(file); showTab('audio'); }; }
    var wrap = document.createElement('span'); wrap.style.display = 'inline-flex'; wrap.style.gap = '4px'; wrap.appendChild(b);
    var ch = document.createElement('button'); ch.type = 'button'; ch.textContent = '⇄'; ch.title = 'Cambiar archivo'; ch.setAttribute('aria-label', 'Cambiar archivo de ' + res.texto); ch.onclick = function () { pick(res, function () {}); };
    wrap.appendChild(ch); return wrap;
  }
  function renderBlocks() {
    if (!session) return; var host = $('blocks'); host.innerHTML = '';
    session.bloques.forEach(function (bl, i) {
      var d = document.createElement('div'); d.className = 'block' + (run.on && run.idx === i ? ' now' : ''); d.id = 'blk' + i;
      d.innerHTML = '<h3><span>' + esc(bl.nombre) + '</span><small>' + bl.min + ' min</small></h3>';
      (bl.items || []).forEach(function (it) {
        var x = document.createElement('div'); x.className = 'item'; x.innerHTML = '<p>' + esc(it.texto) + '</p>';
        if (it.recursos && it.recursos.length) { var r = document.createElement('div'); r.className = 'res'; it.recursos.forEach(function (res) { r.appendChild(resButton(res)); }); x.appendChild(r); }
        d.appendChild(x);
      });
      host.appendChild(d);
    });
  }

  /* ---------- Sesión guiada con temporizador por bloques ---------- */
  function startRun(idx) { ctx(); run.on = true; run.idx = idx || 0; run.t0 = Date.now(); bell(1); wake(true); $('runStart').hidden = true; $('runNext').hidden = false; $('runStop').hidden = false; tickRun(); clearInterval(run.iv); run.iv = setInterval(tickRun, 500); renderBlocks(); var b = $('blk' + run.idx); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function stopRun() { run.on = false; clearInterval(run.iv); $('runStart').hidden = false; $('runNext').hidden = true; $('runStop').hidden = true; $('runInfo').textContent = session ? 'Sesión de ' + total(session) + ' min' : ''; renderBlocks(); }
  function tickRun() {
    var bl = session.bloques[run.idx]; var left = bl.min * 60 - (Date.now() - run.t0) / 1000;
    if (left <= 0) { if (run.idx + 1 < session.bloques.length) { startRun(run.idx + 1); bell(2); return; } stopRun(); bell(3); $('runInfo').textContent = '¡Sesión terminada! Apunta cómo ha ido.'; return; }
    $('runInfo').textContent = bl.nombre + ' · ' + fmt(left);
  }
  $('runStart').onclick = function () { startRun(0); };
  $('runNext').onclick = function () { if (run.idx + 1 < session.bloques.length) startRun(run.idx + 1); else { stopRun(); } };
  $('runStop').onclick = stopRun;
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (run.on || emom.on || metro.on)) wake(true); });

  /* ---------- Pestañas ---------- */
  function showTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.toggle('on', t.dataset.tab === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.tabpane'), function (p) { p.classList.toggle('on', p.id === 'tab-' + name); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.onclick = function () { showTab(t.dataset.tab); }; });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  refreshLib().then(loadPlan);
})();
