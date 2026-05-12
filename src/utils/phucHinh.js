'use strict';

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function splitPhucHinhParts(phucHinh) {
  return String(phucHinh || '').split(/;|\r?\n/).map(part => part.trim()).filter(Boolean);
}

function classifyPhucHinh(text) {
  const raw = String(text || '');
  const t = raw.toLowerCase();
  const n = normalize(raw);

  const isZirconia = (
    t.includes('zircornia') || t.includes('zirconia') || t.includes('ziconia') ||
    t.includes('zir-') || t.includes('zolid') || t.includes('cercon') ||
    t.includes('la va') || n.includes('argen')
  );
  const isMetal = (
    n.includes('kim loai') || t.includes('titanium') || t.includes('titan') ||
    t.includes('chrome') || t.includes('cobalt') || t.includes('cr-co') || t.includes('cr co')
  );

  if (n.includes('cui gia') && n.includes('zirconia')) return 'hon';
  if (n.includes('in mau') || n.includes('mau ham')) return 'inmau';
  if (n.includes('rang tam') || t.includes('pmma') || n.includes('in resin')) return 'tam';

  if (t.includes('veneer')) {
    if (isZirconia) return 'zirc';
    if (isMetal)    return 'kl';
    return 'vnr';
  }
  if (t.includes('mat dan') || n.includes('mat dan')) return 'vnr';

  if (isZirconia) return 'zirc';
  if (isMetal)    return 'kl';
  return 'unknown';
}

function getPartRooms(part) {
  const raw = String(part || '');
  const t = raw.toLowerCase();
  const n = normalize(raw);
  const rooms = new Set();

  const isTemporary = n.includes('rang tam') || t.includes('pmma') || n.includes('in resin');
  if (isTemporary) {
    if (t.includes('pmma')) rooms.add('zirco');
    return rooms;
  }

  if (hasInMauHam(raw) || n.includes('in mau') || n.includes('mau ham')) rooms.add('zirco');

  const isZirconia = (
    t.includes('zircornia') || t.includes('zirconia') || t.includes('ziconia') ||
    t.includes('zir-') || t.includes('zolid') || t.includes('cercon') ||
    t.includes('la va') || n.includes('argen')
  );
  const isMetal = (
    n.includes('kim loai') || t.includes('titanium') || t.includes('titan') ||
    t.includes('chrome') || t.includes('cobalt') || t.includes('cr-co') || t.includes('cr co')
  );

  if (n.includes('cui gia') && n.includes('zirconia')) {
    rooms.add('sap');
    rooms.add('zirco');
  } else {
    if (isZirconia) rooms.add('zirco');
    if (isMetal) rooms.add('sap');
  }

  if (!rooms.size && raw.trim()) rooms.add('sap');
  return rooms;
}

function roomsToRoute(rooms) {
  if (rooms.has('sap') && rooms.has('zirco')) return 'both';
  if (rooms.has('zirco')) return 'zirco';
  if (rooms.has('sap')) return 'sap';
  return 'none';
}

function getDefaultRoom(phucHinh) {
  const parts = splitPhucHinhParts(phucHinh);
  const rooms = new Set();
  for (const part of (parts.length ? parts : [phucHinh])) {
    for (const room of getPartRooms(part)) rooms.add(room);
  }
  return roomsToRoute(rooms);
}

function hasInMauHam(text) {
  const n = normalize(text);
  return n.includes('in mau ham') || (n.includes('in mau') && n.includes('ham'));
}

function getRoomWithProductionNote(phucHinh, note) {
  if (hasInMauHam(note)) return 'zirco';
  return getDefaultRoom(phucHinh);
}

module.exports = { classifyPhucHinh, getDefaultRoom, getPartRooms, hasInMauHam, getRoomWithProductionNote };
