const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth, requireManager } = require('../middleware/auth');
const { filterInspectionsByStore, filterTemplatesByStore } = require('../middleware/store');
const { checkUpdatedAt } = require('../middleware/conflict');
const { DEVICE_STATUS, INSPECTION_STATUS, REPAIR_STATUS } = require('../constants/status');

router.get('/templates', requireAuth, (req, res) => {
  const { storeId } = req.query;
  let templates = db.getInspectionTemplates();
  templates = filterTemplatesByStore(templates, req.session.user);
  if (storeId) templates = templates.filter(t => t.storeId === storeId);
  templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ templates });
});

router.get('/templates/:id', requireAuth, (req, res) => {
  const tpl = db.getInspectionTemplates().find(t => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: '巡检模板不存在' });
  if (tpl.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店模板' });
  }
  res.json({ template: tpl });
});

router.post('/templates', requireManager, (req, res) => {
  const { name, description, items, storeId } = req.body;
  if (!name) return res.status(400).json({ error: '模板名称必填' });
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: '巡检项必填' });
  const targetStoreId = storeId || req.session.user.storeId;
  if (targetStoreId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可创建模板' });
  }
  const now = new Date().toISOString();
  const tpl = {
    id: db.genId('IT'),
    storeId: targetStoreId,
    name,
    description: description || '',
    items: items.map((it, i) => ({
      id: 'ITEM' + (i + 1),
      name: it.name || '',
      category: it.category || '',
      description: it.description || '',
      required: !!it.required,
      sort: i + 1
    })),
    createdAt: now,
    createdBy: req.session.user.id,
    createdByName: req.session.user.name,
    updatedAt: now
  };
  const templates = db.getInspectionTemplates();
  templates.push(tpl);
  db.saveInspectionTemplates(templates);
  db.addHistory({
    action: 'CREATE_TEMPLATE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '创建巡检模板 ' + name,
    storeId
  });
  res.json({ template: tpl });
});

router.put('/templates/:id', requireManager, (req, res) => {
  const templates = db.getInspectionTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '巡检模板不存在' });
  const tpl = templates[idx];
  if (tpl.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可修改模板' });
  }
  const { updatedAt } = req.body;
  const conflict = checkUpdatedAt(tpl, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
  }
  if (req.body.name !== undefined) tpl.name = req.body.name;
  if (req.body.description !== undefined) tpl.description = req.body.description;
  if (req.body.items !== undefined && Array.isArray(req.body.items)) {
    tpl.items = req.body.items.map((it, i) => ({
      id: it.id || ('ITEM' + (i + 1)),
      name: it.name || '',
      category: it.category || '',
      description: it.description || '',
      required: !!it.required,
      sort: i + 1
    }));
  }
  tpl.updatedAt = new Date().toISOString();
  templates[idx] = tpl;
  db.saveInspectionTemplates(templates);
  db.addHistory({
    action: 'UPDATE_TEMPLATE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '修改巡检模板 ' + tpl.name,
    storeId: tpl.storeId
  });
  res.json({ template: tpl });
});

router.delete('/templates/:id', requireManager, (req, res) => {
  const templates = db.getInspectionTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '巡检模板不存在' });
  const tpl = templates[idx];
  if (tpl.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可删除模板' });
  }
  templates.splice(idx, 1);
  db.saveInspectionTemplates(templates);
  db.addHistory({
    action: 'DELETE_TEMPLATE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '删除巡检模板 ' + tpl.name,
    storeId: tpl.storeId
  });
  res.json({ ok: true });
});

router.get('/', requireAuth, (req, res) => {
  const { storeId, shiftId, status, inspectorId, date } = req.query;
  let inspections = db.getInspections();
  inspections = filterInspectionsByStore(inspections, req.session.user);
  if (storeId) inspections = inspections.filter(i => i.storeId === storeId);
  if (shiftId) inspections = inspections.filter(i => i.shiftId === shiftId);
  if (status) inspections = inspections.filter(i => i.status === status);
  if (inspectorId) inspections = inspections.filter(i => i.inspectorId === inspectorId);
  if (date) {
    inspections = inspections.filter(i => i.inspectionDate === date);
  }
  inspections.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ inspections });
});

router.get('/:id', requireAuth, (req, res) => {
  const ins = db.getInspections().find(i => i.id === req.params.id);
  if (!ins) return res.status(404).json({ error: '巡检单不存在' });
  if (ins.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店巡检单' });
  }
  res.json({ inspection: ins });
});

router.post('/', requireAuth, (req, res) => {
  const { shiftId, templateId, inspectionDate, deviceIds } = req.body;
  if (!shiftId || !templateId) {
    return res.status(400).json({ error: '班次和巡检模板必填' });
  }
  const shift = db.getShifts().find(s => s.id === shiftId);
  if (!shift) return res.status(404).json({ error: '班次不存在' });
  if (shift.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅可为本门店班次创建巡检单' });
  }
  const tpl = db.getInspectionTemplates().find(t => t.id === templateId);
  if (!tpl) return res.status(404).json({ error: '巡检模板不存在' });
  let devices = db.getDevices().filter(d => d.storeId === shift.storeId && d.status !== DEVICE_STATUS.SCRAPPED);
  if (Array.isArray(deviceIds) && deviceIds.length > 0) {
    devices = devices.filter(d => deviceIds.includes(d.id));
  }
  if (devices.length === 0) {
    return res.status(400).json({ error: '没有可巡检的设备' });
  }
  const now = new Date().toISOString();
  const items = [];
  devices.forEach(d => {
    tpl.items.forEach(tp => {
      items.push({
        id: d.id + '_' + tp.id,
        deviceId: d.id,
        deviceCode: d.code,
        deviceName: d.name,
        deviceLocation: d.location,
        templateItemId: tp.id,
        templateItemName: tp.name,
        templateItemCategory: tp.category,
        templateItemDescription: tp.description,
        required: tp.required,
        result: null,
        attachmentNote: '',
        tempHandling: ''
      });
    });
  });
  const ins = {
    id: db.genId('IN'),
    storeId: shift.storeId,
    shiftId,
    shiftType: shift.shiftType,
    shiftDate: shift.shiftDate,
    templateId,
    templateName: tpl.name,
    inspectionDate: inspectionDate || new Date().toISOString().slice(0, 10),
    inspectorId: req.session.user.id,
    inspectorName: req.session.user.name,
    status: INSPECTION_STATUS.DRAFT,
    items,
    createdAt: now,
    createdBy: req.session.user.id,
    createdByName: req.session.user.name,
    updatedAt: now,
    submittedAt: null
  };
  const inspections = db.getInspections();
  inspections.push(ins);
  db.saveInspections(inspections);
  db.addHistory({
    action: 'CREATE_INSPECTION',
    shiftId,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '创建巡检单 ' + ins.id + '，模板 ' + tpl.name + '，设备 ' + devices.length + ' 台',
    storeId: shift.storeId
  });
  res.json({ inspection: ins });
});

router.put('/:id', requireAuth, (req, res) => {
  const inspections = db.getInspections();
  const idx = inspections.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '巡检单不存在' });
  const ins = inspections[idx];
  if (ins.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店人员可修改巡检单' });
  }
  if (req.session.user.role === 'staff' && ins.inspectorId !== req.session.user.id) {
    return res.status(403).json({ error: '仅巡检人或店长可修改巡检单' });
  }
  if (ins.status === INSPECTION_STATUS.CONVERTED) {
    return res.status(400).json({ error: '巡检单已转维修，不可修改' });
  }
  const { updatedAt, items, status } = req.body;
  const conflict = checkUpdatedAt(ins, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
  }
  if (Array.isArray(items)) {
    const itemMap = new Map(ins.items.map(it => [it.id, it]));
    items.forEach(uit => {
      itemMap.set(uit.id, { ...itemMap.get(uit.id), ...uit });
    });
    ins.items = Array.from(itemMap.values());
  }
  if (status === INSPECTION_STATUS.SUBMITTED) {
    if (ins.status !== INSPECTION_STATUS.DRAFT) {
      return res.status(400).json({ error: '仅草稿状态可提交' });
    }
    ins.status = INSPECTION_STATUS.SUBMITTED;
    ins.submittedAt = new Date().toISOString();
    db.addHistory({
      action: 'SUBMIT_INSPECTION',
      shiftId: ins.shiftId,
      userId: req.session.user.id,
      userName: req.session.user.name,
      detail: '提交巡检单 ' + ins.id,
      storeId: ins.storeId
    });
  }
  ins.updatedAt = new Date().toISOString();
  inspections[idx] = ins;
  db.saveInspections(inspections);
  res.json({ inspection: ins });
});

router.post('/:id/convert-to-repair', requireAuth, (req, res) => {
  const inspections = db.getInspections();
  const idx = inspections.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '巡检单不存在' });
  const ins = inspections[idx];
  if (ins.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店人员可转维修' });
  }
  if (ins.status !== INSPECTION_STATUS.SUBMITTED) {
    return res.status(400).json({ error: '仅已提交巡检单可转维修' });
  }
  const { itemIds } = req.body;
  const faultItems = ins.items.filter(it => {
    if (Array.isArray(itemIds) && itemIds.length > 0) {
      return itemIds.includes(it.id) && it.result === 'abnormal';
    }
    return it.result === 'abnormal';
  });
  if (faultItems.length === 0) {
    return res.status(400).json({ error: '没有异常项可转维修' });
  }
  const deviceIdsSet = new Set(faultItems.map(it => it.deviceId));
  const repairOrders = db.getRepairOrders();
  const now = new Date().toISOString();
  const createdOrders = [];
  for (const deviceId of deviceIdsSet) {
    const device = db.getDevices().find(d => d.id === deviceId);
    if (!device) continue;
    const deviceItems = faultItems.filter(it => it.deviceId === deviceId);
    const abnormalItems = deviceItems.map(it => ({
      templateItemId: it.templateItemId,
      templateItemName: it.templateItemName,
      templateItemCategory: it.templateItemCategory,
      templateItemDescription: it.templateItemDescription,
      attachmentNote: it.attachmentNote,
      tempHandling: it.tempHandling
    }));
    const order = {
      id: db.genId('RO'),
      storeId: ins.storeId,
      inspectionId: ins.id,
      shiftId: ins.shiftId,
      deviceId,
      deviceCode: device.code,
      deviceName: device.name,
      deviceCategory: device.category,
      deviceLocation: device.location,
      title: '维修：' + device.name + '（' + device.code + '）',
      abnormalItems,
      description: deviceItems.map(it => it.templateItemName + ': ' + (it.attachmentNote || it.tempHandling || '异常')).join('；'),
      status: REPAIR_STATUS.REPORTED,
      statusHistory: [{
        status: REPAIR_STATUS.REPORTED,
        by: req.session.user.id,
        byName: req.session.user.name,
        at: now,
        note: '巡检异常转报修'
      }],
      assigneeId: null,
      assigneeName: '',
      reportAttachmentNote: deviceItems.map(it => it.attachmentNote).filter(Boolean).join('；'),
      reportTempHandling: deviceItems.map(it => it.tempHandling).filter(Boolean).join('；'),
      createdAt: now,
      createdBy: req.session.user.id,
      createdByName: req.session.user.name,
      updatedAt: now,
      acceptedAt: null,
      acceptedBy: null,
      acceptedByName: '',
      completedAt: null,
      completedBy: null,
      completedByName: '',
      completedNote: '',
      verifiedAt: null,
      verifiedBy: null,
      verifiedByName: '',
      verifiedNote: '',
      rejectedAt: null,
      rejectedBy: null,
      rejectedByName: '',
      rejectedNote: ''
    };
    repairOrders.push(order);
    createdOrders.push(order);
    db.addHistory({
      action: 'CREATE_REPAIR',
      shiftId: ins.shiftId,
      inspectionId: ins.id,
      repairId: order.id,
      userId: req.session.user.id,
      userName: req.session.user.name,
      detail: '转报修单 ' + order.id + '：设备 ' + device.code + ' ' + device.name,
      storeId: ins.storeId
    });
  }
  const devices = db.getDevices();
  for (const deviceId of deviceIdsSet) {
    const dIdx = devices.findIndex(d => d.id === deviceId);
    if (dIdx !== -1) {
      devices[dIdx].status = DEVICE_STATUS.FAULT;
      devices[dIdx].updatedAt = now;
    }
  }
  db.saveDevices(devices);
  ins.status = INSPECTION_STATUS.CONVERTED;
  ins.updatedAt = now;
  inspections[idx] = ins;
  db.saveInspections(inspections);
  db.saveRepairOrders(repairOrders);
  res.json({ repairOrders: createdOrders, inspection: ins });
});

module.exports = router;
