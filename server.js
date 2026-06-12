const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const db = require('./server/store');

const app = express();
const PORT = process.env.PORT || 3000;

const SHIFT_STATUS = {
  DRAFT: 'draft',
  HANDED_OVER: 'handed_over',
  CONFIRMED: 'confirmed',
  REVIEWING: 'reviewing',
  CLOSED: 'closed',
  RETURNED: 'returned'
};

const EXCEPTION_STATUS = {
  OPEN: 'open',
  HANDLED: 'handled',
  CLOSED: 'closed'
};

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'store-shift-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  next();
}

function requireManager(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: '未登录' });
  if (req.session.user.role !== 'manager') {
    return res.status(403).json({ error: '权限不足：仅店长可执行此操作' });
  }
  next();
}

function sameStoreOrManager(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: '未登录' });
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.findUserByUsername(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const { password: _, ...safeUser } = user;
  req.session.user = safeUser;
  res.json({ user: safeUser });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get('/api/config/stores', requireAuth, (req, res) => {
  res.json({ stores: db.getStores() });
});

app.get('/api/config/checklist', requireAuth, (req, res) => {
  res.json({ checklist: db.getChecklist() });
});

app.get('/api/config/users', requireAuth, (req, res) => {
  const users = db.getUsers().map(u => {
    const { password, ...safe } = u;
    return safe;
  });
  if (req.session.user.role === 'staff') {
    res.json({ users: users.filter(u => u.storeId === req.session.user.storeId) });
  } else {
    res.json({ users });
  }
});

app.get('/api/shifts', requireAuth, (req, res) => {
  const { storeId, date, status } = req.query;
  let shifts = db.getShifts();
  if (req.session.user.role === 'staff') {
    shifts = shifts.filter(s => s.storeId === req.session.user.storeId);
  }
  if (storeId) shifts = shifts.filter(s => s.storeId === storeId);
  if (date) {
    shifts = shifts.filter(s => s.shiftDate === date);
  }
  if (status) shifts = shifts.filter(s => s.status === status);
  shifts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ shifts });
});

app.get('/api/shifts/:id', requireAuth, (req, res) => {
  const shift = db.getShifts().find(s => s.id === req.params.id);
  if (!shift) return res.status(404).json({ error: '班次不存在' });
  const exceptions = db.getExceptions().filter(e => e.shiftId === shift.id);
  res.json({ shift, exceptions });
});

app.post('/api/shifts', requireAuth, (req, res) => {
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

app.post('/api/shifts/:id/handover', requireAuth, (req, res) => {
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

app.post('/api/shifts/:id/confirm', requireAuth, (req, res) => {
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

app.post('/api/shifts/:id/submit-review', requireAuth, (req, res) => {
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

app.post('/api/shifts/:id/close', requireManager, (req, res) => {
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
  if (req.session.user.role === 'manager' && shift.storeId !== req.session.user.storeId) {
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

app.post('/api/shifts/:id/return', requireManager, (req, res) => {
  const { reviewNote } = req.body;
  const shifts = db.getShifts();
  const idx = shifts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '班次不存在' });
  const shift = shifts[idx];
  if (shift.status !== SHIFT_STATUS.REVIEWING && shift.status !== SHIFT_STATUS.CONFIRMED) {
    return res.status(400).json({ error: `当前状态 [${shift.status}] 不可退回` });
  }
  if (req.session.user.role === 'manager' && shift.storeId !== req.session.user.storeId) {
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

app.get('/api/exceptions', requireAuth, (req, res) => {
  const { shiftId, status } = req.query;
  let exceptions = db.getExceptions();
  if (req.session.user.role === 'staff') {
    const myShifts = db.getShifts().filter(s => s.storeId === req.session.user.storeId).map(s => s.id);
    exceptions = exceptions.filter(e => myShifts.includes(e.shiftId));
  }
  if (shiftId) exceptions = exceptions.filter(e => e.shiftId === shiftId);
  if (status) exceptions = exceptions.filter(e => e.status === status);
  exceptions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ exceptions });
});

app.post('/api/exceptions', requireAuth, (req, res) => {
  const { shiftId, type, amount, itemName, description, responsibleStaffId, note } = req.body;
  const shifts = db.getShifts();
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return res.status(404).json({ error: '班次不存在' });
  if (shift.status === SHIFT_STATUS.CLOSED) {
    return res.status(400).json({ error: '班次已关闭，不可新增异常' });
  }
  if (req.session.user.role === 'staff' && shift.storeId !== req.session.user.storeId) {
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

app.post('/api/exceptions/:id/handle', requireAuth, (req, res) => {
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

app.post('/api/exceptions/:id/close', requireManager, (req, res) => {
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
  if (shift && req.session.user.role === 'manager' && shift.storeId !== req.session.user.storeId) {
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

app.get('/api/history', requireAuth, (req, res) => {
  const { shiftId } = req.query;
  let history = db.getHistory();
  if (shiftId) history = history.filter(h => h.shiftId === shiftId);
  history.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  res.json({ history });
});

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

app.get('/api/export/shifts', requireAuth, (req, res) => {
  const { storeId, date, format = 'json' } = req.query;
  let shifts = db.getShifts();
  if (req.session.user.role === 'staff') {
    shifts = shifts.filter(s => s.storeId === req.session.user.storeId);
  }
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

  if (format === 'csv') {
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
    const csv = '\uFEFF' + jsonToCSV(data, headers);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shifts_${Date.now()}.csv"`);
    return res.send(csv);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="shifts_${Date.now()}.json"`);
  res.json({ shifts: data });
});

app.get('/api/export/exceptions', requireAuth, (req, res) => {
  const { storeId, date, format = 'json' } = req.query;
  let exceptions = db.getExceptions();
  let shifts = db.getShifts();
  if (req.session.user.role === 'staff') {
    shifts = shifts.filter(s => s.storeId === req.session.user.storeId);
  }
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
  if (format === 'csv') {
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
    const csv = '\uFEFF' + jsonToCSV(data, headers);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="exceptions_${Date.now()}.csv"`);
    return res.send(csv);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="exceptions_${Date.now()}.json"`);
  res.json({ exceptions: data });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  门店交接班异常追踪系统启动成功`);
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`========================================\n`);
  console.log(`样例账号：`);
  console.log(`  店长张店长： manager1 / manager123  (朝阳店)`);
  console.log(`  店长李店长： manager2 / manager123  (海淀店)`);
  console.log(`  员工王早班： staff1   / staff123    (朝阳店)`);
  console.log(`  员工赵中班： staff2   / staff123    (朝阳店)`);
  console.log(`  员工孙晚班： staff3   / staff123    (朝阳店)`);
  console.log(``);
});
