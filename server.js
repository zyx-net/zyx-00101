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
app.use((req, res, next) => {
  if (req.body && req.body._method) {
    req.method = req.body._method.toUpperCase();
    delete req.body._method;
  }
  if (req.query._method) {
    req.method = req.query._method.toUpperCase();
    delete req.query._method;
  }
  next();
});
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

const TASK_STATUS = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  SUBMITTED: 'submitted',
  REJECTED: 'rejected',
  CLOSED: 'closed'
};

function requireSameStore(task) {
  return function (user) {
    return task.storeId === user.storeId;
  };
}

app.get('/api/tasks', requireAuth, (req, res) => {
  const { storeId, status, assigneeId, mine } = req.query;
  let tasks = db.getTasks();
  if (req.session.user.role === 'staff') {
    tasks = tasks.filter(t => t.storeId === req.session.user.storeId);
  }
  if (storeId) tasks = tasks.filter(t => t.storeId === storeId);
  if (status) tasks = tasks.filter(t => t.status === status);
  if (assigneeId) tasks = tasks.filter(t => t.assigneeId === assigneeId);
  if (mine === '1') {
    tasks = tasks.filter(t =>
      (t.assigneeId === req.session.user.id && (t.status === TASK_STATUS.ASSIGNED || t.status === TASK_STATUS.REJECTED)) ||
      (req.session.user.role === 'manager' && t.storeId === req.session.user.storeId && t.status === TASK_STATUS.PENDING) ||
      (req.session.user.role === 'manager' && t.storeId === req.session.user.storeId && t.status === TASK_STATUS.SUBMITTED)
    );
  }
  tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ tasks });
});

app.get('/api/tasks/:id', requireAuth, (req, res) => {
  const task = db.getTasks().find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: '整改任务不存在' });
  if (task.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店整改任务' });
  }
  res.json({ task });
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const { exceptionId, title, assigneeId, deadline, steps, attachmentNote } = req.body;
  const exceptions = db.getExceptions();
  const ex = exceptions.find(e => e.id === exceptionId);
  if (!ex) return res.status(404).json({ error: '关联异常不存在' });
  const shift = db.getShifts().find(s => s.id === ex.shiftId);
  if (!shift) return res.status(404).json({ error: '关联班次不存在' });
  if (shift.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅可为本门店异常发起整改' });
  }
  const existing = db.getTasks().find(t => t.exceptionId === exceptionId && t.status !== TASK_STATUS.CLOSED && t.status !== TASK_STATUS.REJECTED);
  if (existing) {
    return res.status(409).json({ error: '该异常已有进行中的整改任务，不可重复创建' });
  }
  const users = db.getUsers();
  const assignee = users.find(u => u.id === assigneeId);
  if (!assignee) return res.status(400).json({ error: '责任人不存在' });
  if (assignee.storeId !== shift.storeId) {
    return res.status(400).json({ error: '责任人必须属于本门店' });
  }
  const now = new Date().toISOString();
  const task = {
    id: db.genId('RT'),
    exceptionId,
    shiftId: ex.shiftId,
    storeId: shift.storeId,
    title: title || ('整改: ' + (ex.type === 'cash' ? '现金差额' : '库存短缺') + ' ' + (ex.itemName || '')),
    description: ex.description || '',
    assigneeId,
    assigneeName: assignee.name,
    deadline: deadline || '',
    steps: steps || '',
    attachmentNote: attachmentNote || '',
    status: TASK_STATUS.PENDING,
    statusHistory: [
      { status: TASK_STATUS.PENDING, by: req.session.user.id, byName: req.session.user.name, at: now, note: '发起整改' }
    ],
    createdBy: req.session.user.id,
    createdByName: req.session.user.name,
    createdAt: now,
    updatedAt: now,
    assignedAt: null,
    assignedBy: null,
    assignedByName: '',
    submittedAt: null,
    submittedBy: null,
    submittedByName: '',
    submitNote: '',
    rejectedAt: null,
    rejectedBy: null,
    rejectedByName: '',
    rejectNote: '',
    closedAt: null,
    closedBy: null,
    closedByName: '',
    closeNote: ''
  };
  const tasks = db.getTasks();
  tasks.push(task);
  db.saveTasks(tasks);
  db.addHistory({
    action: 'CREATE_TASK',
    shiftId: ex.shiftId,
    exceptionId,
    taskId: task.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `发起整改任务 ${task.id}，责任人: ${assignee.name}`
  });
  res.json({ task });
});

app.post('/api/tasks/:id/assign', requireManager, (req, res) => {
  const { assigneeId, note } = req.body;
  const tasks = db.getTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '整改任务不存在' });
  const task = tasks[idx];
  if (task.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可分派整改任务' });
  }
  if (task.status !== TASK_STATUS.PENDING && task.status !== TASK_STATUS.REJECTED) {
    return res.status(400).json({ error: `当前状态 [${task.status}] 不可分派，仅待分派或已驳回状态可分派` });
  }
  const users = db.getUsers();
  let newAssigneeId = task.assigneeId;
  let newAssigneeName = task.assigneeName;
  if (assigneeId) {
    const assignee = users.find(u => u.id === assigneeId);
    if (!assignee) return res.status(400).json({ error: '责任人不存在' });
    if (assignee.storeId !== task.storeId) return res.status(400).json({ error: '责任人必须属于本门店' });
    newAssigneeId = assignee.id;
    newAssigneeName = assignee.name;
  }
  const now = new Date().toISOString();
  task.assigneeId = newAssigneeId;
  task.assigneeName = newAssigneeName;
  task.status = TASK_STATUS.ASSIGNED;
  task.assignedAt = now;
  task.assignedBy = req.session.user.id;
  task.assignedByName = req.session.user.name;
  task.updatedAt = now;
  task.statusHistory.push({ status: TASK_STATUS.ASSIGNED, by: req.session.user.id, byName: req.session.user.name, at: now, note: note || '分派整改任务' });
  tasks[idx] = task;
  db.saveTasks(tasks);
  db.addHistory({
    action: 'ASSIGN_TASK',
    shiftId: task.shiftId,
    taskId: task.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `分派整改任务 ${task.id} 给 ${newAssigneeName}`
  });
  res.json({ task });
});

app.post('/api/tasks/:id/submit', requireAuth, (req, res) => {
  const { submitNote, updatedAt } = req.body;
  const tasks = db.getTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '整改任务不存在' });
  const task = tasks[idx];
  if (task.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店人员可提交整改任务' });
  }
  if (task.assigneeId !== req.session.user.id && req.session.user.role !== 'manager') {
    return res.status(403).json({ error: '仅责任人或店长可提交整改任务' });
  }
  if (task.status !== TASK_STATUS.ASSIGNED && task.status !== TASK_STATUS.REJECTED) {
    return res.status(400).json({ error: `当前状态 [${task.status}] 不可提交，仅已分派或已驳回状态可提交` });
  }
  if (updatedAt && task.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '任务已被他人修改，请刷新后重试', currentUpdatedAt: task.updatedAt });
  }
  const now = new Date().toISOString();
  task.status = TASK_STATUS.SUBMITTED;
  task.submittedAt = now;
  task.submittedBy = req.session.user.id;
  task.submittedByName = req.session.user.name;
  task.submitNote = submitNote || '';
  task.updatedAt = now;
  task.statusHistory.push({ status: TASK_STATUS.SUBMITTED, by: req.session.user.id, byName: req.session.user.name, at: now, note: submitNote || '提交整改完成' });
  tasks[idx] = task;
  db.saveTasks(tasks);
  db.addHistory({
    action: 'SUBMIT_TASK',
    shiftId: task.shiftId,
    taskId: task.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `提交整改任务 ${task.id} 完成处理`
  });
  res.json({ task });
});

app.post('/api/tasks/:id/accept', requireManager, (req, res) => {
  const { closeNote, updatedAt } = req.body;
  const tasks = db.getTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '整改任务不存在' });
  const task = tasks[idx];
  if (task.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可验收整改任务' });
  }
  if (task.status !== TASK_STATUS.SUBMITTED) {
    return res.status(400).json({ error: `当前状态 [${task.status}] 不可验收，仅已提交状态可验收关闭` });
  }
  if (updatedAt && task.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '任务已被他人修改，请刷新后重试', currentUpdatedAt: task.updatedAt });
  }
  const now = new Date().toISOString();
  task.status = TASK_STATUS.CLOSED;
  task.closedAt = now;
  task.closedBy = req.session.user.id;
  task.closedByName = req.session.user.name;
  task.closeNote = closeNote || '';
  task.updatedAt = now;
  task.statusHistory.push({ status: TASK_STATUS.CLOSED, by: req.session.user.id, byName: req.session.user.name, at: now, note: closeNote || '验收关闭' });
  tasks[idx] = task;
  db.saveTasks(tasks);
  db.addHistory({
    action: 'ACCEPT_TASK',
    shiftId: task.shiftId,
    taskId: task.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `验收关闭整改任务 ${task.id}`
  });
  res.json({ task });
});

app.post('/api/tasks/:id/reject', requireManager, (req, res) => {
  const { rejectNote, updatedAt } = req.body;
  const tasks = db.getTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '整改任务不存在' });
  const task = tasks[idx];
  if (task.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可驳回整改任务' });
  }
  if (task.status !== TASK_STATUS.SUBMITTED && task.status !== TASK_STATUS.PENDING) {
    return res.status(400).json({ error: `当前状态 [${task.status}] 不可驳回` });
  }
  if (updatedAt && task.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '任务已被他人修改，请刷新后重试', currentUpdatedAt: task.updatedAt });
  }
  const now = new Date().toISOString();
  task.status = TASK_STATUS.REJECTED;
  task.rejectedAt = now;
  task.rejectedBy = req.session.user.id;
  task.rejectedByName = req.session.user.name;
  task.rejectNote = rejectNote || '';
  task.updatedAt = now;
  task.statusHistory.push({ status: TASK_STATUS.REJECTED, by: req.session.user.id, byName: req.session.user.name, at: now, note: rejectNote || '驳回' });
  tasks[idx] = task;
  db.saveTasks(tasks);
  db.addHistory({
    action: 'REJECT_TASK',
    shiftId: task.shiftId,
    taskId: task.id,
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: `驳回整改任务 ${task.id}：${rejectNote || '无'}`
  });
  res.json({ task });
});

const DEVICE_STATUS = {
  NORMAL: 'normal',
  FAULT: 'fault',
  MAINTENANCE: 'maintenance',
  SCRAPPED: 'scrapped'
};
const INSPECTION_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  CONVERTED: 'converted'
};
const REPAIR_STATUS = {
  REPORTED: 'reported',
  ACCEPTED: 'accepted',
  COMPLETED: 'completed',
  VERIFIED: 'verified',
  REJECTED: 'rejected'
};

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const parseLine = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { result.push(cur); cur = ''; }
        else { cur += ch; }
      }
    }
    result.push(cur);
    return result;
  };
  const headers = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  });
}

app.get('/api/devices', requireAuth, (req, res) => {
  const { storeId, status, keyword } = req.query;
  let devices = db.getDevices();
  if (req.session.user.role === 'staff') {
    devices = devices.filter(d => d.storeId === req.session.user.storeId);
  }
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

app.get('/api/devices/:id', requireAuth, (req, res) => {
  const device = db.getDevices().find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: '设备不存在' });
  if (device.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店设备' });
  }
  res.json({ device });
});

app.post('/api/devices', requireManager, (req, res) => {
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

app.put('/api/devices/:id', requireManager, (req, res) => {
  const devices = db.getDevices();
  const idx = devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '设备不存在' });
  const device = devices[idx];
  if (device.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可修改设备' });
  }
  const { updatedAt } = req.body;
  if (updatedAt && device.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '设备已被他人修改，请刷新后重试', currentUpdatedAt: device.updatedAt });
  }
  const fields = ['name', 'category', 'model', 'location', 'purchaseDate', 'lastMaintenanceDate', 'status', 'note'];
  fields.forEach(f => {
    if (req.body[f] !== undefined) device[f] = req.body[f] || '';
  });
  if (req.body.code && req.body.code !== device.code) {
    const conflict = devices.find(d => d.storeId === device.storeId && d.code === req.body.code && d.id !== device.id);
    if (conflict) {
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

app.delete('/api/devices/:id', requireManager, (req, res) => {
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

app.post('/api/devices/import/csv', requireManager, (req, res) => {
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

app.get('/api/inspection-templates', requireAuth, (req, res) => {
  const { storeId } = req.query;
  let templates = db.getInspectionTemplates();
  if (req.session.user.role === 'staff') {
    templates = templates.filter(t => t.storeId === req.session.user.storeId);
  }
  if (storeId) templates = templates.filter(t => t.storeId === storeId);
  templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ templates });
});

app.get('/api/inspection-templates/:id', requireAuth, (req, res) => {
  const tpl = db.getInspectionTemplates().find(t => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: '巡检模板不存在' });
  if (tpl.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店模板' });
  }
  res.json({ template: tpl });
});

app.post('/api/inspection-templates', requireManager, (req, res) => {
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

app.put('/api/inspection-templates/:id', requireManager, (req, res) => {
  const templates = db.getInspectionTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '巡检模板不存在' });
  const tpl = templates[idx];
  if (tpl.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可修改模板' });
  }
  const { updatedAt } = req.body;
  if (updatedAt && tpl.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '模板已被他人修改，请刷新后重试', currentUpdatedAt: tpl.updatedAt });
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

app.delete('/api/inspection-templates/:id', requireManager, (req, res) => {
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

app.get('/api/inspections', requireAuth, (req, res) => {
  const { storeId, shiftId, status, inspectorId, date } = req.query;
  let inspections = db.getInspections();
  if (req.session.user.role === 'staff') {
    inspections = inspections.filter(i => i.storeId === req.session.user.storeId);
  }
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

app.get('/api/inspections/:id', requireAuth, (req, res) => {
  const ins = db.getInspections().find(i => i.id === req.params.id);
  if (!ins) return res.status(404).json({ error: '巡检单不存在' });
  if (ins.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店巡检单' });
  }
  res.json({ inspection: ins });
});

app.post('/api/inspections', requireAuth, (req, res) => {
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

app.put('/api/inspections/:id', requireAuth, (req, res) => {
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
  if (updatedAt && ins.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '巡检单已被他人修改，请刷新后重试', currentUpdatedAt: ins.updatedAt });
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

app.post('/api/inspections/:id/convert-to-repair', requireAuth, (req, res) => {
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

app.get('/api/repair-orders', requireAuth, (req, res) => {
  const { storeId, status, assigneeId, mine, deviceId } = req.query;
  let orders = db.getRepairOrders();
  if (req.session.user.role === 'staff') {
    orders = orders.filter(o => o.storeId === req.session.user.storeId);
  }
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

app.get('/api/repair-orders/:id', requireAuth, (req, res) => {
  const order = db.getRepairOrders().find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: '维修单不存在' });
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店维修单' });
  }
  res.json({ repairOrder: order });
});

app.post('/api/repair-orders/:id/assign', requireManager, (req, res) => {
  const { assigneeId, note, updatedAt } = req.body;
  const orders = db.getRepairOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '维修单不存在' });
  const order = orders[idx];
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可分派维修单' });
  }
  if (updatedAt && order.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '维修单已被他人修改，请刷新后重试', currentUpdatedAt: order.updatedAt });
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

app.post('/api/repair-orders/:id/complete', requireAuth, (req, res) => {
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
  if (updatedAt && order.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '维修单已被他人修改，请刷新后重试', currentUpdatedAt: order.updatedAt });
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

app.post('/api/repair-orders/:id/verify', requireManager, (req, res) => {
  const { verifiedNote, updatedAt } = req.body;
  const orders = db.getRepairOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '维修单不存在' });
  const order = orders[idx];
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可验收维修单' });
  }
  if (updatedAt && order.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '维修单已被他人修改，请刷新后重试', currentUpdatedAt: order.updatedAt });
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

app.post('/api/repair-orders/:id/reject', requireManager, (req, res) => {
  const { rejectedNote, updatedAt } = req.body;
  const orders = db.getRepairOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '维修单不存在' });
  const order = orders[idx];
  if (order.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可退回维修单' });
  }
  if (updatedAt && order.updatedAt !== updatedAt) {
    return res.status(409).json({ error: '维修单已被他人修改，请刷新后重试', currentUpdatedAt: order.updatedAt });
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

app.get('/api/export/devices', requireAuth, (req, res) => {
  const { storeId, status, format = 'json' } = req.query;
  let devices = db.getDevices();
  if (req.session.user.role === 'staff') {
    devices = devices.filter(d => d.storeId === req.session.user.storeId);
  }
  if (storeId) devices = devices.filter(d => d.storeId === storeId);
  if (status) devices = devices.filter(d => d.status === status);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const statusMap = { normal: '正常', fault: '故障', maintenance: '维护中', scrapped: '已报废' };
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
    status: statusMap[d.status] || d.status,
    note: d.note,
    createdByName: d.createdByName,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  }));
  if (format === 'csv') {
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
    const csv = '\uFEFF' + jsonToCSV(data, headers);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="devices_' + Date.now() + '.csv"');
    return res.send(csv);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="devices_' + Date.now() + '.json"');
  res.json({ devices: data });
});

app.get('/api/export/inspections', requireAuth, (req, res) => {
  const { storeId, status, format = 'json' } = req.query;
  let inspections = db.getInspections();
  if (req.session.user.role === 'staff') {
    inspections = inspections.filter(i => i.storeId === req.session.user.storeId);
  }
  if (storeId) inspections = inspections.filter(i => i.storeId === storeId);
  if (status) inspections = inspections.filter(i => i.status === status);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const statusMap = { draft: '草稿', submitted: '已提交', converted: '已转维修' };
  const data = inspections.map(i => ({
    id: i.id,
    storeName: storeMap[i.storeId] || i.storeId,
    shiftId: i.shiftId,
    shiftType: i.shiftType,
    shiftDate: i.shiftDate,
    templateName: i.templateName,
    inspectionDate: i.inspectionDate,
    inspectorName: i.inspectorName,
    status: statusMap[i.status] || i.status,
    itemCount: i.items.length,
    abnormalCount: i.items.filter(it => it.result === 'abnormal').length,
    createdAt: i.createdAt,
    submittedAt: i.submittedAt || ''
  }));
  if (format === 'csv') {
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
    const csv = '\uFEFF' + jsonToCSV(data, headers);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inspections_' + Date.now() + '.csv"');
    return res.send(csv);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inspections_' + Date.now() + '.json"');
  res.json({ inspections: data });
});

app.get('/api/export/repair-orders', requireAuth, (req, res) => {
  const { storeId, status, format = 'json' } = req.query;
  let orders = db.getRepairOrders();
  if (req.session.user.role === 'staff') {
    orders = orders.filter(o => o.storeId === req.session.user.storeId);
  }
  if (storeId) orders = orders.filter(o => o.storeId === storeId);
  if (status) orders = orders.filter(o => o.status === status);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const statusMap = { reported: '已报修', accepted: '已接单', completed: '已完成', verified: '已验收', rejected: '已退回' };
  const data = orders.map(o => ({
    id: o.id,
    storeName: storeMap[o.storeId] || o.storeId,
    deviceCode: o.deviceCode,
    deviceName: o.deviceName,
    deviceLocation: o.deviceLocation,
    title: o.title,
    description: o.description,
    status: statusMap[o.status] || o.status,
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
  if (format === 'csv') {
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
    const csv = '\uFEFF' + jsonToCSV(data, headers);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="repair_orders_' + Date.now() + '.csv"');
    return res.send(csv);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="repair_orders_' + Date.now() + '.json"');
  res.json({ repairOrders: data });
});

app.get('/api/export/tasks', requireAuth, (req, res) => {
  const { storeId, status, format = 'json' } = req.query;
  let tasks = db.getTasks();
  if (req.session.user.role === 'staff') {
    tasks = tasks.filter(t => t.storeId === req.session.user.storeId);
  }
  if (storeId) tasks = tasks.filter(t => t.storeId === storeId);
  if (status) tasks = tasks.filter(t => t.status === status);
  const stores = db.getStores();
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]));
  const statusLabelMap = { pending: '待分派', assigned: '已分派', submitted: '已提交', rejected: '已驳回', closed: '已关闭' };
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
    status: statusLabelMap[t.status] || t.status,
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
  if (format === 'csv') {
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
    const csv = '\uFEFF' + jsonToCSV(data, headers);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tasks_${Date.now()}.csv"`);
    return res.send(csv);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tasks_${Date.now()}.json"`);
  res.json({ tasks: data });
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
