const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth, requireManager } = require('../middleware/auth');
const { filterShiftsByStore } = require('../middleware/store');
const { SHIFT_STATUS, EXCEPTION_STATUS } = require('../constants/status');

router.get('/', requireAuth, (req, res) => {
  const { storeId, date, status } = req.query;
  let shifts = db.getShifts();
  shifts = filterShiftsByStore(shifts, req.session.user);
  if (storeId) shifts = shifts.filter(s => s.storeId === storeId);
  if (date) shifts = shifts.filter(s => s.shiftDate === date);
  if (status) shifts = shifts.filter(s => s.status === status);
  shifts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ shifts });
});

router.get('/:id', requireAuth, (req, res) => {
  const shift = db.getShifts().find(s => s.id === req.params.id);
  if (!shift) return res.status(404).json({ error: '班次不存在' });
  if (shift.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店班次' });
  }
  const exceptions = db.getExceptions().filter(e => e.shiftId === shift.id);
  res.json({ shift, exceptions });
});

router.post('/', requireAuth, (req, res) => {
  const { storeId, shiftType, shiftDate, handoverStaffId, receiveStaffId, checklistItems, note } = req.body;
  const stores = db.getStores();
  if (!stores.find(s => s.id === storeId)) {
    return res.status(400).json({ error: '门店不存在' });
  }
  if (req.session.user.role === 'staff' && storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅可创建本门店班次' });
  }
  const users = db.getUsers();
  const handoverStaff = users.find(u => u.id === handoverStaffId);
  const receiveStaff = users.find(u => u.id === receiveStaffId);
  if (!handoverStaff || !receiveStaff) {
    return res.status(400).json({ error: '交班人或接班人不存在' });
  }
  if (handoverStaffId === receiveStaffId) {
    return res.status(400).json({ error: '交班人与接班人不能为同一人' });
  }
  const configChecklist = db.getChecklist();
  const validatedItems = (checklistItems || []).map(item => {
    const cfg = configChecklist.find(c => c.id === item.id);
    return {
      id: item.id,
      name: cfg ? cfg.name : item.id,
      category: cfg ? cfg.category : '',
      checked: !!item.checked,
      remark: item.remark || ''
    };
  });

  const shift = {
    id: db.genId('SH'),
    storeId,
    shiftType: shiftType || '日班',
    shiftDate: shiftDate || new Date().toISOString().slice(0, 10),
    handoverStaffId,
    handoverStaffName: handoverStaff.name,
    receiveStaffId,
    receiveStaffName: receiveStaff.name,
    checklistItems: validatedItems,
    note: note || '',
    status: SHIFT_STATUS.DRAFT,
    createdAt: new Date().toISOString(),
    createdBy: req.session.user.id,
    confirmedAt: null,
    reviewedAt: null,
    closedAt: null,
    reviewNote: '',
    reviewedBy: null,
    reviewedByName: ''
  };

  const shifts = db.getShifts();
  shifts.push(shift);
  db.saveShifts(shifts);
  db.addHistory({
    action: 'CREATE_SHIFT',
    shiftId: shift.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `创建班次 ${shift.id}`
  });
  res.json({ shift });
});

router.post('/:id/handover', requireAuth, (req, res) => {
  const shifts = db.getShifts();
  const idx = shifts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '班次不存在' });
  const shift = shifts[idx];
  if (shift.status !== SHIFT_STATUS.DRAFT) {
    return res.status(400).json({ error: `当前状态 [${shift.status}] 不可提交交接，仅草稿状态可提交` });
  }
  if (req.session.user.id !== shift.handoverStaffId && req.session.user.role !== 'manager') {
    return res.status(403).json({ error: '仅交班人或店长可提交交接' });
  }
  shift.status = SHIFT_STATUS.HANDED_OVER;
  shifts[idx] = shift;
  db.saveShifts(shifts);
  db.addHistory({
    action: 'HANDOVER_SHIFT',
    shiftId: shift.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `提交交接，状态变为待确认`
  });
  res.json({ shift });
});

router.post('/:id/confirm', requireAuth, (req, res) => {
  const shifts = db.getShifts();
  const idx = shifts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '班次不存在' });
  const shift = shifts[idx];
  if (shift.status === SHIFT_STATUS.CONFIRMED || shift.status === SHIFT_STATUS.REVIEWING || shift.status === SHIFT_STATUS.CLOSED) {
    return res.status(400).json({ error: `班次已确认（当前状态：${shift.status}），不可重复确认` });
  }
  if (shift.status !== SHIFT_STATUS.HANDED_OVER && shift.status !== SHIFT_STATUS.RETURNED) {
    return res.status(400).json({ error: `当前状态 [${shift.status}] 不可确认，仅待交接或已退回状态可确认` });
  }
  if (req.session.user.id !== shift.receiveStaffId) {
    return res.status(403).json({ error: '仅接班人可执行确认操作' });
  }
  shift.status = SHIFT_STATUS.CONFIRMED;
  shift.confirmedAt = new Date().toISOString();
  shifts[idx] = shift;
  db.saveShifts(shifts);
  db.addHistory({
    action: 'CONFIRM_SHIFT',
    shiftId: shift.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `接班人确认交接完成`
  });
  res.json({ shift });
});

router.post('/:id/submit-review', requireAuth, (req, res) => {
  const shifts = db.getShifts();
  const idx = shifts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '班次不存在' });
  const shift = shifts[idx];
  if (shift.status !== SHIFT_STATUS.CONFIRMED && shift.status !== SHIFT_STATUS.REVIEWING) {
    return res.status(400).json({ error: `当前状态 [${shift.status}] 不可提交复核，需先确认交接` });
  }
  shift.status = SHIFT_STATUS.REVIEWING;
  shifts[idx] = shift;
  db.saveShifts(shifts);
  db.addHistory({
    action: 'SUBMIT_REVIEW',
    shiftId: shift.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `提交店长复核`
  });
  res.json({ shift });
});

router.post('/:id/close', requireManager, (req, res) => {
  const { reviewNote } = req.body;
  const shifts = db.getShifts();
  const idx = shifts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '班次不存在' });
  const shift = shifts[idx];
  if (shift.status !== SHIFT_STATUS.REVIEWING && shift.status !== SHIFT_STATUS.CONFIRMED) {
    return res.status(400).json({ error: `当前状态 [${shift.status}] 不可关闭，需先提交复核` });
  }
  const exceptions = db.getExceptions().filter(e => e.shiftId === shift.id);
  const unresolved = exceptions.filter(e => e.status !== EXCEPTION_STATUS.CLOSED);
  if (unresolved.length > 0) {
    return res.status(400).json({
      error: `存在 ${unresolved.length} 条未关闭异常，需先处理后再关闭班次`,
      unresolvedCount: unresolved.length
    });
  }
  if (shift.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可关闭班次' });
  }
  shift.status = SHIFT_STATUS.CLOSED;
  shift.reviewedAt = new Date().toISOString();
  shift.closedAt = new Date().toISOString();
  shift.reviewNote = reviewNote || '';
  shift.reviewedBy = req.session.user.id;
  shift.reviewedByName = req.session.user.name;
  shifts[idx] = shift;
  db.saveShifts(shifts);
  db.addHistory({
    action: 'CLOSE_SHIFT',
    shiftId: shift.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `店长关闭班次，复核意见：${reviewNote || '无'}`
  });
  res.json({ shift });
});

router.post('/:id/return', requireManager, (req, res) => {
  const { reviewNote } = req.body;
  const shifts = db.getShifts();
  const idx = shifts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '班次不存在' });
  const shift = shifts[idx];
  if (shift.status !== SHIFT_STATUS.REVIEWING && shift.status !== SHIFT_STATUS.CONFIRMED) {
    return res.status(400).json({ error: `当前状态 [${shift.status}] 不可退回` });
  }
  if (shift.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可退回班次' });
  }
  shift.status = SHIFT_STATUS.RETURNED;
  shift.reviewedAt = new Date().toISOString();
  shift.reviewNote = reviewNote || '';
  shift.reviewedBy = req.session.user.id;
  shift.reviewedByName = req.session.user.name;
  shifts[idx] = shift;
  db.saveShifts(shifts);
  db.addHistory({
    action: 'RETURN_SHIFT',
    shiftId: shift.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `店长退回班次，退回原因：${reviewNote || '无'}`
  });
  res.json({ shift });
});

module.exports = router;
