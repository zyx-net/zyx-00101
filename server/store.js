const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_DIR = path.join(__dirname, '..', 'config');

function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getStores() {
  return readJSON(path.join(CONFIG_DIR, 'stores.json')).stores;
}

function getChecklist() {
  return readJSON(path.join(CONFIG_DIR, 'checklist.json')).checklist;
}

function getUsers() {
  return readJSON(path.join(CONFIG_DIR, 'users.json')).users;
}

function findUserByUsername(username) {
  return getUsers().find(u => u.username === username);
}

function getShifts() {
  return readJSON(path.join(DATA_DIR, 'shifts.json'));
}

function saveShifts(shifts) {
  writeJSON(path.join(DATA_DIR, 'shifts.json'), shifts);
}

function getExceptions() {
  return readJSON(path.join(DATA_DIR, 'exceptions.json'));
}

function saveExceptions(exceptions) {
  writeJSON(path.join(DATA_DIR, 'exceptions.json'), exceptions);
}

function getHistory() {
  return readJSON(path.join(DATA_DIR, 'history.json'));
}

function saveHistory(history) {
  writeJSON(path.join(DATA_DIR, 'history.json'), history);
}

function addHistory(entry) {
  const history = getHistory();
  history.push({
    id: 'H' + Date.now() + Math.floor(Math.random() * 1000),
    timestamp: new Date().toISOString(),
    ...entry
  });
  saveHistory(history);
}

function genId(prefix) {
  return prefix + Date.now() + Math.floor(Math.random() * 1000);
}

module.exports = {
  getStores,
  getChecklist,
  getUsers,
  findUserByUsername,
  getShifts,
  saveShifts,
  getExceptions,
  saveExceptions,
  getHistory,
  saveHistory,
  addHistory,
  genId
};
