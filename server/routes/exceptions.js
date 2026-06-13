const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth, requireManager } = require('../middleware/auth');
const { filterExceptionsByStore } = require('../middleware/store');
const { EXCEPTION_STATUS } = require('../constants/status');

router.get('/', requireAuth, (req, res) => {
  const { shiftId, status } = req.query;
  let exceptions = db.getExceptions();
  exceptions = filterExceptionsByStore(exceptions, req.session.user);
  if (shiftId) exceptions = exceptions.filter(e => e.shiftId === shiftId);
  if (status) exceptions = exceptions.filter(e => e.status === status);
  exceptions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ exceptions });
});

router.post('/', requireAuth, (req, res) => {
  const { shiftId, type, amount, itemName, description, responsibleStaffId, note } = req.body;
  const shifts = db.getShifts();
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return res.status(404).json({ error: '班次不存在' });
  if (shift.status === 'closed') {
    return res.status(400).json({ error: '班次已关闭，不可新增异常' });
  }
  if (shift.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅可为本门店班次登记异常' });
  }
  const users = db.getUsers();
  const resp = users.find(u => u.id === responsibleStaffId);
  const ex = {
    id: db.genId('EX'),
    shiftId,
    type: type || 'cash',
    amount: amount ? Number(amount) : 0,
    itemName: itemName || '',
    description: description || '',
    responsibleStaffId: responsibleStaffId || null,
    responsibleStaffName: resp ? resp.name : '',
    note: note || '',
    status: EXCEPTION_STATUS.OPEN,
    createdAt: new Date().toISOString(),
    createdBy: req.session.user.id,
    createdByName: req.session.user.name,
    handledAt: null,
    handledBy: null,
    handledByName: '',
    handleNote: '',
    closedAt: null,
    closedBy: null,
    closedByName: '',
    closeNote: ''
  };
  const exceptions = db.getExceptions();
  exceptions.push(ex);
  db.saveExceptions(exceptions);
  db.addHistory({
    action: 'CREATE_EXCEPTION',
    shiftId,
    exceptionId: ex.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `登记异常：${type === 'cash' ? '现金差额' : '库存短缺'} ${ex.itemName || ''} 金额 ${ex.amount}`
  });
  res.json({ exception: ex });
});

router.post('/:id/handle', requireAuth, (req, res) => {
  const { handleNote } = req.body;
  const exceptions = db.getExceptions();
  const idx = exceptions.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '异常不存在' });
  const ex = exceptions[idx];
  if (ex.status === EXCEPTION_STATUS.CLOSED) {
    return res.status(400).json({ error: '异常已关闭，不可重复处理' });
  }
  ex.status = EXCEPTION_STATUS.HANDLED;
  ex.handledAt = new Date().toISOString();
  ex.handledBy = req.session.user.id;
  ex.handledByName = req.session.user.name;
  ex.handleNote = handleNote || '';
  exceptions[idx] = ex;
  db.saveExceptions(exceptions);
  db.addHistory({
    action: 'HANDLE_EXCEPTION',
    shiftId: ex.shiftId,
    exceptionId: ex.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `处理异常：${handleNote || '无'}`
  });
  res.json({ exception: ex });
});

router.post('/:id/close', requireManager, (req, res) => {
  const { closeNote } = req.body;
  const exceptions = db.getExceptions();
  const idx = exceptions.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '异常不存在' });
  const ex = exceptions[idx];
  if (ex.status === EXCEPTION_STATUS.CLOSED) {
    return res.status(400).json({ error: '异常已关闭，不可重复关闭' });
  }
  if (ex.status === EXCEPTION_STATUS.OPEN) {
    return res.status(400).json({ error: '异常未处理，需先标记为已处理再关闭' });
  }
  const shift = db.getShifts().find(s => s.id === ex.shiftId);
  if (shift && shift.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可关闭异常' });
  }
  ex.status = EXCEPTION_STATUS.CLOSED;
  ex.closedAt = new Date().toISOString();
  ex.closedBy = req.session.user.id;
  ex.closedByName = req.session.user.name;
  ex.closeNote = closeNote || '';
  exceptions[idx] = ex;
  db.saveExceptions(exceptions);
  db.addHistory({
    action: 'CLOSE_EXCEPTION',
    shiftId: ex.shiftId,
    exceptionId: ex.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `关闭异常：${closeNote || '无'}`
  });
  res.json({ exception: ex });
});

module.exports = router;
