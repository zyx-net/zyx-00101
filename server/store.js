const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const CONFIG_DIR = path.join(__dirname, '..', 'config');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  ['shifts.json', 'exceptions.json', 'history.json', 'tasks.json', 'devices.json', 'inspection-templates.json', 'inspections.json', 'repair-orders.json'].forEach(f => {
    const fp = path.join(DATA_DIR, f);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, '[]\n', 'utf-8');
  });
}
ensureDataFiles();

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

function getTasks() {
  return readJSON(path.join(DATA_DIR, 'tasks.json'));
}

function saveTasks(tasks) {
  writeJSON(path.join(DATA_DIR, 'tasks.json'), tasks);
}

function getDevices() {
  return readJSON(path.join(DATA_DIR, 'devices.json'));
}
function saveDevices(devices) {
  writeJSON(path.join(DATA_DIR, 'devices.json'), devices);
}
function getInspectionTemplates() {
  return readJSON(path.join(DATA_DIR, 'inspection-templates.json'));
}
function saveInspectionTemplates(templates) {
  writeJSON(path.join(DATA_DIR, 'inspection-templates.json'), templates);
}
function getInspections() {
  return readJSON(path.join(DATA_DIR, 'inspections.json'));
}
function saveInspections(inspections) {
  writeJSON(path.join(DATA_DIR, 'inspections.json'), inspections);
}
function getRepairOrders() {
  return readJSON(path.join(DATA_DIR, 'repair-orders.json'));
}
function saveRepairOrders(orders) {
  writeJSON(path.join(DATA_DIR, 'repair-orders.json'), orders);
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
  genId,
  getTasks,
  saveTasks,
  getDevices,
  saveDevices,
  getInspectionTemplates,
  saveInspectionTemplates,
  getInspections,
  saveInspections,
  getRepairOrders,
  saveRepairOrders
};
