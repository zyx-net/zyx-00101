const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth } = require('../middleware/auth');
const { filterShiftsByStore, filterExceptionsByStore, filterTasksByStore, filterDevicesByStore, filterInspectionsByStore, filterRepairOrdersByStore } = require('../middleware/store');
const { jsonToCSV, sendCSV, sendJSON } = require('../utils/export');
const { STATUS_LABELS } = require('../constants/status');

router.get('/shifts', requireAuth, (req, res) => {
  const { storeId, date, format = 'json' } = req.query;
  let shifts = db.getShifts();
  shifts = filterShiftsByStore(shifts, req.session.user);
  if (storeId) shifts = shifts.filter(s => s.storeId === storeId);
  if (date) shifts = shifts.filter(s => s.shiftDate === date);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const data = shifts.map(s => ({
    id: s.id,
    storeName: storeMap[s.storeId] || s.storeId,
    shiftType: s.shiftType,
    shiftDate: s.shiftDate,
    handoverStaffName: s.handoverStaffName,
    receiveStaffName: s.receiveStaffName,
    status: s.status,
    note: s.note,
    reviewNote: s.reviewNote || '',
    reviewedByName: s.reviewedByName || '',
    createdAt: s.createdAt,
    confirmedAt: s.confirmedAt || '',
    closedAt: s.closedAt || ''
  }));

  const headers = [
    { key: 'id', label: '班次ID' },
    { key: 'storeName', label: '门店' },
    { key: 'shiftType', label: '班次类型' },
    { key: 'shiftDate', label: '日期' },
    { key: 'handoverStaffName', label: '交班人' },
    { key: 'receiveStaffName', label: '接班人' },
    { key: 'status', label: '状态' },
    { key: 'note', label: '备注' },
    { key: 'reviewNote', label: '复核意见' },
    { key: 'reviewedByName', label: '复核人' },
    { key: 'createdAt', label: '创建时间' },
    { key: 'confirmedAt', label: '确认时间' },
    { key: 'closedAt', label: '关闭时间' }
  ];
  if (format === 'csv') {
    const csv = jsonToCSV(data, headers);
    sendCSV(res, csv, 'shifts');
  } else {
    sendJSON(res, { shifts: data }, 'shifts');
  }
});

router.get('/exceptions', requireAuth, (req, res) => {
  const { storeId, date, format = 'json' } = req.query;
  let exceptions = db.getExceptions();
  let shifts = db.getShifts();
  shifts = filterShiftsByStore(shifts, req.session.user);
  if (storeId) shifts = shifts.filter(s => s.storeId === storeId);
  const shiftIds = new Set(shifts.map(s => s.id));
  exceptions = exceptions.filter(e => shiftIds.has(e.shiftId));
  if (date) {
    const dShifts = new Set(shifts.filter(s => s.shiftDate === date).map(s => s.id));
    exceptions = exceptions.filter(e => dShifts.has(e.shiftId));
  }
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const shiftMap = Object.fromEntries(shifts.map(s => [s.id, s]));
  const data = exceptions.map(e => {
    const sh = shiftMap[e.shiftId] || {};
    return {
      id: e.id,
      shiftId: e.shiftId,
      storeName: storeMap[sh.storeId] || '',
      shiftDate: sh.shiftDate || '',
      shiftType: sh.shiftType || '',
      type: e.type === 'cash' ? '现金差额' : '库存短缺',
      itemName: e.itemName,
      amount: e.amount,
      description: e.description,
      responsibleStaffName: e.responsibleStaffName,
      status: e.status,
      note: e.note,
      createdByName: e.createdByName,
      handleNote: e.handleNote || '',
      handledByName: e.handledByName || '',
      closeNote: e.closeNote || '',
      closedByName: e.closedByName || '',
      createdAt: e.createdAt,
      closedAt: e.closedAt || ''
    };
  });
  const headers = [
    { key: 'id', label: '异常ID' },
    { key: 'shiftId', label: '班次ID' },
    { key: 'storeName', label: '门店' },
    { key: 'shiftDate', label: '日期' },
    { key: 'shiftType', label: '班次' },
    { key: 'type', label: '类型' },
    { key: 'itemName', label: '品项' },
    { key: 'amount', label: '金额/数量' },
    { key: 'description', label: '描述' },
    { key: 'responsibleStaffName', label: '责任人' },
    { key: 'status', label: '状态' },
    { key: 'note', label: '备注' },
    { key: 'createdByName', label: '登记人' },
    { key: 'handleNote', label: '处理说明' },
    { key: 'handledByName', label: '处理人' },
    { key: 'closeNote', label: '关闭说明' },
    { key: 'closedByName', label: '关闭人' },
    { key: 'createdAt', label: '创建时间' },
    { key: 'closedAt', label: '关闭时间' }
  ];
  if (format === 'csv') {
    const csv = jsonToCSV(data, headers);
    sendCSV(res, csv, 'exceptions');
  } else {
    sendJSON(res, { exceptions: data }, 'exceptions');
  }
});

router.get('/tasks', requireAuth, (req, res) => {
  const { storeId, status, format = 'json' } = req.query;
  let tasks = db.getTasks();
  tasks = filterTasksByStore(tasks, req.session.user);
  if (storeId) tasks = tasks.filter(t => t.storeId === storeId);
  if (status) tasks = tasks.filter(t => t.status === status);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const data = tasks.map(t => ({
    id: t.id,
    exceptionId: t.exceptionId,
    shiftId: t.shiftId,
    storeName: storeMap[t.storeId] || t.storeId,
    title: t.title,
    description: t.description,
    assigneeName: t.assigneeName,
    deadline: t.deadline,
    steps: t.steps,
    attachmentNote: t.attachmentNote,
    status: STATUS_LABELS.task[t.status] || t.status,
    createdByName: t.createdByName,
    assignedByName: t.assignedByName || '',
    submittedByName: t.submittedByName || '',
    rejectedByName: t.rejectedByName || '',
    closedByName: t.closedByName || '',
    submitNote: t.submitNote || '',
    rejectNote: t.rejectNote || '',
    closeNote: t.closeNote || '',
    createdAt: t.createdAt,
    assignedAt: t.assignedAt || '',
    submittedAt: t.submittedAt || '',
    closedAt: t.closedAt || ''
  }));
  const headers = [
    { key: 'id', label: '任务ID' },
    { key: 'exceptionId', label: '异常ID' },
    { key: 'shiftId', label: '班次ID' },
    { key: 'storeName', label: '门店' },
    { key: 'title', label: '标题' },
    { key: 'description', label: '描述' },
    { key: 'assigneeName', label: '责任人' },
    { key: 'deadline', label: '截止时间' },
    { key: 'steps', label: '处理步骤' },
    { key: 'attachmentNote', label: '附件说明' },
    { key: 'status', label: '状态' },
    { key: 'createdByName', label: '发起人' },
    { key: 'assignedByName', label: '分派人' },
    { key: 'submittedByName', label: '提交人' },
    { key: 'rejectedByName', label: '驳回人' },
    { key: 'closedByName', label: '关闭人' },
    { key: 'submitNote', label: '提交说明' },
    { key: 'rejectNote', label: '驳回原因' },
    { key: 'closeNote', label: '关闭说明' },
    { key: 'createdAt', label: '创建时间' },
    { key: 'assignedAt', label: '分派时间' },
    { key: 'submittedAt', label: '提交时间' },
    { key: 'closedAt', label: '关闭时间' }
  ];
  if (format === 'csv') {
    const csv = jsonToCSV(data, headers);
    sendCSV(res, csv, 'tasks');
  } else {
    sendJSON(res, { tasks: data }, 'tasks');
  }
});

router.get('/devices', requireAuth, (req, res) => {
  const { storeId, status, format = 'json' } = req.query;
  let devices = db.getDevices();
  devices = filterDevicesByStore(devices, req.session.user);
  if (storeId) devices = devices.filter(d => d.storeId === storeId);
  if (status) devices = devices.filter(d => d.status === status);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const data = devices.map(d => ({
    id: d.id,
    code: d.code,
    name: d.name,
    storeName: storeMap[d.storeId] || d.storeId,
    category: d.category,
    model: d.model,
    location: d.location,
    purchaseDate: d.purchaseDate,
    lastMaintenanceDate: d.lastMaintenanceDate,
    status: STATUS_LABELS.device[d.status] || d.status,
    note: d.note,
    createdByName: d.createdByName,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  }));
  const headers = [
    { key: 'id', label: '设备ID' },
    { key: 'code', label: '设备编号' },
    { key: 'name', label: '设备名称' },
    { key: 'storeName', label: '门店' },
    { key: 'category', label: '分类' },
    { key: 'model', label: '型号' },
    { key: 'location', label: '位置' },
    { key: 'purchaseDate', label: '购买日期' },
    { key: 'lastMaintenanceDate', label: '上次维护日期' },
    { key: 'status', label: '状态' },
    { key: 'note', label: '备注' },
    { key: 'createdByName', label: '创建人' },
    { key: 'createdAt', label: '创建时间' },
    { key: 'updatedAt', label: '更新时间' }
  ];
  if (format === 'csv') {
    const csv = jsonToCSV(data, headers);
    sendCSV(res, csv, 'devices');
  } else {
    sendJSON(res, { devices: data }, 'devices');
  }
});

router.get('/inspections', requireAuth, (req, res) => {
  const { storeId, status, format = 'json' } = req.query;
  let inspections = db.getInspections();
  inspections = filterInspectionsByStore(inspections, req.session.user);
  if (storeId) inspections = inspections.filter(i => i.storeId === storeId);
  if (status) inspections = inspections.filter(i => i.status === status);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const data = inspections.map(i => ({
    id: i.id,
    storeName: storeMap[i.storeId] || i.storeId,
    shiftId: i.shiftId,
    shiftType: i.shiftType,
    shiftDate: i.shiftDate,
    templateName: i.templateName,
    inspectionDate: i.inspectionDate,
    inspectorName: i.inspectorName,
    status: STATUS_LABELS.inspection[i.status] || i.status,
    itemCount: i.items.length,
    abnormalCount: i.items.filter(it => it.result === 'abnormal').length,
    createdAt: i.createdAt,
    submittedAt: i.submittedAt || ''
  }));
  const headers = [
    { key: 'id', label: '巡检单ID' },
    { key: 'storeName', label: '门店' },
    { key: 'shiftId', label: '班次ID' },
    { key: 'shiftType', label: '班次类型' },
    { key: 'shiftDate', label: '班次日期' },
    { key: 'templateName', label: '巡检模板' },
    { key: 'inspectionDate', label: '巡检日期' },
    { key: 'inspectorName', label: '巡检人' },
    { key: 'status', label: '状态' },
    { key: 'itemCount', label: '巡检项数' },
    { key: 'abnormalCount', label: '异常项数' },
    { key: 'createdAt', label: '创建时间' },
    { key: 'submittedAt', label: '提交时间' }
  ];
  if (format === 'csv') {
    const csv = jsonToCSV(data, headers);
    sendCSV(res, csv, 'inspections');
  } else {
    sendJSON(res, { inspections: data }, 'inspections');
  }
});

router.get('/repair-orders', requireAuth, (req, res) => {
  const { storeId, status, format = 'json' } = req.query;
  let orders = db.getRepairOrders();
  orders = filterRepairOrdersByStore(orders, req.session.user);
  if (storeId) orders = orders.filter(o => o.storeId === storeId);
  if (status) orders = orders.filter(o => o.status === status);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const data = orders.map(o => ({
    id: o.id,
    storeName: storeMap[o.storeId] || o.storeId,
    deviceCode: o.deviceCode,
    deviceName: o.deviceName,
    deviceLocation: o.deviceLocation,
    title: o.title,
    description: o.description,
    status: STATUS_LABELS.repair[o.status] || o.status,
    assigneeName: o.assigneeName || '未分派',
    createdByName: o.createdByName,
    completedNote: o.completedNote || '',
    completedByName: o.completedByName || '',
    verifiedNote: o.verifiedNote || '',
    verifiedByName: o.verifiedByName || '',
    rejectedNote: o.rejectedNote || '',
    rejectedByName: o.rejectedByName || '',
    createdAt: o.createdAt,
    acceptedAt: o.acceptedAt || '',
    completedAt: o.completedAt || '',
    verifiedAt: o.verifiedAt || '',
    rejectedAt: o.rejectedAt || ''
  }));
  const headers = [
    { key: 'id', label: '维修单ID' },
    { key: 'storeName', label: '门店' },
    { key: 'deviceCode', label: '设备编号' },
    { key: 'deviceName', label: '设备名称' },
    { key: 'deviceLocation', label: '设备位置' },
    { key: 'title', label: '标题' },
    { key: 'description', label: '描述' },
    { key: 'status', label: '状态' },
    { key: 'assigneeName', label: '接修人' },
    { key: 'createdByName', label: '报修人' },
    { key: 'completedNote', label: '完成说明' },
    { key: 'completedByName', label: '完成人' },
    { key: 'verifiedNote', label: '验收说明' },
    { key: 'verifiedByName', label: '验收人' },
    { key: 'rejectedNote', label: '退回原因' },
    { key: 'rejectedByName', label: '退回人' },
    { key: 'createdAt', label: '报修时间' },
    { key: 'acceptedAt', label: '接单时间' },
    { key: 'completedAt', label: '完成时间' },
    { key: 'verifiedAt', label: '验收时间' },
    { key: 'rejectedAt', label: '退回时间' }
  ];
  if (format === 'csv') {
    const csv = jsonToCSV(data, headers);
    sendCSV(res, csv, 'repair_orders');
  } else {
    sendJSON(res, { repairOrders: data }, 'repair_orders');
  }
});

module.exports = router;
