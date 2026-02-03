const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT_DIR, 'data', 'logs');
const VISIT_LOG = path.join(LOG_DIR, 'visits.ndjson');
const DOWNLOAD_LOG = path.join(LOG_DIR, 'downloads.ndjson');
const TOP_LIMIT = 10;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

async function appendLog(file, record) {
  const line = JSON.stringify(record) + '\n';
  await fsp.appendFile(file, line, 'utf8');
}

async function loadRecords(file) {
  try {
    const data = await fsp.readFile(file, 'utf8');
    return data
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.warn(`Skipping malformed line in ${path.basename(file)}`);
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function summarizeCombos(records, limit = TOP_LIMIT) {
  const comboCounts = new Map();
  for (const record of records) {
    const key = Array.isArray(record.days) && record.days.length
      ? record.days.map(String).join('-')
      : 'unknown';
    comboCounts.set(key, (comboCounts.get(key) || 0) + 1);
  }

  const sorted = Array.from(comboCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  const top = sorted
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
  const others = sorted
    .slice(limit)
    .map(([label, count]) => ({ label, count }));

  return { top, others };
}

function countUnique(records, key) {
  const set = new Set();
  for (const record of records) {
    const value = record[key];
    if (value) {
      set.add(value);
    }
  }
  return set.size;
}

function getRecordDateKey(record) {
  if (record.localDate) return record.localDate;
  return record.date;
}

async function aggregateDaily(dateStr) {
  const [visitRecords, downloadRecords] = await Promise.all([
    loadRecords(VISIT_LOG),
    loadRecords(DOWNLOAD_LOG),
  ]);

  const visits = visitRecords.filter((r) => r.date === dateStr);
  const downloads = downloadRecords.filter((r) => r.date === dateStr);
  const uniqueVisitors = countUnique(visits, 'ip');
  const uniqueSessions = countUnique(visits, 'sessionId');
  const uniqueDownloadIps = countUnique(downloads, 'ip');
  const uniqueDownloadSessions = countUnique(downloads, 'sessionId');
  const { top, others } = summarizeCombos(downloads);

  return {
    date: dateStr,
    visits: visits.length,
    uniqueVisitors,
    uniqueSessions,
    downloads: downloads.length,
    uniqueDownloadIps,
    uniqueDownloadSessions,
    conversionRate: visits.length ? Number((downloads.length / visits.length).toFixed(3)) : 0,
    topDownloads: top,
    otherDownloads: others,
  };
}

async function aggregateOverall() {
  const [visitRecords, downloadRecords] = await Promise.all([
    loadRecords(VISIT_LOG),
    loadRecords(DOWNLOAD_LOG),
  ]);

  const uniqueVisitors = countUnique(visitRecords, 'ip');
  const uniqueSessions = countUnique(visitRecords, 'sessionId');
  const uniqueDownloadIps = countUnique(downloadRecords, 'ip');
  const uniqueDownloadSessions = countUnique(downloadRecords, 'sessionId');
  const { top, others } = summarizeCombos(downloadRecords);

  return {
    range: 'all',
    visits: visitRecords.length,
    uniqueVisitors,
    uniqueSessions,
    downloads: downloadRecords.length,
    uniqueDownloadIps,
    uniqueDownloadSessions,
    conversionRate: visitRecords.length ? Number((downloadRecords.length / visitRecords.length).toFixed(3)) : 0,
    topDownloads: top,
    otherDownloads: others,
  };
}

module.exports = {
  ROOT_DIR,
  LOG_DIR,
  VISIT_LOG,
  DOWNLOAD_LOG,
  ensureLogDir,
  appendLog,
  loadRecords,
  aggregateDaily,
  aggregateOverall,
  summarizeCombos,
  countUnique,
};
