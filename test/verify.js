const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3099;
const BASE = 'localhost';
const PROJECT_DIR = path.join(__dirname, '..');

let serverProc = null;
let serverPid = null;

function resetDataFiles() {
  fs.writeFileSync(path.join(PROJECT_DIR, 'data/shifts.json'), '[]\n');
  fs.writeFileSync(path.join(PROJECT_DIR, 'data/exceptions.json'), '[]\n');
  fs.writeFileSync(path.join(PROJECT_DIR, 'data/history.json'), '[]\n');
}

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT) };
    serverProc = spawn('node', ['server.js'], {
      cwd: PROJECT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    serverPid = serverProc.pid;
    console.log(`  [server] starting, pid=${serverPid}`);
    let started = false;
    const timeout = setTimeout(() => {
      if (!started) { reject(new Error('server start timeout')); }
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
    serverProc.on('exit', () => {
      if (!started) reject(new Error('server exited before start'));
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProc) return resolve();
    console.log(`  [server] stopping pid=${serverPid}`);
    serverProc.on('close', resolve);
    serverProc.kill('SIGTERM');
    setTimeout(() => {
      if (serverProc && !serverProc.killed) {
        serverProc.kill('SIGKILL');
      }
    }, 2000);
    serverProc = null;
    serverPid = null;
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
  console.log(`  OK ${m} -> ${r.data.error}`); }

(async () => {
  console.log('=== Phase 1: Start server and run main flow + error boundaries ===');
  await startServer();
  console.log(`  Server started on port ${PORT}, PID=${serverPid}\n`);

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

  console.log('[2/6] Main flow: create -> handover -> confirm -> exceptions -> review -> handle exc -> close exc -> close shift');
  const cr = await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'morning', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U004', checklistItems: items, note: 'main test'
  }, s1);
  eq(cr.status, 200, 'create shift');
  const sid = cr.data.shift.id;
  eq(cr.data.shift.status, 'draft', 'status after create');

  await request('POST', `/api/shifts/${sid}/handover`, {}, s1);
  eq((await request('GET', `/api/shifts/${sid}`, null, s1)).data.shift.status, 'handed_over', 'after handover');

  await request('POST', `/api/shifts/${sid}/confirm`, {}, s2);
  eq((await request('GET', `/api/shifts/${sid}`, null, s2)).data.shift.status, 'confirmed', 'after confirm');

  const e1 = await request('POST', '/api/exceptions', { shiftId: sid, type: 'cash', amount: -50, responsibleStaffId: 'U003', description: 'cash diff -50' }, s2);
  eq(e1.status, 200, 'register cash exception');
  const eid1 = e1.data.exception.id;
  const e2 = await request('POST', '/api/exceptions', { shiftId: sid, type: 'inventory', itemName: 'Coke', quantity: 3, responsibleStaffId: 'U003', description: 'stock shortage' }, s2);
  eq(e2.status, 200, 'register inventory exception');
  const eid2 = e2.data.exception.id;

  await request('POST', `/api/shifts/${sid}/submit-review`, {}, s2);
  eq((await request('GET', `/api/shifts/${sid}`, null, s2)).data.shift.status, 'reviewing', 'after submit-review');

  await request('POST', `/api/exceptions/${eid1}/handle`, { note: 'verified cash' }, m1);
  await request('POST', `/api/exceptions/${eid1}/close`, { note: 'resolved cash' }, m1);
  await request('POST', `/api/exceptions/${eid2}/handle`, { note: 'verified stock' }, m1);
  await request('POST', `/api/exceptions/${eid2}/close`, { note: 'resolved stock' }, m1);
  const el = (await request('GET', `/api/exceptions?shiftId=${sid}`, null, m1)).data.exceptions;
  eq(el.filter(e => e.status === 'closed').length, 2, '2 exceptions closed');

  await request('POST', `/api/shifts/${sid}/close`, { reviewNote: 'all good' }, m1);
  eq((await request('GET', `/api/shifts/${sid}`, null, m1)).data.shift.status, 'closed', 'shift closed');
  console.log();

  console.log('[3/6] Error boundaries (status must NOT be corrupted on failure)');
  const c2 = await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'evening', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U005', checklistItems: items, note: 'perm test'
  }, s1);
  const s2id = c2.data.shift.id;
  await request('POST', `/api/shifts/${s2id}/handover`, {}, s1);
  await request('POST', `/api/shifts/${s2id}/confirm`, {}, s3);
  await request('POST', `/api/shifts/${s2id}/submit-review`, {}, s3);
  err(await request('POST', `/api/shifts/${s2id}/close`, { reviewNote: 'x' }, s3), '权限不足', 'staff cannot close (403)');
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
  await request('POST', '/api/exceptions', { shiftId: s3id, type: 'cash', amount: 10, responsibleStaffId: 'U003', description: 'unresolved' }, s2);
  err(await request('POST', `/api/shifts/${s3id}/close`, { reviewNote: 'x' }, m1), '未关闭异常', 'close with unresolved rejected (400)');
  eq((await request('GET', `/api/shifts/${s3id}`, null, m1)).data.shift.status, 'reviewing', 'status unchanged after unresolved-fail');

  err(await request('POST', '/api/shifts', {
    storeId: 'S001', shiftType: 'morning', shiftDate: today,
    handoverStaffId: 'U003', receiveStaffId: 'U003', checklistItems: items, note: 'same test'
  }, s1), '不能为同一人', 'handover==receive rejected (400)');
  console.log();

  console.log('[4/6] Export (CSV + JSON for shifts + exceptions)');
  eq((await request('GET', '/api/export/shifts/csv?storeId=S001', null, m1)).status, 200, 'shifts CSV');
  eq((await request('GET', '/api/export/shifts/json?storeId=S001', null, m1)).status, 200, 'shifts JSON');
  eq((await request('GET', '/api/export/exceptions/csv?storeId=S001', null, m1)).status, 200, 'exceptions CSV');
  eq((await request('GET', '/api/export/exceptions/json?storeId=S001', null, m1)).status, 200, 'exceptions JSON');
  console.log();

  console.log('[5/6] History records');
  const hist = (await request('GET', '/api/history', null, m1)).data.history;
  const acts = hist.map(h => h.action);
  ['CREATE_SHIFT','HANDOVER_SHIFT','CONFIRM_SHIFT','CREATE_EXCEPTION','SUBMIT_REVIEW','HANDLE_EXCEPTION','CLOSE_EXCEPTION','CLOSE_SHIFT']
    .forEach(a => { if (!acts.includes(a)) throw new Error(`missing history: ${a}`); });
  console.log(`  OK all 8 action types present (total=${hist.length})`);
  console.log();

  console.log('=== Phase 2: Save snapshot, REALLY restart server, verify persistence ===');
  const before = {
    shift: (await request('GET', `/api/shifts/${sid}`, null, m1)).data,
    exceptions: (await request('GET', `/api/exceptions?shiftId=${sid}`, null, m1)).data.exceptions,
    history: (await request('GET', '/api/history', null, m1)).data.history,
    shiftsCsv: (await request('GET', '/api/export/shifts/csv?storeId=S001', null, m1)).data,
    shiftsJson: (await request('GET', '/api/export/shifts/json?storeId=S001', null, m1)).data,
    excCsv: (await request('GET', '/api/export/exceptions/csv?storeId=S001', null, m1)).data,
    excJson: (await request('GET', '/api/export/exceptions/json?storeId=S001', null, m1)).data,
  };
  console.log(`  Snapshot saved: shift=${before.shift.shift.id}, exc=${before.exceptions.length}, hist=${before.history.length}`);

  console.log();
  console.log('  Stopping server (real kill)...');
  await stopServer();
  await new Promise(r => setTimeout(r, 500));
  console.log('  Server stopped.');

  console.log('  Verifying data files on disk exist and match...');
  const diskShifts = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'data/shifts.json'), 'utf8'));
  const diskExc = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'data/exceptions.json'), 'utf8'));
  const diskHist = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'data/history.json'), 'utf8'));
  eq(diskShifts.length, 3, `disk shifts count = 3`);
  eq(diskExc.length >= 3, true, `disk exceptions >= 3 (got ${diskExc.length})`);
  eq(diskHist.length >= 15, true, `disk history >= 15 (got ${diskHist.length})`);
  const mainShift = diskShifts.find(s => s.id === sid);
  eq(mainShift.status, 'closed', 'main shift status on disk = closed');
  eq(mainShift.reviewNote, 'all good', 'main shift reviewNote on disk = all good');

  console.log();
  console.log('  Restarting server (real start, fresh process)...');
  await startServer();
  console.log(`  Server restarted on port ${PORT}, new PID=${serverPid}\n`);

  console.log('[6/6] Persistence check after real restart');
  const after = {
    shift: (await request('GET', `/api/shifts/${sid}`, null, m1)).data,
    exceptions: (await request('GET', `/api/exceptions?shiftId=${sid}`, null, m1)).data.exceptions,
    history: (await request('GET', '/api/history', null, m1)).data.history,
    shiftsCsv: (await request('GET', '/api/export/shifts/csv?storeId=S001', null, m1)).data,
    shiftsJson: (await request('GET', '/api/export/shifts/json?storeId=S001', null, m1)).data,
    excCsv: (await request('GET', '/api/export/exceptions/csv?storeId=S001', null, m1)).data,
    excJson: (await request('GET', '/api/export/exceptions/json?storeId=S001', null, m1)).data,
  };

  eq(after.shift.shift.status, before.shift.shift.status, 'shift status preserved');
  eq(after.shift.shift.reviewNote, before.shift.shift.reviewNote, 'shift reviewNote preserved');
  eq(after.shift.shift.reviewedByName, before.shift.shift.reviewedByName, 'shift reviewedByName preserved');
  eq(after.exceptions.length, before.exceptions.length, 'exception count preserved');
  eq(after.exceptions[0].status, before.exceptions[0].status, 'exc 0 status preserved');
  eq(after.exceptions[0].responsibleStaffName, before.exceptions[0].responsibleStaffName, 'exc 0 responsible name preserved');
  eq(after.exceptions[1].status, before.exceptions[1].status, 'exc 1 status preserved');
  eq(after.exceptions[1].description, before.exceptions[1].description, 'exc 1 description preserved');
  eq(after.history.length, before.history.length, 'history count preserved');
  const actsBefore = before.history.map(h => h.action).sort().join(',');
  const actsAfter = after.history.map(h => h.action).sort().join(',');
  eq(actsAfter, actsBefore, 'history action types preserved');
  eq(after.shiftsCsv, before.shiftsCsv, 'shifts CSV identical');
  eq(JSON.stringify(after.shiftsJson), JSON.stringify(before.shiftsJson), 'shifts JSON identical');
  eq(after.excCsv, before.excCsv, 'exceptions CSV identical');
  eq(JSON.stringify(after.excJson), JSON.stringify(before.excJson), 'exceptions JSON identical');

  console.log();
  console.log('=== Cleanup: stop test server, reset data files ===');
  await stopServer();
  fs.writeFileSync(path.join(PROJECT_DIR, 'data/shifts.json'), '[]\n');
  fs.writeFileSync(path.join(PROJECT_DIR, 'data/exceptions.json'), '[]\n');
  fs.writeFileSync(path.join(PROJECT_DIR, 'data/history.json'), '[]\n');
  console.log('  Data files reset to empty arrays.');

  console.log('\n====================');
  console.log('  ALL TESTS PASSED');
  console.log('====================');
})().catch(async (e) => {
  console.error('\n❌ VERIFY FAILED:', e.message);
  if (serverProc) { try { serverProc.kill('SIGKILL'); } catch {} }
  process.exit(1);
});
