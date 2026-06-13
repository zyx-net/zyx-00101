const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3099;
const BASE = 'localhost';
const PROJECT_DIR = path.join(__dirname, '..');
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-test-'));

let serverProc = null;
let serverPid = null;
let serverPidFirstRun = null;

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });

function cleanup() {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill('SIGKILL'); } catch {}
  }
  serverProc = null;
  try {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  } catch {}
}

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: TEST_DATA_DIR };
    serverProc = spawn('node', ['server.js'], {
      cwd: PROJECT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    serverPid = serverProc.pid;
    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('server start timeout'));
    }, 5000);
    serverProc.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('启动成功') && !started) {
        started = true;
        clearTimeout(timeout);
        setTimeout(resolve, 200);
      }
    });
    serverProc.stderr.on('data', (data) => {
      if (!started) reject(new Error('server stderr: ' + data.toString()));
    });
    serverProc.on('exit', (code) => {
      if (!started) reject(new Error('server exited before start, code=' + code));
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProc || serverProc.killed) return resolve();
    serverProc.on('close', resolve);
    serverProc.kill('SIGTERM');
    setTimeout(() => {
      if (serverProc && !serverProc.killed) {
        serverProc.kill('SIGKILL');
      }
    }, 2000);
  });
}

function request(method, path, data, cookieJar) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    if (cookieJar && cookieJar.cookie) headers['Cookie'] = cookieJar.cookie;
    const req = http.request({ host: BASE, port: PORT, path, method, headers }, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const resp = Buffer.concat(chunks).toString();
        if (res.headers['set-cookie'] && cookieJar) cookieJar.cookie = res.headers['set-cookie'][0].split(';')[0];
        try { resolve({ status: res.statusCode, data: JSON.parse(resp) }); }
        catch { resolve({ status: res.statusCode, data: resp }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function login(user, pass) {
  const jar = {};
  const r = await request('POST', '/api/login', { username: user, password: pass }, jar);
  if (r.status !== 200) throw new Error(`login fail ${user}: ${r.data.error}`);
  return jar;
}

const today = new Date().toISOString().slice(0, 10);
function eq(a, e, m) { if (a !== e) throw new Error(`FAIL ${m}: expect ${e}, got ${a}`); console.log(`  OK ${m}: ${a}`); }
function err(r, sub, m) { if (r.status === 200 || !(r.data.error || '').includes(sub))
  throw new Error(`FAIL ${m}: expect "${sub}", status=${r.status} error=${r.data.error || r.data}`);
  console.log(`  OK ${m}`); }

(async () => {
  console.log('Test data dir: ' + TEST_DATA_DIR);
  console.log('Isolated from project data/: ' + (TEST_DATA_DIR !== path.join(PROJECT_DIR, 'data')));
  console.log();

  console.log('=== Phase 1: Start fresh server, run main flow + error boundaries + rectification tasks ===');
  await startServer();
  serverPidFirstRun = serverPid;
  console.log(`  Server PID=${serverPid}, data dir=${TEST_DATA_DIR}\n`);

  console.log('[1/8] All sample accounts login');
  const m1 = await login('manager1', 'manager123');
  const m2 = await login('manager2', 'manager123');
  const s1 = await login('staff1', 'staff123');
  const s2 = await login('staff2', 'staff123');
  const s3 = await login('staff3', 'staff123');
  const s4 = await login('staff4', 'staff123');
  console.log('  OK 6 accounts login\n');

  const cl = await request('GET', '/api/config/checklist', null, s1);
  const items = cl.data.checklist.map(c => ({ id: c.id, checked: true }));

  console.log('[2/8] Main flow: create -> handover -> confirm -> exceptions -> review -> handle/close exc -> close shift');
  const cr = await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'morning', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U004', checklistItems: items, note: 'main test'
  }, s1);
  eq(cr.status, 200, 'create shift');
  const sid = cr.data.shift.id;
  eq(cr.data.shift.status, 'draft', 'status after create = draft');

  await request('POST', `/api/shifts/${sid}/handover`, {}, s1);
  eq((await request('GET', `/api/shifts/${sid}`, null, s1)).data.shift.status, 'handed_over', 'after handover = handed_over');

  await request('POST', `/api/shifts/${sid}/confirm`, {}, s2);
  eq((await request('GET', `/api/shifts/${sid}`, null, s2)).data.shift.status, 'confirmed', 'after confirm = confirmed');

  const e1 = await request('POST', '/api/exceptions', { shiftId: sid, type: 'cash', amount: -50, responsibleStaffId: 'U003', description: 'cash diff -50' }, s2);
  eq(e1.status, 200, 'register cash exception');
  const eid1 = e1.data.exception.id;
  const e2 = await request('POST', '/api/exceptions', { shiftId: sid, type: 'inventory', itemName: 'Coke', quantity: 3, responsibleStaffId: 'U003', description: 'stock shortage' }, s2);
  eq(e2.status, 200, 'register inventory exception');
  const eid2 = e2.data.exception.id;

  await request('POST', `/api/shifts/${sid}/submit-review`, {}, s2);
  eq((await request('GET', `/api/shifts/${sid}`, null, s2)).data.shift.status, 'reviewing', 'after submit-review = reviewing');

  await request('POST', `/api/exceptions/${eid1}/handle`, { note: 'verified cash' }, m1);
  await request('POST', `/api/exceptions/${eid1}/close`, { note: 'resolved cash' }, m1);
  await request('POST', `/api/exceptions/${eid2}/handle`, { note: 'verified stock' }, m1);
  await request('POST', `/api/exceptions/${eid2}/close`, { note: 'resolved stock' }, m1);
  const el = (await request('GET', `/api/exceptions?shiftId=${sid}`, null, m1)).data.exceptions;
  eq(el.filter(e => e.status === 'closed').length, 2, '2 exceptions closed');

  await request('POST', `/api/shifts/${sid}/close`, { reviewNote: 'all good' }, m1);
  eq((await request('GET', `/api/shifts/${sid}`, null, m1)).data.shift.status, 'closed', 'shift final status = closed');
  console.log();

  console.log('[3/8] Error boundaries (status NOT corrupted on failure)');
  const c2 = await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'evening', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U005', checklistItems: items, note: 'perm test'
  }, s1);
  const s2id = c2.data.shift.id;
  await request('POST', `/api/shifts/${s2id}/handover`, {}, s1);
  await request('POST', `/api/shifts/${s2id}/confirm`, {}, s3);
  await request('POST', `/api/shifts/${s2id}/submit-review`, {}, s3);

  err(await request('POST', `/api/shifts/${s2id}/close`, { reviewNote: 'x' }, s3), '权限不足', 'staff cannot close shift (403)');
  eq((await request('GET', `/api/shifts/${s2id}`, null, m1)).data.shift.status, 'reviewing', 'status unchanged after staff-close-fail');

  err(await request('POST', `/api/shifts/${s2id}/close`, { reviewNote: 'x' }, m2), '本门店', 'cross-store manager cannot close (403)');
  eq((await request('GET', `/api/shifts/${s2id}`, null, m1)).data.shift.status, 'reviewing', 'status unchanged after cross-store-fail');

  const c3 = await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'afternoon', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U004', checklistItems: items, note: 'dup confirm test'
  }, s1);
  const s3id = c3.data.shift.id;
  await request('POST', `/api/shifts/${s3id}/handover`, {}, s1);
  await request('POST', `/api/shifts/${s3id}/confirm`, {}, s2);

  err(await request('POST', `/api/shifts/${s3id}/confirm`, {}, s2), '已确认', 'duplicate confirm rejected (400)');
  eq((await request('GET', `/api/shifts/${s3id}`, null, m1)).data.shift.status, 'confirmed', 'status unchanged after dup-confirm-fail');

  await request('POST', `/api/shifts/${s3id}/submit-review`, {}, s2);
  await request('POST', '/api/exceptions', { shiftId: s3id, type: 'cash', amount: 10, responsibleStaffId: 'U003', description: 'unresolved test' }, s2);

  err(await request('POST', `/api/shifts/${s3id}/close`, { reviewNote: 'x' }, m1), '未关闭异常', 'close with unresolved exceptions rejected (400)');
  eq((await request('GET', `/api/shifts/${s3id}`, null, m1)).data.shift.status, 'reviewing', 'status unchanged after unresolved-fail');

  err(await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'morning', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U003', checklistItems: items, note: 'same person test'
  }, s1), '不能为同一人', 'handover==receive rejected (400)');
  console.log();

  console.log('[TASK-1] Rectification task main flow: create -> assign -> submit -> accept/close');
  const taskShift = await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'afternoon', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U004', checklistItems: items, note: 'task flow test'
  }, s1);
  const tsid = taskShift.data.shift.id;
  await request('POST', `/api/shifts/${tsid}/handover`, {}, s1);
  await request('POST', `/api/shifts/${tsid}/confirm`, {}, s2);
  const taskEx = await request('POST', '/api/exceptions', { shiftId: tsid, type: 'cash', amount: 200, responsibleStaffId: 'U003', description: 'large cash shortage for rectification' }, s2);
  const teid = taskEx.data.exception.id;

  const crTask = await request('POST', '/api/tasks', {
    exceptionId: teid, assigneeId: 'U003', deadline: today,
    steps: '1. recount\n2. check video\n3. report to manager', attachmentNote: 'photo no. 123'
  }, s2);
  eq(crTask.status, 200, 'create rectification task');
  const tid = crTask.data.task.id;
  eq(crTask.data.task.status, 'pending', 'task status after create = pending');
  eq(crTask.data.task.assigneeId, 'U003', 'task assignee = U003');
  eq(crTask.data.task.statusHistory.length, 1, 'task statusHistory has 1 entry');

  const asTask = await request('POST', `/api/tasks/${tid}/assign`, { assigneeId: 'U004', note: 'reassigned' }, m1);
  eq(asTask.data.task.status, 'assigned', 'after assign = assigned');
  eq(asTask.data.task.assigneeName, '赵中班', 'after assign assigneeName = 赵中班');
  eq(asTask.data.task.statusHistory.length, 2, 'statusHistory after assign = 2');

  const subTask = await request('POST', `/api/tasks/${tid}/submit`, { submitNote: 'recounted and found missing 200 from drawer, filled by me' }, s2);
  eq(subTask.data.task.status, 'submitted', 'after submit = submitted');
  eq(subTask.data.task.submittedByName, '赵中班', 'submittedByName = 赵中班');
  eq(subTask.data.task.statusHistory.length, 3, 'statusHistory after submit = 3');

  const accTask = await request('POST', `/api/tasks/${tid}/accept`, { closeNote: 'accepted' }, m1);
  eq(accTask.data.task.status, 'closed', 'after accept = closed');
  eq(accTask.data.task.closedByName, '张店长', 'closedByName = 张店长');
  eq(accTask.data.task.statusHistory.length, 4, 'statusHistory after accept = 4');
  console.log();

  console.log('[TASK-2] Rectification task error boundaries & concurrency');
  const taskEx2 = await request('POST', '/api/exceptions', { shiftId: tsid, type: 'stock', itemName: 'Water', responsibleStaffId: 'U005', description: 'stock test' }, s2);
  const teid2 = taskEx2.data.exception.id;
  const crTask2 = await request('POST', '/api/tasks', { exceptionId: teid2, assigneeId: 'U005', steps: 'check' }, s2);
  eq(crTask2.status, 200, 'create second task');
  const tid2 = crTask2.data.task.id;
  const oldUpdatedAt = crTask2.data.task.updatedAt;

  err(await request('POST', '/api/tasks', { exceptionId: teid2, assigneeId: 'U005' }, s2), '进行中的整改任务', 'duplicate task creation rejected (409)');

  err(await request('POST', `/api/tasks/${tid2}/assign`, { assigneeId: 'U005' }, m2), '本门店', 'cross-store manager cannot assign task (403)');
  eq((await request('GET', `/api/tasks/${tid2}`, null, m1)).data.task.status, 'pending', 'task status unchanged after cross-store assign fail');

  err(await request('POST', `/api/tasks/${tid2}/assign`, { assigneeId: 'U006' }, m1), '必须属于本门店', 'assign to other-store user rejected (400)');

  err(await request('POST', `/api/tasks/${tid2}/submit`, { submitNote: 'x' }, s4), '本门店', 'other-store staff cannot submit task (403)');

  err(await request('POST', `/api/tasks/${tid}/accept`, { closeNote: 'x' }, m1), '不可验收', 'closed task cannot be accepted again (400)');

  err(await request('GET', `/api/tasks/${tid2}`, null, s4), '无权查看', 'other-store staff cannot view task (403)');

  await request('POST', `/api/tasks/${tid2}/assign`, { assigneeId: 'U005' }, m1);
  const staleUpdatedAt = oldUpdatedAt;
  err(await request('POST', `/api/tasks/${tid2}/submit`, { submitNote: 'stale', updatedAt: staleUpdatedAt }, s3), '已被他人修改', 'stale submit rejected (409)');
  console.log();

  console.log('[TASK-3] Rectification task reject loop');
  const taskEx3 = await request('POST', '/api/exceptions', { shiftId: tsid, type: 'cash', amount: 50, responsibleStaffId: 'U003', description: 'reject test' }, s2);
  const teid3 = taskEx3.data.exception.id;
  const crTask3 = await request('POST', '/api/tasks', { exceptionId: teid3, assigneeId: 'U003', steps: 'a' }, s2);
  const tid3 = crTask3.data.task.id;
  await request('POST', `/api/tasks/${tid3}/assign`, {}, m1);
  await request('POST', `/api/tasks/${tid3}/submit`, { submitNote: 'done' }, s1);
  eq((await request('GET', `/api/tasks/${tid3}`, null, m1)).data.task.status, 'submitted', 'before reject = submitted');
  const rej = await request('POST', `/api/tasks/${tid3}/reject`, { rejectNote: 'incomplete' }, m1);
  eq(rej.data.task.status, 'rejected', 'after reject = rejected');
  eq(rej.data.task.rejectNote, 'incomplete', 'rejectNote preserved');
  const resub = await request('POST', `/api/tasks/${tid3}/submit`, { submitNote: 'fixed' }, s1);
  eq(resub.data.task.status, 'submitted', 'after re-submit = submitted');
  const acc2 = await request('POST', `/api/tasks/${tid3}/accept`, { closeNote: 'ok now' }, m1);
  eq(acc2.data.task.status, 'closed', 're-submit then accept = closed');
  console.log();

  console.log('[4/8] CSV / JSON export');
  const csvRes = await request('GET', '/api/export/shifts?storeId=S001&format=csv', null, m1);
  eq(csvRes.status, 200, 'shifts CSV export');
  if (typeof csvRes.data !== 'string' || !csvRes.data.includes('班次ID')) {
    throw new Error('FAIL shifts CSV content: expected CSV header with 班次ID, got: ' + String(csvRes.data).slice(0, 80));
  }
  console.log('  OK shifts CSV content validated (has 班次ID header)');

  const jsonRes = await request('GET', '/api/export/shifts?storeId=S001&format=json', null, m1);
  eq(jsonRes.status, 200, 'shifts JSON export');
  if (typeof jsonRes.data !== 'object' || !jsonRes.data.shifts) {
    throw new Error('FAIL shifts JSON content: expected { shifts: [...] }, got: ' + String(jsonRes.data).slice(0, 80));
  }
  console.log('  OK shifts JSON content validated (has shifts array)');

  const excCsvRes = await request('GET', '/api/export/exceptions?storeId=S001&format=csv', null, m1);
  eq(excCsvRes.status, 200, 'exceptions CSV export');
  if (typeof excCsvRes.data !== 'string' || !excCsvRes.data.includes('异常ID')) {
    throw new Error('FAIL exceptions CSV content: expected CSV header with 异常ID, got: ' + String(excCsvRes.data).slice(0, 80));
  }
  console.log('  OK exceptions CSV content validated (has 异常ID header)');

  const excJsonRes = await request('GET', '/api/export/exceptions?storeId=S001&format=json', null, m1);
  eq(excJsonRes.status, 200, 'exceptions JSON export');
  if (typeof excJsonRes.data !== 'object' || !excJsonRes.data.exceptions) {
    throw new Error('FAIL exceptions JSON content: expected { exceptions: [...] }, got: ' + String(excJsonRes.data).slice(0, 80));
  }
  console.log('  OK exceptions JSON content validated (has exceptions array)');

  const taskCsvRes = await request('GET', '/api/export/tasks?storeId=S001&format=csv', null, m1);
  eq(taskCsvRes.status, 200, 'tasks CSV export');
  if (typeof taskCsvRes.data !== 'string' || !taskCsvRes.data.includes('任务ID')) {
    throw new Error('FAIL tasks CSV content: expected CSV header with 任务ID, got: ' + String(taskCsvRes.data).slice(0, 80));
  }
  console.log('  OK tasks CSV content validated (has 任务ID header)');

  const taskJsonRes = await request('GET', '/api/export/tasks?storeId=S001&format=json', null, m1);
  eq(taskJsonRes.status, 200, 'tasks JSON export');
  if (typeof taskJsonRes.data !== 'object' || !taskJsonRes.data.tasks) {
    throw new Error('FAIL tasks JSON content: expected { tasks: [...] }, got: ' + String(taskJsonRes.data).slice(0, 80));
  }
  console.log('  OK tasks JSON content validated (has tasks array)');
  console.log();

  console.log('[5/8] Operation history');
  const hist = (await request('GET', '/api/history', null, m1)).data.history;
  const acts = hist.map(h => h.action);
  ['CREATE_SHIFT','HANDOVER_SHIFT','CONFIRM_SHIFT','CREATE_EXCEPTION','SUBMIT_REVIEW','HANDLE_EXCEPTION','CLOSE_EXCEPTION','CLOSE_SHIFT',
   'CREATE_TASK','ASSIGN_TASK','SUBMIT_TASK','ACCEPT_TASK','REJECT_TASK']
    .forEach(a => { if (!acts.includes(a)) throw new Error(`missing history action: ${a}`); });
  console.log(`  OK all 13 action types present (total=${hist.length})`);
  console.log();

  console.log('=== Phase 2: Snapshot, REAL restart (kill old PID, spawn new process), verify persistence ===');
  const before = {
    shift: (await request('GET', `/api/shifts/${sid}`, null, m1)).data,
    shiftsCsv: (await request('GET', '/api/export/shifts?storeId=S001&format=csv', null, m1)).data,
    shiftsJson: (await request('GET', '/api/export/shifts?storeId=S001&format=json', null, m1)).data,
    excCsv: (await request('GET', '/api/export/exceptions?storeId=S001&format=csv', null, m1)).data,
    excJson: (await request('GET', '/api/export/exceptions?storeId=S001&format=json', null, m1)).data,
    task: (await request('GET', `/api/tasks/${tid}`, null, m1)).data,
    taskList: (await request('GET', '/api/tasks?storeId=S001', null, m1)).data,
    taskCsv: (await request('GET', '/api/export/tasks?storeId=S001&format=csv', null, m1)).data,
    taskJson: (await request('GET', '/api/export/tasks?storeId=S001&format=json', null, m1)).data
  };
  if (typeof before.shiftsCsv !== 'string' || !before.shiftsCsv.includes('班次ID')) {
    throw new Error('FAIL before.shiftsCsv is not valid CSV (missing 班次ID header)');
  }
  if (typeof before.shiftsJson !== 'object' || !before.shiftsJson.shifts) {
    throw new Error('FAIL before.shiftsJson is not valid export data (missing shifts array)');
  }
  if (typeof before.excCsv !== 'string' || !before.excCsv.includes('异常ID')) {
    throw new Error('FAIL before.excCsv is not valid CSV (missing 异常ID header)');
  }
  if (typeof before.excJson !== 'object' || !before.excJson.exceptions) {
    throw new Error('FAIL before.excJson is not valid export data (missing exceptions array)');
  }
  if (typeof before.taskCsv !== 'string' || !before.taskCsv.includes('任务ID')) {
    throw new Error('FAIL before.taskCsv is not valid CSV (missing 任务ID header)');
  }
  if (typeof before.taskJson !== 'object' || !before.taskJson.tasks) {
    throw new Error('FAIL before.taskJson is not valid export data (missing tasks array)');
  }
  if (!before.task.task || before.task.task.status !== 'closed') {
    throw new Error('FAIL before.task is not a valid closed task');
  }
  console.log(`  First-run PID=${serverPidFirstRun}, snapshot saved for shift=${sid}, task=${tid}`);

  console.log();
  console.log('  Stopping server (SIGTERM, real kill)...');
  await stopServer();
  await new Promise(r => setTimeout(r, 300));
  console.log(`  Server stopped. Old PID=${serverPidFirstRun} was killed.`);
  console.log('  Restarting server (fresh process, same DATA_DIR)...');

  await startServer();
  const serverPidSecondRun = serverPid;
  console.log(`  Server restarted. New PID=${serverPidSecondRun}`);
  if (serverPidFirstRun === serverPidSecondRun) {
    throw new Error('FAIL: restart did NOT produce a new PID (fake restart)');
  }
  console.log(`  OK PID changed: ${serverPidFirstRun} -> ${serverPidSecondRun} (real restart confirmed)`);
  console.log('  Re-logging in (in-memory session cleared after restart)...\n');
  const m1r = await login('manager1', 'manager123');

  console.log('[6/8] Persistence after real restart');
  const after = {
    shift: (await request('GET', `/api/shifts/${sid}`, null, m1r)).data,
    shiftsCsv: (await request('GET', '/api/export/shifts?storeId=S001&format=csv', null, m1r)).data,
    shiftsJson: (await request('GET', '/api/export/shifts?storeId=S001&format=json', null, m1r)).data,
    excCsv: (await request('GET', '/api/export/exceptions?storeId=S001&format=csv', null, m1r)).data,
    excJson: (await request('GET', '/api/export/exceptions?storeId=S001&format=json', null, m1r)).data,
    task: (await request('GET', `/api/tasks/${tid}`, null, m1r)).data,
    taskList: (await request('GET', '/api/tasks?storeId=S001', null, m1r)).data,
    taskCsv: (await request('GET', '/api/export/tasks?storeId=S001&format=csv', null, m1r)).data,
    taskJson: (await request('GET', '/api/export/tasks?storeId=S001&format=json', null, m1r)).data
  };

  eq(after.shift.shift.status, before.shift.shift.status, 'shift status preserved');
  eq(after.shift.shift.reviewNote, before.shift.shift.reviewNote, 'shift reviewNote preserved');
  eq(after.shift.shift.reviewedByName, before.shift.shift.reviewedByName, 'shift reviewedByName preserved');
  eq(after.shift.exceptions.length, before.shift.exceptions.length, 'exception count preserved');
  eq(after.shift.exceptions[0].status, before.shift.exceptions[0].status, 'exc 0 status preserved');
  eq(after.shift.exceptions[0].responsibleStaffName, before.shift.exceptions[0].responsibleStaffName, 'exc 0 responsible name preserved');
  eq(after.shift.exceptions[1].status, before.shift.exceptions[1].status, 'exc 1 status preserved');
  eq(after.shift.exceptions[1].description, before.shift.exceptions[1].description, 'exc 1 description preserved');
  eq(after.shiftsCsv, before.shiftsCsv, 'shifts CSV identical');
  eq(JSON.stringify(after.shiftsJson), JSON.stringify(before.shiftsJson), 'shifts JSON identical');
  eq(after.excCsv, before.excCsv, 'exceptions CSV identical');
  eq(JSON.stringify(after.excJson), JSON.stringify(before.excJson), 'exceptions JSON identical');

  eq(after.task.task.status, before.task.task.status, 'task status preserved');
  eq(after.task.task.assigneeName, before.task.task.assigneeName, 'task assigneeName preserved');
  eq(after.task.task.closedByName, before.task.task.closedByName, 'task closedByName preserved');
  eq(after.task.task.closeNote, before.task.task.closeNote, 'task closeNote preserved');
  eq(after.task.task.steps, before.task.task.steps, 'task steps preserved');
  eq(after.task.task.statusHistory.length, before.task.task.statusHistory.length, 'task statusHistory length preserved');
  eq(after.taskList.tasks.length, before.taskList.tasks.length, 'task list count preserved');
  eq(after.taskCsv, before.taskCsv, 'tasks CSV identical');
  eq(JSON.stringify(after.taskJson), JSON.stringify(before.taskJson), 'tasks JSON identical');

  console.log();
  console.log('=== Cleanup: stop server, delete temp data dir ===');
  await stopServer();
  await new Promise(r => setTimeout(r, 200));
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    console.log(`  Temp data dir removed: ${TEST_DATA_DIR}`);
  }
  console.log('  Project data/ left untouched (no pollution).');

  console.log('\n====================');
  console.log('  ALL TESTS PASSED');
  console.log('====================');
})().catch(async (e) => {
  console.error('\n❌ VERIFY FAILED:', e.message);
  cleanup();
  process.exit(1);
});
