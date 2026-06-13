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

  console.log('=== Phase 1: Start fresh server, run main flow + error boundaries ===');
  await startServer();
  serverPidFirstRun = serverPid;
  console.log(`  Server PID=${serverPid}, data dir=${TEST_DATA_DIR}\n`);

  console.log('[1/6] All sample accounts login');
  const m1 = await login('manager1', 'manager123');
  const m2 = await login('manager2', 'manager123');
  const s1 = await login('staff1', 'staff123');
  const s2 = await login('staff2', 'staff123');
  const s3 = await login('staff3', 'staff123');
  const s4 = await login('staff4', 'staff123');
  console.log('  OK 6 accounts login\n');

  const cl = await request('GET', '/api/config/checklist', null, s1);
  const items = cl.data.checklist.map(c => ({ id: c.id, checked: true }));

  console.log('[2/6] Main flow: create -> handover -> confirm -> exceptions -> review -> handle/close exc -> close shift');
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

  console.log('[3/6] Error boundaries (status NOT corrupted on failure)');
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

  console.log('[4/6] CSV / JSON export');
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
  console.log();

  console.log('[5/6] Operation history');
  const hist = (await request('GET', '/api/history', null, m1)).data.history;
  const acts = hist.map(h => h.action);
  ['CREATE_SHIFT','HANDOVER_SHIFT','CONFIRM_SHIFT','CREATE_EXCEPTION','SUBMIT_REVIEW','HANDLE_EXCEPTION','CLOSE_EXCEPTION','CLOSE_SHIFT']
    .forEach(a => { if (!acts.includes(a)) throw new Error(`missing history action: ${a}`); });
  console.log(`  OK all 8 action types present (total=${hist.length})`);
  console.log();

  console.log('=== Phase 2: Snapshot, REAL restart (kill old PID, spawn new process), verify persistence ===');
  const before = {
    shift: (await request('GET', `/api/shifts/${sid}`, null, m1)).data,
    shiftsCsv: (await request('GET', '/api/export/shifts?storeId=S001&format=csv', null, m1)).data,
    shiftsJson: (await request('GET', '/api/export/shifts?storeId=S001&format=json', null, m1)).data,
    excCsv: (await request('GET', '/api/export/exceptions?storeId=S001&format=csv', null, m1)).data,
    excJson: (await request('GET', '/api/export/exceptions?storeId=S001&format=json', null, m1)).data,
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
  console.log(`  First-run PID=${serverPidFirstRun}, snapshot saved for shift=${sid}`);

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

  console.log('[6/6] Persistence after real restart');
  const after = {
    shift: (await request('GET', `/api/shifts/${sid}`, null, m1r)).data,
    shiftsCsv: (await request('GET', '/api/export/shifts?storeId=S001&format=csv', null, m1r)).data,
    shiftsJson: (await request('GET', '/api/export/shifts?storeId=S001&format=json', null, m1r)).data,
    excCsv: (await request('GET', '/api/export/exceptions?storeId=S001&format=csv', null, m1r)).data,
    excJson: (await request('GET', '/api/export/exceptions?storeId=S001&format=json', null, m1r)).data,
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
