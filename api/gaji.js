// Vercel Serverless Function: GET /api/gaji
// Env: SHEET_ID (wajib), SHEET_NAME (default "Gaji Guru"), APP_PASSWORD (opsional)

const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// "Rp250.000,00" / "250000" / "33.333,33" -> angka
function toNum(v) {
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD) {
    const decComma = s.lastIndexOf(',') > s.lastIndexOf('.');
    s = decComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasC) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasD) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Bulan bisa berupa: 46174 (serial tanggal), 2026-06-01, 1/6/2026, "Juni 2026", "Juni"
function parseBulan(raw) {
  const s = String(raw ?? '').trim();
  let y, m;
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    y = d.getUTCFullYear(); m = d.getUTCMonth();
  } else if (/^\d{4}-\d{1,2}/.test(s)) {
    [y, m] = s.split('-').map(Number); m -= 1;
  } else if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(s)) {
    let [a, b, c] = s.split(/[\/-]/).map(Number);
    if (b > 12) [a, b] = [b, a]; // format m/d/y
    m = b - 1; y = c < 100 ? 2000 + c : c;
  } else {
    const i = BULAN.findIndex(n => s.toLowerCase().includes(n.toLowerCase()));
    if (i >= 0) { m = i; y = (s.match(/\d{4}/) || [0])[0] * 1; }
  }
  if (m === undefined || m < 0 || m > 11) return { key: '9999-' + s, label: s || '-' };
  return { key: `${y || 0}-${String(m + 1).padStart(2, '0')}`, label: y ? `${BULAN[m]} ${y}` : BULAN[m] };
}

const norm = h => h.toLowerCase().replace(/[^a-z]/g, '');

module.exports = async (req, res) => {
  try {
    const pass = process.env.APP_PASSWORD;
    if (pass && req.headers['x-password'] !== pass) return res.status(401).json({ error: 'Password salah' });

    const id = process.env.SHEET_ID;
    if (!id) return res.status(500).json({ error: 'SHEET_ID belum diisi di Environment Variables Vercel' });
    const sheet = process.env.SHEET_NAME || 'Gaji Guru';
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: 'Gagal membaca Google Sheet. Pastikan akses "Siapa saja yang memiliki link" (Viewer).' });

    const [head, ...body] = parseCSV(await r.text());
    const col = {}; head.forEach((h, i) => (col[norm(h)] = i));
    const get = (row, k) => row[col[k]] ?? '';

    const data = body.filter(r => get(r, 'namaguru').trim()).map(r => {
      const b = parseBulan(get(r, 'bulan'));
      const sesi = toNum(get(r, 'jmlsesidiajar')), nilai = toNum(get(r, 'nilaipersesi'));
      const sub = get(r, 'subtotal') !== '' ? toNum(get(r, 'subtotal')) : sesi * nilai;
      return {
        bulanKey: b.key, bulan: b.label,
        guru: get(r, 'namaguru').trim(), siswa: get(r, 'namasiswa').trim(), paket: get(r, 'paket').trim(),
        hargaPaket: toNum(get(r, 'hargapaket')), totalSesi: toNum(get(r, 'totalsesipaket')),
        sesi, status: get(r, 'statusguru').trim(), nilai, subtotal: sub
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ data });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
