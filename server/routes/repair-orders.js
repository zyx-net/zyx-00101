const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth, requireManager } = require('../middleware/auth');
const { filterRepairOrdersByStore } = require('../middleware/store');
const { checkUpdatedAt } = require('../middleware/conflict');
const { DEVICE_STATUS, REPAIR_STATUS } = require('../constants/status');

router.get('/', requireAuth, (req, res) => {
  const { storeId, status, assigneeId, mine, deviceId } = req.query;
  let orders = db.getRepairOrders();
  orders = filterRepairOrdersByStore(orders, req.session.user);
  if (storeId) orders = orders.filter(o => o.storeId === storeId);
  if (status) orders = orders.filter(o => o.status === status);
  if (assigneeId) orders = orders.filter(o => o.assigneeId === assigneeId);
  if (deviceId) orders = orders.filter(o => o.deviceId === deviceId);
  if (mine === '1') {
    orders = orders.filter(o =>
      ((o.assigneeId === req.session.user.id) && (o.status === REPAIR_STATUS.ACCEPTED || o.status === REPAIR_STATUS.REJECTED || o.status === REPAIR_STATUS.COMPLETED)) ||
      ((req.session.user.role === 'manager') && o.storeId === req.session.user.storeId && (o.status === REPAIR_STATUS.REPORTED || o.status === REPAIR_STATUS.COMPLETED))
    );
  }
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ repairOrders: orders });
});

router.get('/:id', requireAuth, (req, res) => {
  const order = db.getRepairOrders().find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: '维修单不存在' });
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店维修单' });
  }
  res.json({ repairOrder: order });
});

router.post('/:id/assign', requireManager, (req, res) => {
  const { assigneeId, note, updatedAt } = req.body;
  const orders = db.getRepairOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '维修单不存在' });
  const order = orders[idx];
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可分派维修单' });
  }
  const conflict = checkUpdatedAt(order, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
  }
  if (order.status !== REPAIR_STATUS.REPORTED && order.status !== REPAIR_STATUS.REJECTED) {
    return res.status(400).json({ error: '当前状态 [' + order.status + '] 不可分派' });
  }
  const users = db.getUsers();
  const assignee = users.find(u => u.id === assigneeId);
  if (!assignee) return res.status(400).json({ error: '接修人不存在' });
  if (assignee.storeId !== order.storeId) {
    return res.status(400).json({ error: '接修人必须属于本门店' });
  }
  const now = new Date().toISOString();
  order.assigneeId = assignee.id;
  order.assigneeName = assignee.name;
  order.status = REPAIR_STATUS.ACCEPTED;
  order.acceptedAt = now;
  order.acceptedBy = req.session.user.id;
  order.acceptedByName = req.session.user.name;
  order.updatedAt = now;
  order.statusHistory.push({
    status: REPAIR_STATUS.ACCEPTED,
    by: req.session.user.id,
    byName: req.session.user.name,
    at: now,
    note: note || '分派给 ' + assignee.name,
  });
  orders[idx] = order;
  db.saveRepairOrders(orders);
  db.addHistory({
    action: 'ASSIGN_REPAIR',
    shiftId: order.shiftId,
    inspectionId: order.inspectionId,
    repairId: order.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '分派维修单 ' + order.id + ' 给 ' + assignee.name,
    storeId: order.storeId
  });
  res.json({ repairOrder: order });
});

router.post('/:id/complete', requireAuth, (req, res) => {
  const { completedNote, updatedAt } = req.body;
  const orders = db.getRepairOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '维修单不存在' });
  const order = orders[idx];
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店人员可完成维修' });
  }
  if (order.assigneeId !== req.session.user.id && req.session.user.role !== 'manager') {
    return res.status(403).json({ error: '仅接修人或店长可完成维修' });
  }
  const conflict = checkUpdatedAt(order, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
  }
  if (order.status !== REPAIR_STATUS.ACCEPTED && order.status !== REPAIR_STATUS.REJECTED) {
    return res.status(400).json({ error: '当前状态 [' + order.status + '] 不可完成' });
  }
  const now = new Date().toISOString();
  order.status = REPAIR_STATUS.COMPLETED;
  order.completedAt = now;
  order.completedBy = req.session.user.id;
  order.completedByName = req.session.user.name;
  order.completedNote = completedNote || '';
  order.updatedAt = now;
  order.statusHistory.push({
    status: REPAIR_STATUS.COMPLETED,
    by: req.session.user.id,
    byName: req.session.user.name,
    at: now,
    note: completedNote || '完成维修'
  });
  orders[idx] = order;
  db.saveRepairOrders(orders);
  db.addHistory({
    action: 'COMPLETE_REPAIR',
    shiftId: order.shiftId,
    inspectionId: order.inspectionId,
    repairId: order.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '完成维修单 ' + order.id,
    storeId: order.storeId
  });
  res.json({ repairOrder: order });
});

router.post('/:id/verify', requireManager, (req, res) => {
  const { verifiedNote, updatedAt } = req.body;
  const orders = db.getRepairOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '维修单不存在' });
  const order = orders[idx];
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可验收维修单' });
  }
  const conflict = checkUpdatedAt(order, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
  }
  if (order.status !== REPAIR_STATUS.COMPLETED) {
    return res.status(400).json({ error: '当前状态 [' + order.status + '] 不可验收' });
  }
  const now = new Date().toISOString();
  order.status = REPAIR_STATUS.VERIFIED;
  order.verifiedAt = now;
  order.verifiedBy = req.session.user.id;
  order.verifiedByName = req.session.user.name;
  order.verifiedNote = verifiedNote || '';
  order.updatedAt = now;
  order.statusHistory.push({
    status: REPAIR_STATUS.VERIFIED,
    by: req.session.user.id,
    byName: req.session.user.name,
    at: now,
    note: verifiedNote || '验收通过'
  });
  orders[idx] = order;
  db.saveRepairOrders(orders);
  const devices = db.getDevices();
  const dIdx = devices.findIndex(d => d.id === order.deviceId);
  if (dIdx !== -1) {
    devices[dIdx].status = DEVICE_STATUS.NORMAL;
    devices[dIdx].updatedAt = now;
    db.saveDevices(devices);
  }
  db.addHistory({
    action: 'VERIFY_REPAIR',
    shiftId: order.shiftId,
    inspectionId: order.inspectionId,
    repairId: order.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '验收维修单 ' + order.id + ' 通过',
    storeId: order.storeId
  });
  res.json({ repairOrder: order });
});

router.post('/:id/reject', requireManager, (req, res) => {
  const { rejectedNote, updatedAt } = req.body;
  const orders = db.getRepairOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '维修单不存在' });
  const order = orders[idx];
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可退回维修单' });
  }
  const conflict = checkUpdatedAt(order, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
  }
  if (order.status !== REPAIR_STATUS.COMPLETED && order.status !== REPAIR_STATUS.REPORTED) {
    return res.status(400).json({ error: '当前状态 [' + order.status + '] 不可退回' });
  }
  const now = new Date().toISOString();
  order.status = REPAIR_STATUS.REJECTED;
  order.rejectedAt = now;
  order.rejectedBy = req.session.user.id;
  order.rejectedByName = req.session.user.name;
  order.rejectedNote = rejectedNote || '';
  order.updatedAt = now;
  order.statusHistory.push({
    status: REPAIR_STATUS.REJECTED,
    by: req.session.user.id,
    byName: req.session.user.name,
    at: now,
    note: rejectedNote || '退回维修'
  });
  orders[idx] = order;
  db.saveRepairOrders(orders);
  db.addHistory({
    action: 'REJECT_REPAIR',
    shiftId: order.shiftId,
    inspectionId: order.inspectionId,
    repairId: order.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '退回维修单 ' + order.id + '：' + (rejectedNote || '无'),
    storeId: order.storeId
  });
  res.json({ repairOrder: order });
});

module.exports = router;
