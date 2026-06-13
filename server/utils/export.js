function escapeCSV(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function jsonToCSV(rows, headers) {
  const lines = [];
  lines.push(headers.map(h => escapeCSV(h.label)).join(','));
  for (const row of rows) {
    lines.push(headers.map(h => escapeCSV(row[h.key])).join(','));
  }
  return lines.join('\n');
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  
  const parseLine = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { result.push(cur); cur = ''; }
        else { cur += ch; }
      }
    }
    result.push(cur);
    return result;
  };
  
  const headers = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  });
}

function sendCSV(res, data, filename) {
  const csv = '\uFEFF' + data;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}_${Date.now()}.csv"`);
  res.send(csv);
}

function sendJSON(res, data, filename) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}_${Date.now()}.json"`);
  res.json(data);
}

function exportData(res, data, format, filename, headers) {
  if (format === 'csv') {
    const csv = jsonToCSV(data, headers);
    sendCSV(res, csv, filename);
  } else {
    sendJSON(res, data, filename);
  }
}

module.exports = {
  escapeCSV,
  jsonToCSV,
  parseCSV,
  sendCSV,
  sendJSON,
  exportData
};
