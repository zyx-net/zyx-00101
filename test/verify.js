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
  console.log('[DEV-1] Device management: create, CSV import (with duplicate), list, detail, delete');
  const d1 = await request('POST', '/api/devices', {
    code: 'TEST-001', name: '测试设备1', category: '测试', model: 'M-001', location: '位置A', note: '测试备注'
  }, m1);
  eq(d1.status, 200, 'create device');
  const dv1 = d1.data.device;
  eq(dv1.code, 'TEST-001', 'device code');
  eq(dv1.storeId, 'S001', 'device storeId = S001');
  console.log('  OK device created, id=' + dv1.id);

  const dup = await request('POST', '/api/devices', { code: 'TEST-001', name: '重复设备' }, m1);
  err(dup, '已存在相同编号', 'duplicate device code rejected (409)');
  eq(dup.status, 409, 'duplicate device returns 409');

  const csv = '设备编号,设备名称,分类,型号,位置,购买日期,备注\nTEST-001,覆盖失败,测试,M-X,位置B,2024-01-01,测试\nTEST-002,CSV设备2,IT,HP-X,位置2,2024-02-01,备注2\nTEST-003,CSV设备3,制冷,海尔-Y,位置3,2024-03-01,备注3\nTEST-004,CSV设备4,电器,格力-Z,位置4,2024-04-01,备注4';
  const imp = await request('POST', '/api/devices/import/csv', { csvText: csv }, m1);
  eq(imp.status, 200, 'CSV import');
  eq(imp.data.totalImported, 3, 'CSV imported 3 (skipped 1 duplicate)');
  eq(imp.data.totalSkipped, 1, 'CSV skipped 1 duplicate');
  eq(imp.data.skipped[0].reason, '编号重复，保留原数据', 'duplicate skip reason');
  const dlist = (await request('GET', '/api/devices', null, m1)).data.devices;
  eq(dlist.length, 4, 'device list count = 4 (1 created + 3 imported)');
  const preserved = dlist.find(d => d.code === 'TEST-001');
  eq(preserved.name, '测试设备1', 'duplicate code preserves original data (not overwritten)');
  console.log('  OK CSV import duplicate preserves original data');

  const ddv = (await request('GET', '/api/devices/' + dv1.id, null, m1)).data.device;
  eq(ddv.code, 'TEST-001', 'device detail code');
  eq(ddv.createdByName, '张店长', 'device detail createdByName');
  console.log('  OK device detail');

  const del = await request('POST', '/api/devices/' + dv1.id + '?_method=DELETE', {}, m1);
  eq(del.status, 200, 'delete device');
  const dlist2 = (await request('GET', '/api/devices', null, m1)).data.devices;
  eq(dlist2.length, 3, 'device count after delete = 3');
  console.log('  OK device delete');

  console.log();
  console.log('[DEV-2] Inspection template, inspection flow, and repair order full lifecycle');
  const tpl = await request('POST', '/api/inspection-templates', {
    name: '测试巡检模板', description: '测试用',
    items: [
      { name: '外观检查', category: '常规', description: '外观完好', required: true },
      { name: '功能测试', category: '功能', description: '功能正常', required: true }
    ]
  }, m1);
  eq(tpl.status, 200, 'create inspection template');
  const tplId = tpl.data.template.id;
  const tplList = (await request('GET', '/api/inspection-templates', null, m1)).data.templates;
  eq(tplList.length, 1, 'template list count = 1');
  eq(tplList[0].items.length, 2, 'template has 2 items');
  console.log('  OK template created');

  const dvcForIns = dlist2[0];
  const insCreate = await request('POST', '/api/inspections', {
    shiftId: sid, templateId: tplId, inspectionDate: today, deviceIds: [dvcForIns.id]
  }, s1);
  eq(insCreate.status, 200, 'create inspection');
  const insId = insCreate.data.inspection.id;
  const ins = (await request('GET', '/api/inspections/' + insId, null, s1)).data.inspection;
  eq(ins.items.length, 2, 'inspection has 2 items (1 device x 2 template items)');
  eq(ins.status, 'draft', 'inspection initial status = draft');
  console.log('  OK inspection created with items');

  const insItems = ins.items.map(it => ({
    id: it.id, result: it.id.includes('ITEM1') ? 'normal' : 'abnormal',
    attachmentNote: it.id.includes('ITEM1') ? '' : '测试异常',
    tempHandling: it.id.includes('ITEM1') ? '' : '临时处理中'
  }));
  const insSubmit = await request('PUT', '/api/inspections/' + insId, {
    items: insItems, status: 'submitted', updatedAt: ins.updatedAt
  }, s1);
  eq(insSubmit.status, 200, 'submit inspection');
  const insSub = (await request('GET', '/api/inspections/' + insId, null, s1)).data.inspection;
  eq(insSub.status, 'submitted', 'inspection after submit = submitted');
  eq(insSub.items.filter(i => i.result === 'abnormal').length, 1, '1 abnormal item');
  console.log('  OK inspection submitted with abnormal item');

  const convert = await request('POST', '/api/inspections/' + insId + '/convert-to-repair', {
    itemIds: insSub.items.filter(i => i.result === 'abnormal').map(i => i.id)
  }, s1);
  eq(convert.status, 200, 'convert to repair');
  eq(convert.data.repairOrders.length, 1, '1 repair order created');
  eq(convert.data.inspection.status, 'converted', 'inspection status after convert = converted');
  const roId = convert.data.repairOrders[0].id;
  const ro = (await request('GET', '/api/repair-orders/' + roId, null, m1)).data.repairOrder;
  eq(ro.status, 'reported', 'repair initial status = reported');
  eq(ro.deviceId, dvcForIns.id, 'repair device matches');
  eq(ro.statusHistory.length, 1, 'repair statusHistory has 1 entry (reported)');
  eq(ro.statusHistory[0].status, 'reported', 'first history entry = reported');
  console.log('  OK converted to repair order');

  const assign = await request('POST', '/api/repair-orders/' + roId + '/assign', {
    assigneeId: 'U004', note: '请尽快维修', updatedAt: ro.updatedAt
  }, m1);
  eq(assign.status, 200, 'assign repair');
  const ro2 = (await request('GET', '/api/repair-orders/' + roId, null, m1)).data.repairOrder;
  eq(ro2.status, 'accepted', 'repair after assign = accepted');
  eq(ro2.assigneeId, 'U004', 'assignee = staff2');
  eq(ro2.statusHistory.length, 2, 'statusHistory has 2 entries');
  eq(ro2.statusHistory[1].status, 'accepted', 'second entry = accepted');
  console.log('  OK repair assigned');

  const complete = await request('POST', '/api/repair-orders/' + roId + '/complete', {
    completedNote: '已修复，测试正常', updatedAt: ro2.updatedAt
  }, s2);
  eq(complete.status, 200, 'complete repair');
  const ro3 = (await request('GET', '/api/repair-orders/' + roId, null, m1)).data.repairOrder;
  eq(ro3.status, 'completed', 'repair after complete = completed');
  eq(ro3.statusHistory.length, 3, 'statusHistory has 3 entries');
  console.log('  OK repair completed');

  const reject = await request('POST', '/api/repair-orders/' + roId + '/reject', {
    rejectedNote: '修复不彻底，重新检查', updatedAt: ro3.updatedAt
  }, m1);
  eq(reject.status, 200, 'reject repair');
  const ro4 = (await request('GET', '/api/repair-orders/' + roId, null, m1)).data.repairOrder;
  eq(ro4.status, 'rejected', 'repair after reject = rejected');
  eq(ro4.rejectedNote, '修复不彻底，重新检查', 'rejected note');
  eq(ro4.statusHistory.length, 4, 'statusHistory has 4 entries');
  console.log('  OK repair rejected');

  const complete2 = await request('POST', '/api/repair-orders/' + roId + '/complete', {
    completedNote: '已彻底修复，测试通过', updatedAt: ro4.updatedAt
  }, s2);
  eq(complete2.status, 200, 'complete repair again');
  const ro5 = (await request('GET', '/api/repair-orders/' + roId, null, m1)).data.repairOrder;
  eq(ro5.status, 'completed', 'repair after second complete = completed');
  const verify = await request('POST', '/api/repair-orders/' + roId + '/verify', {
    verifiedNote: '验收合格', updatedAt: ro5.updatedAt
  }, m1);
  eq(verify.status, 200, 'verify repair');
  const ro6 = (await request('GET', '/api/repair-orders/' + roId, null, m1)).data.repairOrder;
  eq(ro6.status, 'verified', 'repair final status = verified');
  eq(ro6.statusHistory.length, 6, 'statusHistory has 6 entries (full lifecycle)');
  console.log('  OK repair verified, full lifecycle complete');

  console.log();
  console.log('[DEV-3] Permission and conflict tests');
  err(await request('GET', '/api/devices/' + dvcForIns.id, null, m2), '非本门店', 'cross-store manager cannot see device detail (403)');
  err(await request('POST', '/api/devices', { code: 'X-001', name: '越权设备', storeId: 'S001' }, m2), '仅本门店', 'cross-store manager cannot create device (403)');
  err(await request('POST', '/api/repair-orders/' + roId + '/assign', { assigneeId: 'U006', note: '越权分派' }, m2), '仅本门店', 'cross-store manager cannot assign repair (403)');
  err(await request('POST', '/api/repair-orders/' + roId + '/complete', { completedNote: '越权完成' }, s3), '仅接修人', 'non-assignee staff cannot complete repair (403)');

  const conflictIns = await request('POST', '/api/inspections', { shiftId: sid, templateId: tplId, inspectionDate: today, deviceIds: [dvcForIns.id] }, s1);
  const conflictInsId = conflictIns.data.inspection.id;
  const conflictInsData = conflictIns.data.inspection;
  const conflictInsItems = conflictInsData.items.map(it => ({ id: it.id, result: 'abnormal', attachmentNote: '冲突测试异常', tempHandling: '临时处理' }));
  await request('PUT', '/api/inspections/' + conflictInsId, { items: conflictInsItems, status: 'submitted', updatedAt: conflictInsData.updatedAt }, s1);
  const convertConflict = await request('POST', '/api/inspections/' + conflictInsId + '/convert-to-repair', {}, s1);
  const conflictRoId = convertConflict.data.repairOrders[0].id;

  const roConflictA = await request('GET', '/api/repair-orders/' + conflictRoId, null, m1);
  const roConflictB = await request('GET', '/api/repair-orders/' + conflictRoId, null, m1);
  const roOldUpdatedAt = roConflictA.data.repairOrder.updatedAt;
  await new Promise(r => setTimeout(r, 10));
  await request('POST', '/api/repair-orders/' + conflictRoId + '/assign', { assigneeId: 'U004', note: 'A先分派', updatedAt: roConflictA.data.repairOrder.updatedAt }, m1);
  const conflict = await request('POST', '/api/repair-orders/' + conflictRoId + '/assign', { assigneeId: 'U003', updatedAt: roOldUpdatedAt }, m1);
  err(conflict, '已被他人修改', 'stale update returns 409');
  eq(conflict.status, 409, 'conflict returns 409');
  const roConflictFinal = (await request('GET', '/api/repair-orders/' + conflictRoId, null, m1)).data.repairOrder;
  eq(roConflictFinal.status, 'accepted', 'status unchanged after 409 conflict (assigned to U004, not U003)');
  eq(roConflictFinal.assigneeId, 'U004', 'assignee unchanged after 409 conflict (not reverted to null)');
  console.log('  OK 409 conflict, status preserved');

  console.log();
  console.log('[DEV-4] CSV/JSON export for devices, inspections, repair-orders');
  const devCsv = await request('GET', '/api/export/devices?storeId=S001&format=csv', null, m1);
  eq(typeof devCsv.data, 'string', 'devices CSV is string');
  eq(devCsv.data.includes('设备编号'), true, 'devices CSV has 设备编号 header');
  eq(devCsv.data.includes('TEST-002'), true, 'devices CSV contains TEST-002');
  const devJson = await request('GET', '/api/export/devices?storeId=S001&format=json', null, m1);
  eq(typeof devJson.data, 'object', 'devices JSON is object');
  eq(Array.isArray(devJson.data.devices), true, 'devices JSON has devices array');
  console.log('  OK devices CSV/JSON export');

  const insCsv = await request('GET', '/api/export/inspections?storeId=S001&format=csv', null, m1);
  eq(typeof insCsv.data, 'string', 'inspections CSV is string');
  eq(insCsv.data.includes('巡检单ID'), true, 'inspections CSV has 巡检单ID header');
  const insJson = await request('GET', '/api/export/inspections?storeId=S001&format=json', null, m1);
  eq(Array.isArray(insJson.data.inspections), true, 'inspections JSON has inspections array');
  console.log('  OK inspections CSV/JSON export');

  const roCsv = await request('GET', '/api/export/repair-orders?storeId=S001&format=csv', null, m1);
  eq(typeof roCsv.data, 'string', 'repair-orders CSV is string');
  eq(roCsv.data.includes('维修单ID'), true, 'repair-orders CSV has 维修单ID header');
  const roJson = await request('GET', '/api/export/repair-orders?storeId=S001&format=json', null, m1);
  eq(Array.isArray(roJson.data.repairOrders), true, 'repair-orders JSON has repairOrders array');
  console.log('  OK repair-orders CSV/JSON export');

  console.log();
  console.log('[PERM-1] Store isolation for manager2 (Haidian store) - can only see own store data');
  const m2Shifts = (await request('GET', '/api/shifts', null, m2)).data.shifts;
  eq(m2Shifts.length, 0, 'manager2 (Haidian) sees 0 shifts from Chaoyang store');
  const m2Devices = (await request('GET', '/api/devices', null, m2)).data.devices;
  eq(m2Devices.length, 0, 'manager2 (Haidian) sees 0 devices from Chaoyang store');
  const m2Tasks = (await request('GET', '/api/tasks', null, m2)).data.tasks;
  eq(m2Tasks.length, 0, 'manager2 (Haidian) sees 0 tasks from Chaoyang store');
  console.log('  OK manager2 isolated to Haidian store');

  console.log('[PERM-2] Export permission consistency - staff/manager export filtered by store');
  const s1ShiftExport = await request('GET', '/api/export/shifts?format=json', null, s1);
  eq(s1ShiftExport.status, 200, 'staff can export shifts');
  eq(s1ShiftExport.data.shifts.length, (await request('GET', '/api/shifts', null, s1)).data.shifts.length, 'export matches list count for staff');
  
  const m2ShiftExport = await request('GET', '/api/export/shifts?format=json', null, m2);
  eq(m2ShiftExport.status, 200, 'manager2 can export');
  eq(m2ShiftExport.data.shifts.length, 0, 'manager2 export empty (no Haidian shifts)');
  
  const s1DeviceExport = await request('GET', '/api/export/devices?format=json', null, s1);
  eq(s1DeviceExport.data.devices.length, (await request('GET', '/api/devices', null, s1)).data.devices.length, 'device export matches list');
  console.log('  OK export permission consistent with list filtering');

  console.log('[PERM-3] Staff cross-store access denied');
  err(await request('GET', '/api/shifts/' + sid, null, s4), '无权查看', 'staff4 (Haidian) cannot access Chaoyang shift');
  err(await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'morning', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U004', checklistItems: items
  }, s4), '仅可创建本门店班次', 'staff4 cannot create Chaoyang shift');
  err(await request('GET', '/api/devices/' + dvcForIns.id, null, s4), '无权查看', 'staff4 cannot view Chaoyang device');
  console.log('  OK staff cross-store access denied');

  console.log();
  console.log('[5/8] Operation history (extended with device/inspection/repair actions)');
  const hist = (await request('GET', '/api/history', null, m1)).data.history;
  const acts = hist.map(h => h.action);
  ['CREATE_SHIFT','HANDOVER_SHIFT','CONFIRM_SHIFT','CREATE_EXCEPTION','SUBMIT_REVIEW','HANDLE_EXCEPTION','CLOSE_EXCEPTION','CLOSE_SHIFT',
   'CREATE_TASK','ASSIGN_TASK','SUBMIT_TASK','ACCEPT_TASK','REJECT_TASK',
   'CREATE_DEVICE','IMPORT_DEVICE','CREATE_TEMPLATE','CREATE_INSPECTION','SUBMIT_INSPECTION','CREATE_REPAIR','ASSIGN_REPAIR','COMPLETE_REPAIR','VERIFY_REPAIR','REJECT_REPAIR']
    .forEach(a => { if (!acts.includes(a)) throw new Error('missing history action: ' + a); });
  console.log('  OK all 23 action types present (total=' + hist.length + ')');
  console.log();

  console.log('=== Phase 2: Snapshot, REAL restart (kill old PID, spawn new process), verify persistence ===');
  const before = {
    shift: (await request('GET', '/api/shifts/' + sid, null, m1)).data,
    shiftsCsv: (await request('GET', '/api/export/shifts?storeId=S001&format=csv', null, m1)).data,
    shiftsJson: (await request('GET', '/api/export/shifts?storeId=S001&format=json', null, m1)).data,
    excCsv: (await request('GET', '/api/export/exceptions?storeId=S001&format=csv', null, m1)).data,
    excJson: (await request('GET', '/api/export/exceptions?storeId=S001&format=json', null, m1)).data,
    task: (await request('GET', '/api/tasks/' + tid, null, m1)).data,
    taskList: (await request('GET', '/api/tasks?storeId=S001', null, m1)).data,
    taskCsv: (await request('GET', '/api/export/tasks?storeId=S001&format=csv', null, m1)).data,
    taskJson: (await request('GET', '/api/export/tasks?storeId=S001&format=json', null, m1)).data,
    deviceList: (await request('GET', '/api/devices?storeId=S001', null, m1)).data,
    device: (await request('GET', '/api/devices/' + dvcForIns.id, null, m1)).data,
    devicesCsv: devCsv.data,
    devicesJson: devJson.data,
    inspectionList: (await request('GET', '/api/inspections?storeId=S001', null, m1)).data,
    inspection: (await request('GET', '/api/inspections/' + insId, null, m1)).data,
    inspectionsCsv: insCsv.data,
    inspectionsJson: insJson.data,
    repairOrderList: (await request('GET', '/api/repair-orders?storeId=S001', null, m1)).data,
    repairOrder: (await request('GET', '/api/repair-orders/' + roId, null, m1)).data,
    repairOrdersCsv: roCsv.data,
    repairOrdersJson: roJson.data
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
    shift: (await request('GET', '/api/shifts/' + sid, null, m1r)).data,
    shiftsCsv: (await request('GET', '/api/export/shifts?storeId=S001&format=csv', null, m1r)).data,
    shiftsJson: (await request('GET', '/api/export/shifts?storeId=S001&format=json', null, m1r)).data,
    excCsv: (await request('GET', '/api/export/exceptions?storeId=S001&format=csv', null, m1r)).data,
    excJson: (await request('GET', '/api/export/exceptions?storeId=S001&format=json', null, m1r)).data,
    task: (await request('GET', '/api/tasks/' + tid, null, m1r)).data,
    taskList: (await request('GET', '/api/tasks?storeId=S001', null, m1r)).data,
    taskCsv: (await request('GET', '/api/export/tasks?storeId=S001&format=csv', null, m1r)).data,
    taskJson: (await request('GET', '/api/export/tasks?storeId=S001&format=json', null, m1r)).data,
    deviceList: (await request('GET', '/api/devices?storeId=S001', null, m1r)).data,
    device: (await request('GET', '/api/devices/' + dvcForIns.id, null, m1r)).data,
    devicesCsv: (await request('GET', '/api/export/devices?storeId=S001&format=csv', null, m1r)).data,
    devicesJson: (await request('GET', '/api/export/devices?storeId=S001&format=json', null, m1r)).data,
    inspectionList: (await request('GET', '/api/inspections?storeId=S001', null, m1r)).data,
    inspection: (await request('GET', '/api/inspections/' + insId, null, m1r)).data,
    inspectionsCsv: (await request('GET', '/api/export/inspections?storeId=S001&format=csv', null, m1r)).data,
    inspectionsJson: (await request('GET', '/api/export/inspections?storeId=S001&format=json', null, m1r)).data,
    repairOrderList: (await request('GET', '/api/repair-orders?storeId=S001', null, m1r)).data,
    repairOrder: (await request('GET', '/api/repair-orders/' + roId, null, m1r)).data,
    repairOrdersCsv: (await request('GET', '/api/export/repair-orders?storeId=S001&format=csv', null, m1r)).data,
    repairOrdersJson: (await request('GET', '/api/export/repair-orders?storeId=S001&format=json', null, m1r)).data
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

  eq(after.deviceList.devices.length, before.deviceList.devices.length, 'device list count preserved');
  eq(after.device.device.code, before.device.device.code, 'device code preserved');
  eq(after.device.device.name, before.device.device.name, 'device name preserved');
  eq(after.device.device.status, before.device.device.status, 'device status preserved');
  eq(after.devicesCsv, before.devicesCsv, 'devices CSV identical');
  eq(JSON.stringify(after.devicesJson), JSON.stringify(before.devicesJson), 'devices JSON identical');
  console.log('  OK device persistence verified');

  console.log();
  console.log('[CONFLICT-1] Device update conflict');
  const existingDevices = (await request('GET', '/api/devices?storeId=S001', null, m1r)).data.devices;
  const testDevice = existingDevices[0];
  const cdId = testDevice.id;
  const cdOldUpdatedAt = testDevice.updatedAt;
  await new Promise(r => setTimeout(r, 100));
  await request('PUT', `/api/devices/${cdId}`, { name: 'Updated by A' }, m1r);
  const staleUpdate = await request('PUT', `/api/devices/${cdId}`, { name: 'Stale Update', updatedAt: cdOldUpdatedAt }, m1r);
  eq(staleUpdate.status, 409, 'stale device update returns 409');
  const cdAfter = (await request('GET', `/api/devices/${cdId}`, null, m1r)).data.device;
  eq(cdAfter.name, 'Updated by A', 'device name unchanged after 409');
  console.log('  OK device update conflict preserved');

  console.log('[CONFLICT-2] Task submit conflict (reject-submit race)');
  const existingTasks = (await request('GET', '/api/tasks?storeId=S001', null, m1r)).data.tasks;
  const rejectedTask = existingTasks.find(t => t.status === 'rejected');
  if (!rejectedTask) {
    console.log('  SKIP no rejected task found, conflict already tested in TASK-2');
  } else {
    const ctId = rejectedTask.id;
    const ctOldUpdatedAt = rejectedTask.updatedAt;
    await new Promise(r => setTimeout(r, 100));
    await request('POST', `/api/tasks/${ctId}/submit`, { submitNote: 'first submit' }, m1r);
    const staleSubmit = await request('POST', `/api/tasks/${ctId}/submit`, { submitNote: 'stale', updatedAt: ctOldUpdatedAt }, m1r);
    eq(staleSubmit.status, 409, 'stale task submit returns 409');
    const ctAfter = (await request('GET', `/api/tasks/${ctId}`, null, m1r)).data.task;
    eq(ctAfter.status, 'submitted', 'status unchanged after 409 (already submitted)');
    console.log('  OK 409 task conflict preserved');
  }

  eq(after.inspectionList.inspections.length, before.inspectionList.inspections.length, 'inspection list count preserved');
  eq(after.inspection.inspection.status, before.inspection.inspection.status, 'inspection status preserved');
  eq(after.inspection.inspection.inspectorName, before.inspection.inspection.inspectorName, 'inspection inspectorName preserved');
  eq(after.inspection.inspection.items.length, before.inspection.inspection.items.length, 'inspection items count preserved');
  eq(after.inspectionsCsv, before.inspectionsCsv, 'inspections CSV identical');
  eq(JSON.stringify(after.inspectionsJson), JSON.stringify(before.inspectionsJson), 'inspections JSON identical');
  console.log('  OK inspection persistence verified');

  eq(after.repairOrderList.repairOrders.length, before.repairOrderList.repairOrders.length, 'repairOrder list count preserved');
  eq(after.repairOrder.repairOrder.status, before.repairOrder.repairOrder.status, 'repairOrder status preserved');
  eq(after.repairOrder.repairOrder.assigneeName, before.repairOrder.repairOrder.assigneeName, 'repairOrder assigneeName preserved');
  eq(after.repairOrder.repairOrder.statusHistory.length, before.repairOrder.repairOrder.statusHistory.length, 'repairOrder statusHistory length preserved');
  eq(after.repairOrder.repairOrder.statusHistory[after.repairOrder.repairOrder.statusHistory.length - 1].status, 'verified', 'repairOrder last status = verified');
  eq(after.repairOrdersCsv, before.repairOrdersCsv, 'repairOrders CSV identical');
  eq(JSON.stringify(after.repairOrdersJson), JSON.stringify(before.repairOrdersJson), 'repairOrders JSON identical');
  console.log('  OK repairOrder persistence verified');

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
