import { Matcher, AnalyzedCharacter, data as hzData, decodeCompact } from './vendor/hanzilookup.esm.js';

const $ = (id) => document.getElementById(id);
const input = $('q');
const clearBtn = $('clear');
const goBtn = $('goBtn');
const searchView = $('searchView');
const resultView = $('resultView');
const resultEl = $('result');
const resultBack = $('resultBack');
const handGrid = $('handGrid');
const padUndo = $('padUndo');
const padClear = $('padClear');
const padQuery = $('padQuery');
const padStatus = $('padStatus');
const historyEl = $('history');
const historyList = $('historyList');
const loadNote = $('loadNote');

const D = window.CN_DATA;
if (!D) {
  loadNote.textContent = '词库加载失败，请刷新页面。';
  throw new Error('CN_DATA missing');
}
const words = D.w || [];
const chars = D.c || [];
const idioms = D.i || [];
const TYPE = { w: '词', c: '字', i: '成语' };

const wordIndex = new Map();
const charIndex = new Map();
const idiomIndex = new Map();
words.forEach((e, i) => wordIndex.set(e[0], i));
chars.forEach((e, i) => charIndex.set(e[0], i));
idioms.forEach((e, i) => idiomIndex.set(e[0], i));

function normPinyin(s) {
  s = String(s || '').toLowerCase().replace(/u:/g, 'v');
  s = s.replace(/ü/g, 'v').replace(/ǖ/g, 'v').replace(/ǘ/g, 'v').replace(/ǚ/g, 'v').replace(/ǜ/g, 'v');
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s.replace(/[^a-z]/g, '');
}

const pyList = [];
function addPy(py, t, i) {
  const keys = new Set();
  String(py || '').split('/').forEach((part) => {
    const k = normPinyin(part);
    if (!k) return;
    keys.add(k);
    if (k.indexOf('v') >= 0) keys.add(k.replace(/v/g, 'u'));
  });
  keys.forEach((k) => pyList.push({ k, t, i }));
}
words.forEach((e, i) => addPy(e[1], 'w', i));
idioms.forEach((e, i) => addPy(e[1], 'i', i));
chars.forEach((e, i) => addPy(e[1], 'c', i));

function getEntry(t, i) {
  if (t === 'w') {
    const e = words[i];
    return { type: 'w', word: e[0], pinyin: e[1], def: e[2], raw: e };
  }
  if (t === 'c') {
    const e = chars[i];
    return { type: 'c', word: e[0], pinyin: e[1], def: e[2], raw: e };
  }
  const e = idioms[i];
  return { type: 'i', word: e[0], pinyin: e[1], def: e[2], raw: e };
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function brief(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function stripParens(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '');
  } while (s !== prev);
  return s;
}

function cleanCharDef(def, word) {
  let s = String(def || '').replace(/\r/g, '\n');
  s = stripParens(s);
  s = s.replace(/〈[^〉]*〉/g, '');
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(esc + '[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü0-9:\\s]*', 'g'), '');
  s = s.replace(/[“”"][^“”"]*[“”"]/g, '');
  const sentences = s.split(/[。\n]/).map((x) => x.trim()).filter((x) => x && x.indexOf('～') < 0);
  const out = [];
  for (const sent of sentences) {
    sent.split(/[，,；;]/).forEach((c) => {
      c = c.replace(/^[0-9]+[.．、]\s*/, '').trim();
      if (!c) return;
      if (/^(又如|例如|如|例|参见|另见|同本义|本义|引申|用作|用于|见于|语出)/.test(c)) return;
      if (c.indexOf('～') >= 0 || c.indexOf('《') >= 0 || c.indexOf('》') >= 0) return;
      if (c.length > 36) return;
      if (!/[一-龥]/.test(c)) return;
      if (!out.includes(c)) out.push(c);
    });
  }
  let res = out.slice(0, 6).join('；');
  if (!res) res = stripParens(String(def || '')).replace(/～.*$/, '').trim().slice(0, 80);
  return res;
}

function cleanWordDef(def) {
  let s = String(def || '').replace(/\r/g, '\n');
  s = stripParens(s);
  s = s.replace(/[“”"][^“”"]*[“”"]/g, '');
  const parts = s.split(/[；;\n]/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (let p of parts) {
    const idx = p.search(/[：:]/);
    if (idx >= 0) p = p.slice(0, idx).trim();
    if (!p || p.indexOf('～') >= 0) continue;
    out.push(p);
    if (out.length >= 4) break;
  }
  const res = out.join('；');
  return res || s.trim().slice(0, 120);
}

function entryDef(entry) {
  return entry.def;
}

function briefDef(def) {
  const lines = String(def || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const heading = /^[一-龥][a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]*(?:\s*〈[^〉]*〉)?$/;
  const sense = lines.find((x) => /^\d+\./.test(x)) ||
    lines.find((x) => !heading.test(x) && !/^常用（/.test(x)) ||
    lines[0] || '';
  return sense.replace(/^\d+\.\s*/, '').slice(0, 60);
}

function wordsWithChar(ch) {
  const out = [];
  for (let i = 0; i < words.length && out.length < 8; i++) {
    if (words[i][0].indexOf(ch) >= 0) out.push({ t: 'w', i });
  }
  if (out.length < 3) {
    for (let i = 0; i < idioms.length && out.length < 8; i++) {
      if (idioms[i][0].indexOf(ch) >= 0) out.push({ t: 'i', i });
    }
  }
  return out;
}

function homophoneChars(ch, pinyin) {
  const keys = new Set(String(pinyin || '').split('/').map(normPinyin).filter(Boolean));
  if (!keys.size) return [];
  const out = [];
  for (let i = 0; i < chars.length && out.length < 8; i++) {
    const e = chars[i];
    if (e[0] === ch) continue;
    const ekeys = String(e[1] || '').split('/').map(normPinyin);
    if (ekeys.some((k) => keys.has(k))) out.push(i);
  }
  return out;
}

function homophoneWords(pinyin) {
  const keys = new Set(String(pinyin || '').split('/').map(normPinyin).filter(Boolean));
  if (!keys.size) return [];
  const out = [];
  for (let i = 0; i < words.length && out.length < 8; i++) {
    if (keys.has(normPinyin(words[i][1]))) out.push(i);
  }
  return out;
}

function renderCharExtras(card, entry) {
  const ch = entry.word;
  const hits = wordsWithChar(ch);
  if (hits.length) {
    card.appendChild(el('div', 'section-label', '可组的词'));
    const list = el('div', 'pinyin-list');
    hits.forEach(({ t, i }) => {
      const e = getEntry(t, i);
      const b = el('button', 'py-item');
      b.type = 'button';
      b.appendChild(el('span', 'py-word', e.word));
      b.appendChild(el('span', 'py-pinyin', e.pinyin));
      b.appendChild(el('span', 'py-type', TYPE[t]));
      b.appendChild(el('span', 'py-gloss', briefDef(e.def)));
      b.addEventListener('click', () => showDetail(e));
      list.appendChild(b);
    });
    card.appendChild(list);
  }

  const homos = homophoneChars(ch, entry.pinyin);
  if (homos.length) {
    card.appendChild(el('div', 'section-label', '同音字'));
    const list = el('div', 'pinyin-list');
    homos.forEach((i) => {
      const e = getEntry('c', i);
      const b = el('button', 'py-item');
      b.type = 'button';
      b.appendChild(el('span', 'py-word', e.word));
      b.appendChild(el('span', 'py-pinyin', e.pinyin));
      b.appendChild(el('span', 'py-gloss', briefDef(e.def)));
      b.addEventListener('click', () => showDetail(e));
      list.appendChild(b);
    });
    card.appendChild(list);
  }

  const homoWords = homophoneWords(entry.pinyin);
  if (homoWords.length) {
    card.appendChild(el('div', 'section-label', '同音词'));
    const list = el('div', 'pinyin-list');
    homoWords.forEach((i) => {
      const e = getEntry('w', i);
      const b = el('button', 'py-item');
      b.type = 'button';
      b.appendChild(el('span', 'py-word', e.word));
      b.appendChild(el('span', 'py-pinyin', e.pinyin));
      b.appendChild(el('span', 'py-gloss', briefDef(e.def)));
      b.addEventListener('click', () => showDetail(e));
      list.appendChild(b);
    });
    card.appendChild(list);
  }
}

function hasHan(s) {
  return /[\u3400-\u9fff]/.test(s);
}

const SPEAKER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path></svg>';

/* ---------- 发音 ---------- */
const synth = window.speechSynthesis;
let voices = [];
function loadVoices() {
  try { voices = synth ? synth.getVoices() : []; } catch (e) { voices = []; }
}
if (synth) {
  loadVoices();
  if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
  else synth.onvoiceschanged = loadVoices;
}
function speak(text) {
  if (!synth) return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.82;
    if (!voices.length) loadVoices();
    const pick = voices.find((v) => /^zh/i.test(v.lang) && v.localService) ||
                 voices.find((v) => /^zh/i.test(v.lang));
    if (pick) u.voice = pick;
    synth.speak(u);
  } catch (e) {}
}

function speakerRow(text) {
  const row = el('div', 'spkrow');
  const b = el('button', 'spk');
  b.type = 'button';
  b.setAttribute('aria-label', '读这个词');
  b.innerHTML = SPEAKER_SVG + '<span>读</span>';
  b.addEventListener('click', () => speak(text));
  row.appendChild(b);
  return row;
}

/* ---------- 页面切换 ---------- */
function showSearchView() {
  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
  resultView.hidden = true;
  searchView.hidden = false;
  window.scrollTo(0, 0);
}
function showResultView() {
  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
  searchView.hidden = true;
  resultView.hidden = false;
  window.scrollTo(0, 0);
}

/* ---------- 查询 ---------- */
function lookupDirect(q) {
  if (idiomIndex.has(q)) return getEntry('i', idiomIndex.get(q));
  if (wordIndex.has(q)) return getEntry('w', wordIndex.get(q));
  if (charIndex.has(q)) return getEntry('c', charIndex.get(q));
  return null;
}

function findOneCharDiff(word, groups) {
  if (!word || word.length < 2) return [];
  const out = [];
  const scan = (arr, t) => {
    for (let i = 0; i < arr.length; i++) {
      const w = arr[i][0];
      if (w.length !== word.length) continue;
      let diff = 0;
      let pos = -1;
      for (let j = 0; j < word.length; j++) {
        if (w[j] !== word[j]) {
          diff++;
          pos = j;
          if (diff > 1) break;
        }
      }
      if (diff === 1) {
        const alts = (groups && groups[pos]) ? groups[pos] : [];
        const score = (alts.indexOf(w[pos]) >= 0 ? 3 : 0) + (t === 'i' ? 2 : 0);
        out.push({ t, i, pos, word: w, score });
      }
    }
  };
  scan(idioms, 'i');
  scan(words, 'w');
  out.sort((a, b) => b.score - a.score || a.word.length - b.word.length);
  const seen = new Set();
  const res = [];
  for (const c of out) {
    if (seen.has(c.word)) continue;
    seen.add(c.word);
    res.push(c);
    if (res.length >= 8) break;
  }
  return res;
}

function queryText(q) {
  q = String(q || '').trim();
  if (!q) return;
  if (hasHan(q)) {
    const entry = lookupDirect(q);
    if (entry) {
      showDetail(entry);
      return;
    }
    renderNotFound(q, null);
    showResultView();
    return;
  }
  if (normPinyin(q)) {
    queryPinyin(q);
    return;
  }
  renderNotFound(q, null);
  showResultView();
}

function searchPinyin(q) {
  const qn = normPinyin(q);
  if (!qn) return { qn: '', list: [] };
  const raw = [];
  for (let i = 0; i < pyList.length; i++) {
    const it = pyList[i];
    if (it.k === qn) raw.push({ t: it.t, i: it.i, exact: true });
    else if (it.k.indexOf(qn) === 0) raw.push({ t: it.t, i: it.i, exact: false });
  }
  const rel = (t, i) => (t === 'w' ? i / words.length : t === 'c' ? i / chars.length : i / idioms.length);
  raw.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || rel(a.t, a.i) - rel(b.t, b.i));
  const seen = new Set();
  const list = [];
  for (let j = 0; j < raw.length; j++) {
    const it = raw[j];
    const e = getEntry(it.t, it.i);
    if (seen.has(e.word)) continue;
    seen.add(e.word);
    list.push(it);
    if (list.length >= 200) break;
  }
  return { qn, list };
}

function queryPinyin(q) {
  const res = searchPinyin(q);
  if (!res.list.length) {
    renderPinyinEmpty(q);
    showResultView();
    return;
  }
  const exact = res.list.filter((it) => it.exact);
  const prefix = res.list.filter((it) => !it.exact);
  const exactWords = exact.filter((it) => it.t === 'w' || it.t === 'i');
  const exactChars = exact.filter((it) => it.t === 'c');
  if (res.list.length === 1 || (exactWords.length === 1 && exactChars.length === 0 && res.qn.length >= 3)) {
    const it = exactWords[0] || res.list[0];
    showDetail(getEntry(it.t, it.i), { pinyinQuery: q });
    return;
  }
  renderPinyinResults(q, exact, prefix);
  showResultView();
}

/* ---------- 结果页 ---------- */
function showDetail(entry, opts) {
  opts = opts || {};
  resultEl.replaceChildren();
  const card = el('article', 'entry');

  const wl = el('div', 'wordline');
  wl.appendChild(el('h2', 'word', entry.word));
  if (entry.pinyin) wl.appendChild(el('span', 'phon', entry.pinyin));
  wl.appendChild(el('span', 'type-badge', TYPE[entry.type]));
  card.appendChild(wl);
  card.appendChild(speakerRow(entry.word));

  if (entry.type === 'c') {
    const meta = el('div', 'meta-row');
    if (entry.raw[3]) meta.appendChild(el('span', 'meta-pill', '部首 ' + entry.raw[3]));
    if (entry.raw[4]) meta.appendChild(el('span', 'meta-pill', entry.raw[4] + ' 画'));
    if (meta.children.length) card.appendChild(meta);
  }

  if (opts.correction) {
    const c = opts.correction;
    let msg = '已根据其他字推断为「' + c.to + '」';
    if (c.pos >= 0 && c.to[c.pos]) msg += '（第 ' + (c.pos + 1) + ' 个字应为「' + c.to[c.pos] + '」）';
    card.appendChild(el('div', 'correction-note', msg));
  }

  if (opts.recogGroups && opts.recogGroups.length) {
    card.appendChild(recogBlock(opts.recogGroups, entry.word));
  }

  card.appendChild(el('div', 'definition', entryDef(entry)));

  if (entry.type === 'c') renderCharExtras(card, entry);

  if (entry.type === 'i' && entry.raw[4]) {
    card.appendChild(el('div', 'section-label', '例句'));
    card.appendChild(el('div', 'idiom-text', entry.raw[4]));
  }
  if (entry.type === 'i' && entry.raw[3]) {
    const extra = el('details', 'recog-details');
    extra.appendChild(el('summary', 'recog-summary', '出处'));
    extra.appendChild(el('div', 'idiom-text', entry.raw[3]));
    card.appendChild(extra);
  }

  if (opts.pinyinQuery) {
    card.appendChild(el('p', 'pinyin-note', '拼音：' + opts.pinyinQuery));
  }

  resultEl.appendChild(card);
  addHistory(entry.word);
  showResultView();
}

function recogBlock(groups, word) {
  const det = el('details', 'recog-details');
  det.appendChild(el('summary', 'recog-summary', '手写识别：' + word + '（识别不对？点这里修改）'));
  const chars = [...word];
  groups.forEach((cands, idx) => {
    if (!cands || !cands.length) return;
    const row = el('div', 'recog-group');
    row.appendChild(el('span', 'recog-pos', '第 ' + (idx + 1) + ' 字'));
    const active = chars[idx] || '';
    cands.slice(0, 8).forEach((ch) => {
      const b = el('button', 'recog-chip' + (ch === active ? ' active' : ''), ch);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (ch === active) return;
        const arr = [...word];
        arr[idx] = ch;
        const nw = arr.join('');
        input.value = nw;
        toggleClear();
        const e = lookupDirect(nw);
        if (e) {
          showDetail(e, { recogGroups: groups });
        } else {
          renderNotFound(nw, groups);
          showResultView();
        }
        window.scrollTo(0, 0);
      });
      row.appendChild(b);
    });
    det.appendChild(row);
  });
  return det;
}

function renderPinyinResults(original, exact, prefix) {
  resultEl.replaceChildren();
  const card = el('article', 'entry');
  const wl = el('div', 'wordline');
  wl.appendChild(el('span', 'type-badge', '拼音'));
  wl.appendChild(el('span', 'phon', original));
  card.appendChild(wl);
  const total = exact.length + prefix.length;
  card.appendChild(el('p', 'pinyin-note', '共 ' + total + ' 个同音/相关结果，点一个查看释义。'));
  const addSection = (label, items) => {
    if (!items.length) return;
    card.appendChild(el('div', 'section-label', label));
    const box = el('div', 'pinyin-list');
    items.slice(0, 30).forEach((it) => {
      const e = getEntry(it.t, it.i);
      const b = el('button', 'py-item');
      b.type = 'button';
      b.appendChild(el('span', 'py-word', e.word));
      b.appendChild(el('span', 'py-pinyin', e.pinyin));
      b.appendChild(el('span', 'py-type', TYPE[it.t]));
      b.appendChild(el('span', 'py-gloss', briefDef(e.def)));
      b.addEventListener('click', () => {
        showDetail(e, { pinyinQuery: original });
      });
      box.appendChild(b);
    });
    card.appendChild(box);
  };
  addSection('同音字词', exact);
  addSection('相关字词', prefix);
  resultEl.appendChild(card);
}

function renderPinyinEmpty(q) {
  resultEl.replaceChildren();
  const card = el('article', 'entry');
  card.appendChild(el('h2', 'word', q));
  card.appendChild(el('p', 'notfound', '没有找到拼音「' + q + '」对应的字或词。试试少输几个字母，或者输入汉字。'));
  resultEl.appendChild(card);
}

function renderNotFound(q, recognition) {
  resultEl.replaceChildren();
  const card = el('article', 'entry');
  card.appendChild(el('h2', 'word', q));
  card.appendChild(el('p', 'notfound', '词库里没有找到「' + q + '」的释义。'));
  if (recognition && recognition.length) card.appendChild(recogBlock(recognition, q));

  const list = [...q].filter((ch) => hasHan(ch));
  if (list.length > 1) {
    const box = el('div', 'char-cards');
    let count = 0;
    list.forEach((ch) => {
      if (!charIndex.has(ch)) return;
      count++;
      const e = getEntry('c', charIndex.get(ch));
      const b = el('button', 'char-card');
      b.type = 'button';
      const head = el('div', 'cc-head');
      head.appendChild(el('span', 'cc-char', ch));
      head.appendChild(el('span', 'cc-py', e.pinyin));
      b.appendChild(head);
      b.appendChild(el('div', 'cc-def', briefDef(e.def)));
      b.addEventListener('click', () => {
        input.value = ch;
        toggleClear();
        showDetail(e);
      });
      box.appendChild(b);
    });
    if (count) {
      card.appendChild(el('div', 'section-label', '按单字查'));
      card.appendChild(box);
    }
  }
  resultEl.appendChild(card);
}

/* ---------- 手写 ---------- */
let matcher = null;
const CELL_COUNT = 4;
const cells = [];
let strokeHistory = [];
let activeCell = -1;

function strokeColor() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? '#e9ece8' : '#1f2320';
}

function setPadStatus(text, isError) {
  padStatus.textContent = text || '';
  padStatus.classList.toggle('err', !!isError);
}

function clearCellMarks() {
  cells.forEach((st) => st.el.classList.remove('unrecognized'));
}

function markUnrecognized(indices) {
  clearCellMarks();
  indices.forEach((i) => {
    if (cells[i]) cells[i].el.classList.add('unrecognized');
  });
}

function createCells() {
  handGrid.replaceChildren();
  cells.length = 0;
  strokeHistory = [];
  activeCell = -1;
  for (let i = 0; i < CELL_COUNT; i++) {
    const cellEl = el('div', 'hand-cell');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cell-guide');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML =
      '<line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" stroke-width="0.8" stroke-dasharray="3 3"></line>' +
      '<line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" stroke-width="0.8" stroke-dasharray="3 3"></line>' +
      '<line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" stroke-width="0.5" opacity=".5"></line>' +
      '<line x1="100" y1="0" x2="0" y2="100" stroke="currentColor" stroke-width="0.5" opacity=".5"></line>';
    const canvas = document.createElement('canvas');
    canvas.className = 'cell-canvas';
    const ctx = canvas.getContext('2d');
    const clear = document.createElement('button');
    clear.className = 'cell-clear';
    clear.type = 'button';
    clear.textContent = '×';
    clear.setAttribute('aria-label', '清空这一格');
    clear.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    clear.addEventListener('click', (ev) => { ev.stopPropagation(); clearCell(i); });
    cellEl.appendChild(svg);
    cellEl.appendChild(canvas);
    cellEl.appendChild(clear);
    handGrid.appendChild(cellEl);
    const state = { el: cellEl, canvas, ctx, clearBtn: clear, strokes: [], current: null, drawing: false, w: 0, h: 0 };
    cells.push(state);
    updateCellClear(state);
    canvas.addEventListener('pointerdown', (ev) => onCellDown(i, ev), { passive: false });
    canvas.addEventListener('pointermove', (ev) => onCellMove(i, ev), { passive: false });
    canvas.addEventListener('pointerup', (ev) => onCellUp(i, ev), { passive: false });
    canvas.addEventListener('pointercancel', (ev) => onCellUp(i, ev), { passive: false });
  }
}

function resizeCells() {
  const dpr = window.devicePixelRatio || 1;
  cells.forEach((st) => {
    const rect = st.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (st.w && st.h && (w !== st.w || h !== st.h)) {
      const sx = w / st.w, sy = h / st.h;
      st.strokes = st.strokes.map((s) => s.map(([x, y]) => [x * sx, y * sy]));
      if (st.current) st.current = st.current.map(([x, y]) => [x * sx, y * sy]);
    }
    st.w = w;
    st.h = h;
    st.canvas.width = Math.round(w * dpr);
    st.canvas.height = Math.round(h * dpr);
    st.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    st.ctx.lineWidth = 7;
    st.ctx.lineCap = 'round';
    st.ctx.lineJoin = 'round';
    drawCell(st);
  });
}

function drawPoints(st, points) {
  if (!points || !points.length) return;
  st.ctx.strokeStyle = strokeColor();
  st.ctx.beginPath();
  if (points.length === 1) {
    st.ctx.arc(points[0][0], points[0][1], 1.5, 0, Math.PI * 2);
    st.ctx.fillStyle = strokeColor();
    st.ctx.fill();
    return;
  }
  st.ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) st.ctx.lineTo(points[i][0], points[i][1]);
  st.ctx.stroke();
}

function drawCell(st) {
  st.ctx.clearRect(0, 0, st.w, st.h);
  st.ctx.strokeStyle = strokeColor();
  for (let i = 0; i < st.strokes.length; i++) drawPoints(st, st.strokes[i]);
  if (st.current) drawPoints(st, st.current);
}

function updateCellClear(st) {
  st.clearBtn.style.display = st.strokes.length ? 'flex' : 'none';
}

function clearCell(i) {
  const st = cells[i];
  st.strokes = [];
  st.current = null;
  st.drawing = false;
  st.el.classList.remove('active');
  st.el.classList.remove('unrecognized');
  drawCell(st);
  updateCellClear(st);
  strokeHistory = strokeHistory.filter((x) => x !== i);
  setPadStatus('已清空第 ' + (i + 1) + ' 格');
}

function cellPos(st, ev) {
  const r = st.canvas.getBoundingClientRect();
  return [ev.clientX - r.left, ev.clientY - r.top];
}

function onCellDown(i, ev) {
  const st = cells[i];
  st.el.classList.remove('unrecognized');
  if (st.current) return;
  if (ev.pointerType === 'touch' && ev.isPrimary === false) return;
  ev.preventDefault();
  try { st.canvas.setPointerCapture(ev.pointerId); } catch (e) {}
  const p = cellPos(st, ev);
  st.current = [p];
  st.drawing = true;
  activeCell = i;
  cells.forEach((c, j) => c.el.classList.toggle('active', j === i));
  drawCell(st);
}

function onCellMove(i, ev) {
  const st = cells[i];
  if (!st.drawing || !st.current) return;
  ev.preventDefault();
  const p = cellPos(st, ev);
  const last = st.current[st.current.length - 1];
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.1) return;
  st.current.push(p);
  st.ctx.strokeStyle = strokeColor();
  st.ctx.beginPath();
  st.ctx.moveTo(last[0], last[1]);
  st.ctx.lineTo(p[0], p[1]);
  st.ctx.stroke();
}

function onCellUp(i, ev) {
  const st = cells[i];
  if (!st.drawing) return;
  ev.preventDefault();
  st.drawing = false;
  if (st.current && st.current.length) {
    st.strokes.push(st.current);
    strokeHistory.push(i);
  }
  st.current = null;
  drawCell(st);
  updateCellClear(st);
  try { st.canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
}

function undoStroke() {
  const i = strokeHistory.pop();
  if (i == null) return;
  const st = cells[i];
  st.el.classList.remove('unrecognized');
  if (st.strokes.length) st.strokes.pop();
  st.current = null;
  st.drawing = false;
  drawCell(st);
  updateCellClear(st);
  setPadStatus('');
}

function clearCells() {
  cells.forEach((st) => {
    st.strokes = [];
    st.current = null;
    st.drawing = false;
    st.el.classList.remove('active');
    st.el.classList.remove('unrecognized');
    drawCell(st);
    updateCellClear(st);
  });
  strokeHistory = [];
  activeCell = -1;
  setPadStatus('');
}

function cellCandidates(matches) {
  const seen = new Set();
  const out = [];
  (matches || []).forEach((m) => {
    const ch = m && m.character;
    if (ch && !seen.has(ch)) { seen.add(ch); out.push(ch); }
  });
  return out;
}

function recognizeCells() {
  if (!matcher) {
    setPadStatus('手写识别还没准备好，可以先用拼音或汉字查询。', true);
    return;
  }
  const occupied = cells.map((st, i) => ({ st, i })).filter((o) => o.st.strokes.length);
  if (!occupied.length) {
    setPadStatus('先在格子里写一个字。');
    return;
  }
  setPadStatus('识别中…');
  clearCellMarks();
  padQuery.disabled = true;
  const matchOne = (points) => new Promise((resolve) => {
    try {
      matcher.match(new AnalyzedCharacter(points), 8, (m) => resolve(m || []));
    } catch (e) {
      resolve([]);
    }
  });
  Promise.all(occupied.map((o) => matchOne(o.st.strokes))).then((results) => {
    const groups = results.map(cellCandidates);
    const missing = [];
    groups.forEach((g, idx) => {
      if (!g.length) missing.push(occupied[idx].i);
    });
    if (missing.length) {
      markUnrecognized(missing);
      const where = missing.map((i) => '第 ' + (i + 1) + ' 格').join('、');
      setPadStatus(where + '没认出来。红框里的字重写一下，再点“查询手写”。', true);
      padQuery.disabled = false;
      return;
    }
    clearCellMarks();
    let word = groups.map((g) => g.find((ch) => charIndex.has(ch)) || g[0]).join('');
    let entry = lookupDirect(word);
    let correction = null;
    if (!entry) {
      const cands = findOneCharDiff(word, groups);
      if (cands.length) {
        const best = cands[0];
        const e = getEntry(best.t, best.i);
        if (e) {
          correction = { from: word, to: e.word, pos: best.pos };
          word = e.word;
          entry = e;
        }
      }
    }
    input.value = word;
    toggleClear();
    setPadStatus('');
    if (entry) {
      showDetail(entry, { recogGroups: groups, correction });
    } else {
      renderNotFound(word, groups);
      showResultView();
    }
    padQuery.disabled = false;
  }).catch(() => {
    padQuery.disabled = false;
    setPadStatus('识别出错，再写一次。', true);
  });
}

function initHandwriting() {
  try {
    if (!window.HANZI_DATA) throw new Error('handwriting data missing');
    hzData['mmah'] = window.HANZI_DATA;
    hzData['mmah'].substrokes = decodeCompact(hzData['mmah'].substrokes);
    matcher = new Matcher('mmah');
    setPadStatus('');
  } catch (e) {
    matcher = null;
    setPadStatus('手写识别加载失败，可以先用拼音或输入汉字查询。', true);
  }
}

window.addEventListener('resize', resizeCells);
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const redrawAll = () => cells.forEach(drawCell);
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', redrawAll);
  else if (typeof mq.addListener === 'function') mq.addListener(redrawAll);
}

/* ---------- 最近查询 ---------- */
const HISTORY_KEY = 'ci_history_v1';
function getHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(h) ? h.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch (e) { return []; }
}
function addHistory(word) {
  try {
    const h = getHistory().filter((w) => w !== word);
    h.unshift(word);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 8)));
    renderHistory();
  } catch (e) {}
}
function renderHistory() {
  const h = getHistory();
  historyEl.hidden = h.length === 0;
  historyList.replaceChildren();
  h.forEach((w) => {
    const b = el('button', 'chip', w);
    b.type = 'button';
    b.addEventListener('click', () => {
      input.value = w;
      toggleClear();
      queryText(w);
    });
    historyList.appendChild(b);
  });
}

/* ---------- 事件 ---------- */
function toggleClear() {
  clearBtn.style.display = input.value ? 'block' : 'none';
}

function runMainQuery() {
  const q = input.value.trim();
  if (q) {
    queryText(q);
    return;
  }
  if (cells.some((c) => c.strokes.length)) {
    recognizeCells();
    return;
  }
  input.focus();
  setPadStatus('输入汉字或拼音，或在格子里写一个字。');
}

input.addEventListener('input', toggleClear);
input.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    runMainQuery();
  } else if (ev.key === 'Escape') {
    input.blur();
  }
});
clearBtn.addEventListener('click', () => {
  input.value = '';
  toggleClear();
  input.focus();
});
goBtn.addEventListener('click', runMainQuery);
resultBack.addEventListener('click', showSearchView);

padUndo.addEventListener('click', undoStroke);
padClear.addEventListener('click', clearCells);
padQuery.addEventListener('click', recognizeCells);

/* 手写区禁止长按选中，避免 iPad 弹出系统菜单 */
const handCardEl = document.querySelector('.hand-card');
if (handCardEl) {
  ['contextmenu', 'selectstart', 'dragstart'].forEach((evt) => {
    handCardEl.addEventListener(evt, (e) => e.preventDefault());
  });
}

/* ---------- 启动 ---------- */
loadNote.textContent = '';
initHandwriting();
createCells();
resizeCells();
requestAnimationFrame(resizeCells);
renderHistory();
toggleClear();
showSearchView();

window.__cnDebug = {
  cells: cells,
  findOneCharDiff: findOneCharDiff,
  lookupDirect: lookupDirect,
  getEntry: getEntry,
  showDetail: showDetail,
};
