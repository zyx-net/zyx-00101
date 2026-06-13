const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth, requireManager } = require('../middleware/auth');
const { filterTasksByStore } = require('../middleware/store');
const { checkUpdatedAt } = require('../middleware/conflict');
const { TASK_STATUS } = require('../constants/status');

router.get('/', requireAuth, (req, res) => {
  const { storeId, status, assigneeId, mine } = req.query;
  let tasks = db.getTasks();
  tasks = filterTasksByStore(tasks, req.session.user);
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

router.get('/:id', requireAuth, (req, res) => {
  const task = db.getTasks().find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: '整改任务不存在' });
  if (task.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店整改任务' });
  }
  res.json({ task });
});

router.post('/', requireAuth, (req, res) => {
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

router.post('/:id/assign', requireManager, (req, res) => {
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

router.post('/:id/submit', requireAuth, (req, res) => {
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
  const conflict = checkUpdatedAt(task, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
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

router.post('/:id/accept', requireManager, (req, res) => {
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
  const conflict = checkUpdatedAt(task, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
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

router.post('/:id/reject', requireManager, (req, res) => {
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
  const conflict = checkUpdatedAt(task, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
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

module.exports = router;
