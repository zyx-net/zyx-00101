const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth, requireManager } = require('../middleware/auth');
const { filterDevicesByStore } = require('../middleware/store');
const { checkUpdatedAt } = require('../middleware/conflict');
const { DEVICE_STATUS } = require('../constants/status');
const { parseCSV } = require('../utils/export');

router.get('/', requireAuth, (req, res) => {
  const { storeId, status, keyword } = req.query;
  let devices = db.getDevices();
  devices = filterDevicesByStore(devices, req.session.user);
  if (storeId) devices = devices.filter(d => d.storeId === storeId);
  if (status) devices = devices.filter(d => d.status === status);
  if (keyword) {
    const kw = keyword.toLowerCase();
    devices = devices.filter(d =>
      (d.name && d.name.toLowerCase().includes(kw)) ||
      (d.code && d.code.toLowerCase().includes(kw)) ||
      (d.location && d.location.toLowerCase().includes(kw))
    );
  }
  devices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ devices });
});

router.get('/:id', requireAuth, (req, res) => {
  const device = db.getDevices().find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: '设备不存在' });
  if (device.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店设备' });
  }
  res.json({ device });
});

router.post('/', requireManager, (req, res) => {
  const { code, name, category, model, location, purchaseDate, lastMaintenanceDate, status, note, storeId } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: '设备编号和名称必填' });
  }
  const devices = db.getDevices();
  const targetStoreId = storeId || req.session.user.storeId;
  if (targetStoreId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可创建设备' });
  }
  const existing = devices.find(d => d.storeId === targetStoreId && d.code === code);
  if (existing) {
    return res.status(409).json({ error: '该门店已存在相同编号的设备', existing });
  }
  const now = new Date().toISOString();
  const device = {
    id: db.genId('DV'),
    storeId: targetStoreId,
    code,
    name,
    category: category || '',
    model: model || '',
    location: location || '',
    purchaseDate: purchaseDate || '',
    lastMaintenanceDate: lastMaintenanceDate || '',
    status: status || DEVICE_STATUS.NORMAL,
    note: note || '',
    createdAt: now,
    createdBy: req.session.user.id,
    createdByName: req.session.user.name,
    updatedAt: now
  };
  devices.push(device);
  db.saveDevices(devices);
  db.addHistory({
    action: 'CREATE_DEVICE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '创建设备 ' + code + ' ' + name,
    storeId
  });
  res.json({ device });
});

router.put('/:id', requireManager, (req, res) => {
  const devices = db.getDevices();
  const idx = devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '设备不存在' });
  const device = devices[idx];
  if (device.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可修改设备' });
  }
  const { updatedAt } = req.body;
  const conflict = checkUpdatedAt(device, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
  }
  const fields = ['name', 'category', 'model', 'location', 'purchaseDate', 'lastMaintenanceDate', 'status', 'note'];
  fields.forEach(f => {
    if (req.body[f] !== undefined) device[f] = req.body[f] || '';
  });
  if (req.body.code && req.body.code !== device.code) {
    const conflictDev = devices.find(d => d.storeId === device.storeId && d.code === req.body.code && d.id !== device.id);
    if (conflictDev) {
      return res.status(409).json({ error: '该门店已存在相同编号的设备' });
    }
    device.code = req.body.code;
  }
  device.updatedAt = new Date().toISOString();
  devices[idx] = device;
  db.saveDevices(devices);
  db.addHistory({
    action: 'UPDATE_DEVICE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '修改设备 ' + device.code + ' ' + device.name,
    storeId: device.storeId
  });
  res.json({ device });
});

router.delete('/:id', requireManager, (req, res) => {
  const devices = db.getDevices();
  const idx = devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '设备不存在' });
  const device = devices[idx];
  if (device.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可删除设备' });
  }
  devices.splice(idx, 1);
  db.saveDevices(devices);
  db.addHistory({
    action: 'DELETE_DEVICE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '删除设备 ' + device.code + ' ' + device.name,
    storeId: device.storeId
  });
  res.json({ ok: true });
});

router.post('/import/csv', requireManager, (req, res) => {
  const { csvText } = req.body;
  if (!csvText) {
    return res.status(400).json({ error: 'CSV内容为空' });
  }
  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'CSV无有效数据' });
  }
  const storeId = req.session.user.storeId;
  const devices = db.getDevices();
  const existingMap = new Map();
  devices.filter(d => d.storeId === storeId).forEach(d => existingMap.set(d.code, d));

  const imported = [];
  const skipped = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    const code = (row['设备编号'] || row['code'] || '').trim();
    const name = (row['设备名称'] || row['name'] || '').trim();
    if (!code || !name) {
      skipped.push({ row, reason: '设备编号和名称必填' });
      continue;
    }
    if (existingMap.has(code)) {
      skipped.push({ row, reason: '编号重复，保留原数据', existing: existingMap.get(code) });
      continue;
    }
    const device = {
      id: db.genId('DV'),
      storeId,
      code,
      name,
      category: (row['分类'] || row['category'] || '').trim(),
      model: (row['型号'] || row['model'] || '').trim(),
      location: (row['位置'] || row['location'] || '').trim(),
      purchaseDate: (row['购买日期'] || row['purchaseDate'] || '').trim(),
      lastMaintenanceDate: (row['上次维护日期'] || row['lastMaintenanceDate'] || '').trim(),
      status: (row['状态'] || row['status'] || DEVICE_STATUS.NORMAL).trim(),
      note: (row['备注'] || row['note'] || '').trim(),
      createdAt: now,
      createdBy: req.session.user.id,
      createdByName: req.session.user.name,
      updatedAt: now
    };
    devices.push(device);
    existingMap.set(code, device);
    imported.push(device);
  }

  db.saveDevices(devices);
  if (imported.length > 0) {
    db.addHistory({
      action: 'IMPORT_DEVICE',
      userId: req.session.user.id,
      userName: req.session.user.name,
      detail: 'CSV导入设备 ' + imported.length + ' 条，跳过 ' + skipped.length + ' 条',
      storeId
    });
  }
  res.json({ imported, skipped, totalImported: imported.length, totalSkipped: skipped.length });
});

module.exports = router;
