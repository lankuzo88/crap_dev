'use strict';

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function classifyPhucHinh(text) {
  const raw = String(text || '');
  const t = raw.toLowerCase();
  const n = normalize(raw);

  if (n.includes('cui gia') && n.includes('zirconia')) return 'hon';
  if (t.includes('veneer') || t.includes('mat dan') || n.includes('mat dan')) return 'vnr';
  if (n.includes('in mau') || n.includes('mau ham')) return 'inmau';
  if (n.includes('rang tam') || t.includes('pmma') || n.includes('in resin')) return 'tam';
  if (
    t.includes('zircornia') || t.includes('zirconia') || t.includes('ziconia') ||
    t.includes('zir-') || t.includes('zolid') || t.includes('cercon') ||
    t.includes('la va') || n.includes('argen')
  ) return 'zirc';
  if (
    n.includes('kim loai') || t.includes('titanium') || t.includes('titan') ||
    t.includes('chrome') || t.includes('cobalt') || t.includes('cr-co') || t.includes('cr co')
  ) return 'kl';
  return 'unknown';
}

function getDefaultRoom(phucHinh) {
  const type = classifyPhucHinh(phucHinh);
  if (type === 'hon') return 'both';
  if (type === 'zirc' || type === 'inmau' || type === 'tam') return 'zirco';
  return 'sap';
}

module.exports = { classifyPhucHinh, getDefaultRoom };
