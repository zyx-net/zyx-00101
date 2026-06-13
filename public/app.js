const API = {
  async get(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败: ${r.status}`);
    return data;
  },
  async post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败: ${r.status}`);
    return data;
  }
};

const STATUS_MAP = {
  draft: { label: '草稿', cls: 'badge-draft' },
  handed_over: { label: '待确认', cls: 'badge-handed_over' },
  confirmed: { label: '已确认', cls: 'badge-confirmed' },
  reviewing: { label: '复核中', cls: 'badge-reviewing' },
  closed: { label: '已关闭', cls: 'badge-closed' },
  returned: { label: '已退回', cls: 'badge-returned' }
};

const EX_STATUS_MAP = {
  open: { label: '待处理', cls: 'badge-open' },
  handled: { label: '已处理', cls: 'badge-handled' },
  closed: { label: '已关闭', cls: 'badge-closed' }
};

const TASK_STATUS_MAP = {
  pending: { label: '待分派', cls: 'badge-task-pending' },
  assigned: { label: '已分派', cls: 'badge-task-assigned' },
  submitted: { label: '已提交', cls: 'badge-task-submitted' },
  rejected: { label: '已驳回', cls: 'badge-task-rejected' },
  closed: { label: '已关闭', cls: 'badge-task-closed' }
};

const DEVICE_STATUS_MAP = {
  normal: { label: '正常', cls: 'badge-normal' },
  fault: { label: '故障', cls: 'badge-fault' },
  maintenance: { label: '维护中', cls: 'badge-maintenance' },
  scrapped: { label: '已报废', cls: 'badge-scrapped' }
};

const INSPECTION_STATUS_MAP = {
  draft: { label: '草稿', cls: 'badge-draft' },
  submitted: { label: '已提交', cls: 'badge-submitted' },
  converted: { label: '已转维修', cls: 'badge-converted' }
};

const REPAIR_STATUS_MAP = {
  reported: { label: '已报修', cls: 'badge-reported' },
  accepted: { label: '已接单', cls: 'badge-accepted' },
  completed: { label: '已完成', cls: 'badge-completed' },
  verified: { label: '已验收', cls: 'badge-verified' },
  rejected: { label: '已退回', cls: 'badge-rejected' }
};

const ACTION_MAP = {
  CREATE_SHIFT: '创建班次',
  HANDOVER_SHIFT: '提交交接',
  CONFIRM_SHIFT: '确认交接',
  SUBMIT_REVIEW: '提交复核',
  CLOSE_SHIFT: '关闭班次',
  RETURN_SHIFT: '退回班次',
  CREATE_EXCEPTION: '登记异常',
  HANDLE_EXCEPTION: '处理异常',
  CLOSE_EXCEPTION: '关闭异常',
  CREATE_TASK: '发起整改',
  ASSIGN_TASK: '分派整改',
  SUBMIT_TASK: '提交整改',
  ACCEPT_TASK: '验收整改',
  REJECT_TASK: '驳回整改',
  CREATE_DEVICE: '创建设备',
  UPDATE_DEVICE: '修改设备',
  DELETE_DEVICE: '删除设备',
  IMPORT_DEVICE: '导入设备',
  CREATE_TEMPLATE: '创建巡检模板',
  UPDATE_TEMPLATE: '修改巡检模板',
  DELETE_TEMPLATE: '删除巡检模板',
  CREATE_INSPECTION: '创建巡检单',
  SUBMIT_INSPECTION: '提交巡检单',
  CREATE_REPAIR: '转报修',
  ASSIGN_REPAIR: '分派维修',
  COMPLETE_REPAIR: '完成维修',
  VERIFY_REPAIR: '验收维修',
  REJECT_REPAIR: '退回维修'
};

let state = {
  user: null,
  stores: [],
  checklist: [],
  users: [],
  page: 'dashboard',
  modal: null
};

const app = document.getElementById('app');

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') el.className = attrs[k];
    else if (k === 'html') el.innerHTML = attrs[k];
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (k === 'value') el.value = attrs[k];
    else if (k === 'checked') el.checked = attrs[k];
    else if (k === 'disabled') el.disabled = attrs[k];
    else if (k === 'selected') el.selected = attrs[k];
    else el.setAttribute(k, attrs[k]);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null || c === false) return;
    if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  });
  return el;
}

function toast(msg, type = 'error') {
  const t = h('div', { class: 'alert alert-' + type, style: 'position:fixed;top:20px;right:20px;z-index:1000;min-width:260px;box-shadow:0 4px 12px rgba(0,0,0,0.15);' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function formatDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch { return iso; }
}

async function fetchUsers() {
  try {
    const r = await API.get('/api/config/users');
    return r.users;
  } catch { return []; }
}

async function bootstrap() {
  try {
    const me = await API.get('/api/me');
    state.user = me.user;
  } catch (e) { state.user = null; }

  if (state.user) {
    try {
      const [s, c] = await Promise.all([
        API.get('/api/config/stores'),
        API.get('/api/config/checklist')
      ]);
      state.stores = s.stores;
      state.checklist = c.checklist;
      state.users = await fetchUsers();
    } catch (e) { console.error(e); }
  }
  render();
}

function render() {
  app.innerHTML = '';
  if (!state.user) {
    app.appendChild(renderLogin());
    return;
  }
  app.appendChild(renderLayout());
  if (state.modal) {
    app.appendChild(renderModal());
  }
}

function renderLogin() {
  const wrapper = h('div', { class: 'login-wrapper' });
  const box = h('div', { class: 'login-box' });
  box.appendChild(h('h1', {}, '门店交接班异常追踪'));
  box.appendChild(h('p', { class: 'subtitle' }, '便利店早中晚班交接管理系统'));
  const form = h('form', {});
  const uGroup = h('div', { class: 'form-group' });
  uGroup.appendChild(h('label', {}, '用户名'));
  const uInput = h('input', { type: 'text', placeholder: '请输入用户名', required: 'required' });
  uGroup.appendChild(uInput);
  form.appendChild(uGroup);
  const pGroup = h('div', { class: 'form-group' });
  pGroup.appendChild(h('label', {}, '密码'));
  const pInput = h('input', { type: 'password', placeholder: '请输入密码', required: 'required' });
  pGroup.appendChild(pInput);
  form.appendChild(pGroup);
  const btn = h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%;margin-top:8px;' }, '登录');
  form.appendChild(btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await API.post('/api/login', { username: uInput.value, password: pInput.value });
      state.user = r.user;
      const [s, c] = await Promise.all([
        API.get('/api/config/stores'),
        API.get('/api/config/checklist')
      ]);
      state.stores = s.stores;
      state.checklist = c.checklist;
      state.users = await fetchUsers();
      toast('登录成功', 'success');
      render();
    } catch (err) {
      toast(err.message);
    }
  });
  box.appendChild(form);
  wrapper.appendChild(box);
  return wrapper;
}

function renderLayout() {
  const layout = h('div', { class: 'app-layout' });
  layout.appendChild(renderSidebar());
  const main = h('div', { class: 'main-content' });
  let pageContent;
  switch (state.page) {
    case 'dashboard': pageContent = renderDashboard(); break;
    case 'shifts': pageContent = renderShifts(); break;
    case 'exceptions': pageContent = renderExceptions(); break;
    case 'tasks': pageContent = renderTasks(); break;
    case 'devices': pageContent = renderDevices(); break;
    case 'templates': pageContent = renderTemplates(); break;
    case 'inspections': pageContent = renderInspections(); break;
    case 'repair-orders': pageContent = renderRepairOrders(); break;
    case 'history': pageContent = renderHistory(); break;
    default: pageContent = renderDashboard();
  }
  main.appendChild(pageContent);
  layout.appendChild(main);
  return layout;
}

function renderSidebar() {
  const side = h('div', { class: 'sidebar' });
  const brand = h('div', { class: 'brand' });
  brand.appendChild(h('h2', {}, '交接班系统'));
  brand.appendChild(h('p', {}, 'Shift Tracker v1.0'));
  side.appendChild(brand);
  const nav = h('nav', {});
  const menus = [
    { key: 'dashboard', label: '工作台' },
    { key: 'shifts', label: '班次管理' },
    { key: 'exceptions', label: '异常管理' },
    { key: 'tasks', label: '整改任务' },
    { key: 'devices', label: '设备管理' },
    { key: 'templates', label: '巡检模板' },
    { key: 'inspections', label: '巡检管理' },
    { key: 'repair-orders', label: '维修单' },
    { key: 'history', label: '操作历史' }
  ];
  menus.forEach(m => {
    const a = h('a', {
      class: state.page === m.key ? 'active' : '',
      onclick: () => { state.page = m.key; render(); }
    }, m.label);
    nav.appendChild(a);
  });
  side.appendChild(nav);
  const info = h('div', { class: 'user-info' });
  info.appendChild(h('div', { class: 'name' }, state.user.name));
  info.appendChild(h('div', { class: 'role' }, state.user.role === 'manager' ? '店长' : '员工'));
  const logout = h('button', {
    class: 'btn btn-outline btn-sm logout-btn',
    onclick: async () => {
      await API.post('/api/logout');
      state.user = null;
      render();
    }
  }, '退出登录');
  info.appendChild(logout);
  side.appendChild(info);
  return side;
}

function renderDashboard() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'page-header' }, h('h1', {}, '工作台')));
  const statWrap = h('div', { class: 'stat-cards' });
  wrap.appendChild(statWrap);

  const card = h('div', { class: 'card' });
  card.appendChild(h('h3', {}, '快速操作'));
  const quickBtns = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;' });
  quickBtns.appendChild(h('button', {
    class: 'btn btn-primary',
    onclick: () => openCreateShift()
  }, '+ 创建班次'));
  quickBtns.appendChild(h('button', {
    class: 'btn btn-outline',
    onclick: () => { state.page = 'shifts'; render(); }
  }, '查看班次列表'));
  quickBtns.appendChild(h('button', {
    class: 'btn btn-outline',
    onclick: () => { state.page = 'exceptions'; render(); }
  }, '查看异常列表'));
  card.appendChild(quickBtns);
  wrap.appendChild(card);

  const recentCard = h('div', { class: 'card' });
  recentCard.appendChild(h('h3', {}, '最近操作记录'));
  const recentBody = h('div', {}, h('div', { class: 'empty-state' }, '加载中...'));
  recentCard.appendChild(recentBody);
  wrap.appendChild(recentCard);

  (async () => {
    try {
      const [shiftsR, exR] = await Promise.all([
        API.get('/api/shifts'),
        API.get('/api/exceptions')
      ]);
      const shifts = shiftsR.shifts;
      const exs = exR.exceptions;
      const openEx = exs.filter(e => e.status === 'open').length;
      const reviewingShifts = shifts.filter(s => s.status === 'reviewing').length;
      const today = new Date().toISOString().slice(0, 10);
      const todayShifts = shifts.filter(s => s.shiftDate === today).length;
      const closedShifts = shifts.filter(s => s.status === 'closed').length;
      const stats = [
        { label: '今日班次', value: todayShifts },
        { label: '复核中班次', value: reviewingShifts },
        { label: '待处理异常', value: openEx },
        { label: '已关闭班次', value: closedShifts }
      ];
      statWrap.innerHTML = '';
      stats.forEach(s => {
        const c = h('div', { class: 'stat-card' });
        c.appendChild(h('div', { class: 'stat-label' }, s.label));
        c.appendChild(h('div', { class: 'stat-value' }, String(s.value)));
        statWrap.appendChild(c);
      });
    } catch (e) { toast(e.message); }

    try {
      const r = await API.get('/api/history');
      const recent = r.history.slice(0, 10);
      recentBody.innerHTML = '';
      if (recent.length === 0) {
        recentBody.appendChild(h('div', { class: 'empty-state' }, '暂无操作记录'));
      } else {
        recent.forEach(item => {
          const hi = h('div', { class: 'history-item' });
          hi.appendChild(h('div', { class: 'hi-time' }, formatDate(item.timestamp)));
          hi.appendChild(h('div', { class: 'hi-action' }, ACTION_MAP[item.action] || item.action));
          hi.appendChild(h('div', { class: 'hi-user' }, item.userName));
          hi.appendChild(h('div', { class: 'hi-detail' }, item.detail));
          recentBody.appendChild(hi);
        });
      }
    } catch (e) { toast(e.message); }
  })();

  return wrap;
}

function renderShifts() {
  const wrap = h('div', {});
  const header = h('div', { class: 'page-header' });
  header.appendChild(h('h1', {}, '班次管理'));
  const actions = h('div', { class: 'actions' });
  actions.appendChild(h('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => exportData('shifts', 'csv')
  }, '导出CSV'));
  actions.appendChild(h('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => exportData('shifts', 'json')
  }, '导出JSON'));
  actions.appendChild(h('button', {
    class: 'btn btn-primary btn-sm',
    onclick: () => openCreateShift()
  }, '+ 创建班次'));
  header.appendChild(actions);
  wrap.appendChild(header);

  const filter = h('div', { class: 'card' });
  const fb = h('div', { class: 'filter-bar' });

  const storeGroup = h('div', { class: 'form-group' });
  storeGroup.appendChild(h('label', {}, '门店'));
  const storeSel = h('select', {});
  storeSel.appendChild(h('option', { value: '' }, '全部'));
  state.stores.forEach(s => {
    const opt = h('option', { value: s.id }, s.name);
    if (state.user.role === 'staff' && s.id === state.user.storeId) opt.selected = true;
    storeSel.appendChild(opt);
  });
  if (state.user.role === 'staff') storeSel.disabled = true;
  storeGroup.appendChild(storeSel);
  fb.appendChild(storeGroup);

  const dateGroup = h('div', { class: 'form-group' });
  dateGroup.appendChild(h('label', {}, '日期'));
  const dateInput = h('input', { type: 'date' });
  dateGroup.appendChild(dateInput);
  fb.appendChild(dateGroup);

  const statusGroup = h('div', { class: 'form-group' });
  statusGroup.appendChild(h('label', {}, '状态'));
  const statusSel = h('select', {});
  statusSel.appendChild(h('option', { value: '' }, '全部'));
  Object.entries(STATUS_MAP).forEach(([k, v]) => {
    statusSel.appendChild(h('option', { value: k }, v.label));
  });
  statusGroup.appendChild(statusSel);
  fb.appendChild(statusGroup);

  const queryBtn = h('button', { class: 'btn btn-primary btn-sm' }, '查询');
  fb.appendChild(queryBtn);
  const resetBtn = h('button', { class: 'btn btn-outline btn-sm' }, '重置');
  fb.appendChild(resetBtn);
  filter.appendChild(fb);
  wrap.appendChild(filter);

  const listCard = h('div', { class: 'card' });
  const tbody = h('tbody', {});
  const emptyRow = h('tr', {}, h('td', { colspan: '9', style: 'text-align:center;padding:40px;color:#6b7280;' }, '加载中...'));
  tbody.appendChild(emptyRow);
  const table = h('table', {}, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '班次ID'),
      h('th', {}, '门店'),
      h('th', {}, '日期'),
      h('th', {}, '类型'),
      h('th', {}, '交班人'),
      h('th', {}, '接班人'),
      h('th', {}, '状态'),
      h('th', {}, '创建时间'),
      h('th', {}, '操作')
    ])),
    tbody
  ]);
  listCard.appendChild(table);
  wrap.appendChild(listCard);

  async function loadData() {
    try {
      const params = new URLSearchParams();
      if (storeSel.value) params.set('storeId', storeSel.value);
      if (dateInput.value) params.set('date', dateInput.value);
      if (statusSel.value) params.set('status', statusSel.value);
      const url = '/api/shifts' + (params.toString() ? '?' + params.toString() : '');
      const r = await API.get(url);
      tbody.innerHTML = '';
      if (r.shifts.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: '9', style: 'text-align:center;padding:40px;color:#6b7280;' }, '暂无数据')));
        return;
      }
      r.shifts.forEach(s => {
        const store = state.stores.find(x => x.id === s.storeId);
        const st = STATUS_MAP[s.status] || { label: s.status, cls: '' };
        const tr = h('tr', {}, [
          h('td', {}, s.id),
          h('td', {}, store ? store.name : s.storeId),
          h('td', {}, s.shiftDate),
          h('td', {}, s.shiftType),
          h('td', {}, s.handoverStaffName),
          h('td', {}, s.receiveStaffName),
          h('td', {}, h('span', { class: 'badge ' + st.cls }, st.label)),
          h('td', {}, formatDate(s.createdAt)),
          h('td', {}, h('button', {
            class: 'btn btn-outline btn-sm',
            onclick: () => openShiftDetail(s.id)
          }, '详情'))
        ]);
        tbody.appendChild(tr);
      });
    } catch (e) { toast(e.message); }
  }

  queryBtn.onclick = loadData;
  resetBtn.onclick = () => {
    storeSel.value = state.user.role === 'staff' ? state.user.storeId : '';
    dateInput.value = '';
    statusSel.value = '';
    loadData();
  };
  setTimeout(loadData, 0);

  return wrap;
}

function renderExceptions() {
  const wrap = h('div', {});
  const header = h('div', { class: 'page-header' });
  header.appendChild(h('h1', {}, '异常管理'));
  const actions = h('div', { class: 'actions' });
  actions.appendChild(h('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => exportData('exceptions', 'csv')
  }, '导出CSV'));
  actions.appendChild(h('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => exportData('exceptions', 'json')
  }, '导出JSON'));
  header.appendChild(actions);
  wrap.appendChild(header);

  const filter = h('div', { class: 'card' });
  const fb = h('div', { class: 'filter-bar' });

  const storeGroup = h('div', { class: 'form-group' });
  storeGroup.appendChild(h('label', {}, '门店'));
  const storeSel = h('select', {});
  storeSel.appendChild(h('option', { value: '' }, '全部'));
  state.stores.forEach(s => {
    const opt = h('option', { value: s.id }, s.name);
    if (state.user.role === 'staff' && s.id === state.user.storeId) opt.selected = true;
    storeSel.appendChild(opt);
  });
  if (state.user.role === 'staff') storeSel.disabled = true;
  storeGroup.appendChild(storeSel);
  fb.appendChild(storeGroup);

  const dateGroup = h('div', { class: 'form-group' });
  dateGroup.appendChild(h('label', {}, '日期'));
  const dateInput = h('input', { type: 'date' });
  dateGroup.appendChild(dateInput);
  fb.appendChild(dateGroup);

  const statusGroup = h('div', { class: 'form-group' });
  statusGroup.appendChild(h('label', {}, '状态'));
  const statusSel = h('select', {});
  statusSel.appendChild(h('option', { value: '' }, '全部'));
  Object.entries(EX_STATUS_MAP).forEach(([k, v]) => {
    statusSel.appendChild(h('option', { value: k }, v.label));
  });
  statusGroup.appendChild(statusSel);
  fb.appendChild(statusGroup);

  const queryBtn = h('button', { class: 'btn btn-primary btn-sm' }, '查询');
  fb.appendChild(queryBtn);
  filter.appendChild(fb);
  wrap.appendChild(filter);

  const listCard = h('div', { class: 'card' });
  const tbody = h('tbody', {});
  tbody.appendChild(h('tr', {}, h('td', { colspan: '9', style: 'text-align:center;padding:40px;color:#6b7280;' }, '加载中...')));
  const table = h('table', {}, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '异常ID'),
      h('th', {}, '类型'),
      h('th', {}, '品项'),
      h('th', {}, '金额/数量'),
      h('th', {}, '责任人'),
      h('th', {}, '状态'),
      h('th', {}, '登记人'),
      h('th', {}, '登记时间'),
      h('th', {}, '操作')
    ])),
    tbody
  ]);
  listCard.appendChild(table);
  wrap.appendChild(listCard);

  async function loadData() {
    try {
      const params = new URLSearchParams();
      if (storeSel.value) params.set('storeId', storeSel.value);
      if (dateInput.value) params.set('date', dateInput.value);
      if (statusSel.value) params.set('status', statusSel.value);
      const url = '/api/exceptions' + (params.toString() ? '?' + params.toString() : '');
      const r = await API.get(url);
      tbody.innerHTML = '';
      if (r.exceptions.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: '9', style: 'text-align:center;padding:40px;color:#6b7280;' }, '暂无数据')));
        return;
      }
      r.exceptions.forEach(e => {
        const st = EX_STATUS_MAP[e.status] || { label: e.status, cls: '' };
        const typeBadge = e.type === 'cash'
          ? h('span', { class: 'badge badge-cash' }, '现金差额')
          : h('span', { class: 'badge badge-stock' }, '库存短缺');
        const ops = h('td', {});
        if (e.status === 'open') {
          ops.appendChild(h('button', {
            class: 'btn btn-success btn-sm',
            onclick: () => openHandleException(e.id)
          }, '处理'));
        }
        if (e.status === 'handled' && state.user.role === 'manager') {
          ops.appendChild(h('button', {
            class: 'btn btn-primary btn-sm',
            onclick: () => openCloseException(e.id)
          }, '关闭'));
        }
        const tr = h('tr', {}, [
          h('td', {}, e.id),
          h('td', {}, typeBadge),
          h('td', {}, e.itemName || '-'),
          h('td', {}, e.amount ? String(e.amount) : '-'),
          h('td', {}, e.responsibleStaffName || '-'),
          h('td', {}, h('span', { class: 'badge ' + st.cls }, st.label)),
          h('td', {}, e.createdByName || '-'),
          h('td', {}, formatDate(e.createdAt)),
          ops
        ]);
        tbody.appendChild(tr);
      });
    } catch (e) { toast(e.message); }
  }
  queryBtn.onclick = loadData;
  setTimeout(loadData, 0);

  return wrap;
}

function renderHistory() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'page-header' }, h('h1', {}, '操作历史')));
  const card = h('div', { class: 'card' }, h('div', { class: 'empty-state' }, '加载中...'));
  wrap.appendChild(card);

  API.get('/api/history').then(r => {
    card.innerHTML = '';
    if (r.history.length === 0) {
      card.appendChild(h('div', { class: 'empty-state' }, '暂无操作记录'));
      return;
    }
    r.history.forEach(item => {
      const hi = h('div', { class: 'history-item' });
      hi.appendChild(h('div', { class: 'hi-time' }, formatDate(item.timestamp)));
      hi.appendChild(h('div', { class: 'hi-action' }, ACTION_MAP[item.action] || item.action));
      hi.appendChild(h('div', { class: 'hi-user' }, item.userName));
      hi.appendChild(h('div', { class: 'hi-detail' }, item.detail + (item.shiftId ? ' [' + item.shiftId + ']' : '')));
      card.appendChild(hi);
    });
  }).catch(e => toast(e.message));
  return wrap;
}

function renderTasks() {
  const wrap = h('div', {});
  const header = h('div', { class: 'page-header' });
  header.appendChild(h('h1', {}, '整改任务'));
  const actions = h('div', { class: 'actions' });
  actions.appendChild(h('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => exportData('tasks', 'csv')
  }, '导出CSV'));
  actions.appendChild(h('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => exportData('tasks', 'json')
  }, '导出JSON'));
  header.appendChild(actions);
  wrap.appendChild(header);

  const filter = h('div', { class: 'card' });
  const fb = h('div', { class: 'filter-bar' });

  const storeGroup = h('div', { class: 'form-group' });
  storeGroup.appendChild(h('label', {}, '门店'));
  const storeSel = h('select', {});
  storeSel.appendChild(h('option', { value: '' }, '全部'));
  state.stores.forEach(s => {
    const opt = h('option', { value: s.id }, s.name);
    if (state.user.role === 'staff' && s.id === state.user.storeId) opt.selected = true;
    storeSel.appendChild(opt);
  });
  if (state.user.role === 'staff') storeSel.disabled = true;
  storeGroup.appendChild(storeSel);
  fb.appendChild(storeGroup);

  const statusGroup = h('div', { class: 'form-group' });
  statusGroup.appendChild(h('label', {}, '状态'));
  const statusSel = h('select', {});
  statusSel.appendChild(h('option', { value: '' }, '全部'));
  Object.entries(TASK_STATUS_MAP).forEach(([k, v]) => {
    statusSel.appendChild(h('option', { value: k }, v.label));
  });
  statusGroup.appendChild(statusSel);
  fb.appendChild(statusGroup);

  const mineGroup = h('div', { class: 'form-group' });
  mineGroup.appendChild(h('label', {}, '范围'));
  const mineSel = h('select', {});
  mineSel.appendChild(h('option', { value: '' }, '全部'));
  mineSel.appendChild(h('option', { value: '1' }, '待我处理'));
  mineGroup.appendChild(mineSel);
  fb.appendChild(mineGroup);

  const queryBtn = h('button', { class: 'btn btn-primary btn-sm' }, '查询');
  fb.appendChild(queryBtn);
  const resetBtn = h('button', { class: 'btn btn-outline btn-sm' }, '重置');
  fb.appendChild(resetBtn);
  filter.appendChild(fb);
  wrap.appendChild(filter);

  const listCard = h('div', { class: 'card' });
  const tbody = h('tbody', {});
  tbody.appendChild(h('tr', {}, h('td', { colspan: '9', style: 'text-align:center;padding:40px;color:#6b7280;' }, '加载中...')));
  const table = h('table', {}, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '任务ID'),
      h('th', {}, '标题'),
      h('th', {}, '责任人'),
      h('th', {}, '截止时间'),
      h('th', {}, '状态'),
      h('th', {}, '发起人'),
      h('th', {}, '创建时间'),
      h('th', {}, '操作')
    ])),
    tbody
  ]);
  listCard.appendChild(table);
  wrap.appendChild(listCard);

  async function loadData() {
    try {
      const params = new URLSearchParams();
      if (storeSel.value) params.set('storeId', storeSel.value);
      if (statusSel.value) params.set('status', statusSel.value);
      if (mineSel.value) params.set('mine', mineSel.value);
      const url = '/api/tasks' + (params.toString() ? '?' + params.toString() : '');
      const r = await API.get(url);
      tbody.innerHTML = '';
      if (r.tasks.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: '9', style: 'text-align:center;padding:40px;color:#6b7280;' }, '暂无数据')));
        return;
      }
      r.tasks.forEach(t => {
        const st = TASK_STATUS_MAP[t.status] || { label: t.status, cls: '' };
        const tr = h('tr', {}, [
          h('td', {}, t.id),
          h('td', {}, t.title || '-'),
          h('td', {}, t.assigneeName || '-'),
          h('td', {}, t.deadline || '-'),
          h('td', {}, h('span', { class: 'badge ' + st.cls }, st.label)),
          h('td', {}, t.createdByName || '-'),
          h('td', {}, formatDate(t.createdAt)),
          h('td', {}, h('button', {
            class: 'btn btn-outline btn-sm',
            onclick: () => openTaskDetail(t.id)
          }, '详情'))
        ]);
        tbody.appendChild(tr);
      });
    } catch (e) { toast(e.message); }
  }
  queryBtn.onclick = loadData;
  resetBtn.onclick = () => {
    storeSel.value = state.user.role === 'staff' ? state.user.storeId : '';
    statusSel.value = '';
    mineSel.value = '';
    loadData();
  };
  setTimeout(loadData, 0);

  return wrap;
}

function openCreateShift() {
  state.modal = { type: 'createShift' };
  render();
}

function openShiftDetail(id) {
  state.modal = { type: 'shiftDetail', shiftId: id };
  render();
}

function openHandleException(id, backToShift) {
  state.modal = { type: 'handleException', exceptionId: id, backToShift: backToShift || null };
  render();
}

function openCloseException(id, backToShift) {
  state.modal = { type: 'closeException', exceptionId: id, backToShift: backToShift || null };
  render();
}

function openCreateTask(exceptionId, backToShift) {
  state.modal = { type: 'createTask', exceptionId, backToShift: backToShift || null };
  render();
}

function openTaskDetail(id) {
  state.modal = { type: 'taskDetail', taskId: id };
  render();
}

function renderModal() {
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) closeModal(); } });
  const modal = h('div', { class: 'modal' });
  let content;
  switch (state.modal.type) {
    case 'createShift': content = renderCreateShiftModal(); break;
    case 'shiftDetail': content = renderShiftDetailModal(); break;
    case 'handleException': content = renderHandleExceptionModal(); break;
    case 'closeException': content = renderCloseExceptionModal(); break;
    case 'createTask': content = renderCreateTaskModal(); break;
    case 'taskDetail': content = renderTaskDetailModal(); break;
    case 'createDevice': content = renderCreateDeviceModal(); break;
    case 'deviceDetail': content = renderDeviceDetailModal(); break;
    case 'importDevice': content = renderImportDeviceModal(); break;
    case 'createTemplate': content = renderCreateTemplateModal(); break;
    case 'templateDetail': content = renderTemplateDetailModal(); break;
    case 'createInspection': content = renderCreateInspectionModal(); break;
    case 'inspectionDetail': content = renderInspectionDetailModal(); break;
    case 'repairOrderDetail': content = renderRepairOrderDetailModal(); break;
    default: content = h('div', {}, '未知');
  }
  modal.appendChild(content);
  overlay.appendChild(modal);
  return overlay;
}

function closeModal() {
  state.modal = null;
  render();
}

function renderCreateShiftModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [
    h('h2', {}, '创建班次'),
    h('button', { class: 'modal-close', onclick: closeModal }, '×')
  ]));
  const body = h('div', { class: 'modal-body' });

  const row1 = h('div', { class: 'row' });
  const storeGroup = h('div', { class: 'form-group' });
  storeGroup.appendChild(h('label', {}, '门店'));
  const storeSel = h('select', { required: 'required' });
  state.stores.forEach(s => {
    const opt = h('option', { value: s.id }, s.name);
    if (state.user.role === 'staff' && s.id === state.user.storeId) opt.selected = true;
    storeSel.appendChild(opt);
  });
  if (state.user.role === 'staff') storeSel.disabled = true;
  storeGroup.appendChild(storeSel);
  row1.appendChild(storeGroup);

  const typeGroup = h('div', { class: 'form-group' });
  typeGroup.appendChild(h('label', {}, '班次类型'));
  const typeSel = h('select', { required: 'required' });
  ['早班', '中班', '晚班', '日班'].forEach(t => typeSel.appendChild(h('option', { value: t }, t)));
  typeGroup.appendChild(typeSel);
  row1.appendChild(typeGroup);
  body.appendChild(row1);

  const row2 = h('div', { class: 'row' });
  const dateGroup = h('div', { class: 'form-group' });
  dateGroup.appendChild(h('label', {}, '交接日期'));
  const dateInput = h('input', { type: 'date', required: 'required', value: new Date().toISOString().slice(0, 10) });
  dateGroup.appendChild(dateInput);
  row2.appendChild(dateGroup);
  body.appendChild(row2);

  function getStoreUsers() {
    const sid = state.user.role === 'staff' ? state.user.storeId : storeSel.value;
    return state.users.filter(u => u.storeId === sid);
  }

  const row3 = h('div', { class: 'row' });
  const hGroup = h('div', { class: 'form-group' });
  hGroup.appendChild(h('label', {}, '交班人'));
  const hSel = h('select', { required: 'required' });
  hSel.appendChild(h('option', { value: '' }, '请选择'));
  getStoreUsers().forEach(u => hSel.appendChild(h('option', { value: u.id }, u.name + ' (' + (u.role === 'manager' ? '店长' : '员工') + ')')));
  hGroup.appendChild(hSel);
  row3.appendChild(hGroup);

  const rGroup = h('div', { class: 'form-group' });
  rGroup.appendChild(h('label', {}, '接班人'));
  const rSel = h('select', { required: 'required' });
  rSel.appendChild(h('option', { value: '' }, '请选择'));
  getStoreUsers().forEach(u => rSel.appendChild(h('option', { value: u.id }, u.name + ' (' + (u.role === 'manager' ? '店长' : '员工') + ')')));
  rGroup.appendChild(rSel);
  row3.appendChild(rGroup);
  body.appendChild(row3);

  storeSel.addEventListener('change', () => {
    hSel.innerHTML = ''; rSel.innerHTML = '';
    hSel.appendChild(h('option', { value: '' }, '请选择'));
    rSel.appendChild(h('option', { value: '' }, '请选择'));
    getStoreUsers().forEach(u => {
      hSel.appendChild(h('option', { value: u.id }, u.name + ' (' + (u.role === 'manager' ? '店长' : '员工') + ')'));
      rSel.appendChild(h('option', { value: u.id }, u.name + ' (' + (u.role === 'manager' ? '店长' : '员工') + ')'));
    });
  });

  const clCard = h('div', { style: 'margin:12px 0;' });
  clCard.appendChild(h('label', { style: 'font-size:13px;font-weight:500;color:#374151;' }, '交接清单'));
  const grid = h('div', { class: 'checklist-grid' });
  const clInputs = [];
  state.checklist.forEach(ci => {
    const item = h('div', { class: 'checklist-item' });
    const cbWrap = h('label', { style: 'cursor:pointer;' });
    const cb = h('input', { type: 'checkbox' });
    cbWrap.appendChild(cb);
    const nameEl = h('div', { class: 'ci-name' }, ci.name + (ci.required ? ' *' : ''));
    const catEl = h('div', { class: 'ci-category' }, ci.category);
    const remarkInput = h('input', { type: 'text', placeholder: '备注（可选）' });
    const bodyEl = h('div', { class: 'ci-body' });
    bodyEl.appendChild(nameEl);
    bodyEl.appendChild(catEl);
    bodyEl.appendChild(remarkInput);
    item.appendChild(cbWrap);
    item.appendChild(bodyEl);
    grid.appendChild(item);
    clInputs.push({ id: ci.id, checkbox: cb, remark: remarkInput });
  });
  clCard.appendChild(grid);
  body.appendChild(clCard);

  const noteGroup = h('div', { class: 'form-group' });
  noteGroup.appendChild(h('label', {}, '交接班备注'));
  const noteInput = h('textarea', { placeholder: '可选，填写交接说明' });
  noteGroup.appendChild(noteInput);
  body.appendChild(noteGroup);

  wrap.appendChild(body);

  const footer = h('div', { class: 'modal-footer' });
  footer.appendChild(h('button', { class: 'btn btn-outline', onclick: closeModal }, '取消'));
  const submit = h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      try {
        const requiredMissing = clInputs.filter(ci => {
          const cfg = state.checklist.find(c => c.id === ci.id);
          return cfg && cfg.required && !ci.checkbox.checked;
        });
        if (requiredMissing.length > 0) {
          toast('请完成所有必填清单项');
          return;
        }
        if (hSel.value === rSel.value) {
          toast('交班人与接班人不能为同一人');
          return;
        }
        const checklistItems = clInputs.map(ci => ({
          id: ci.id,
          checked: ci.checkbox.checked,
          remark: ci.remark.value
        }));
        await API.post('/api/shifts', {
          storeId: storeSel.value,
          shiftType: typeSel.value,
          shiftDate: dateInput.value,
          handoverStaffId: hSel.value,
          receiveStaffId: rSel.value,
          checklistItems,
          note: noteInput.value
        });
        toast('创建成功', 'success');
        closeModal();
      } catch (e) { toast(e.message); }
    }
  }, '创建班次');
  footer.appendChild(submit);
  wrap.appendChild(footer);
  return wrap;
}

function renderShiftDetailModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [
    h('h2', {}, '班次详情'),
    h('button', { class: 'modal-close', onclick: closeModal }, '×')
  ]));
  const body = h('div', { class: 'modal-body' }, h('div', { class: 'empty-state' }, '加载中...'));
  wrap.appendChild(body);

  (async () => {
    try {
      const r = await API.get('/api/shifts/' + state.modal.shiftId);
      paintDetail(r.shift, r.exceptions);
    } catch (e) { toast(e.message); }
  })();

  function paintDetail(s, exceptions) {
    body.innerHTML = '';
    const store = state.stores.find(x => x.id === s.storeId);
    const st = STATUS_MAP[s.status] || { label: s.status, cls: '' };

    const infoCard = h('div', {});
    infoCard.appendChild(h('h3', {}, '基本信息'));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '班次ID'), h('div', { class: 'value' }, s.id)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '门店'), h('div', { class: 'value' }, store ? store.name : s.storeId)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '日期'), h('div', { class: 'value' }, s.shiftDate)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '班次'), h('div', { class: 'value' }, s.shiftType)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '交班人'), h('div', { class: 'value' }, s.handoverStaffName)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '接班人'), h('div', { class: 'value' }, s.receiveStaffName)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '状态'), h('div', { class: 'value' }, h('span', { class: 'badge ' + st.cls }, st.label))]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '创建时间'), h('div', { class: 'value' }, formatDate(s.createdAt))]));
    if (s.confirmedAt) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '确认时间'), h('div', { class: 'value' }, formatDate(s.confirmedAt))]));
    if (s.reviewedAt) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '复核时间'), h('div', { class: 'value' }, formatDate(s.reviewedAt))]));
    if (s.reviewedByName) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '复核人'), h('div', { class: 'value' }, s.reviewedByName)]));
    if (s.note) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '备注'), h('div', { class: 'value' }, s.note)]));
    if (s.reviewNote) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '复核意见'), h('div', { class: 'value' }, s.reviewNote)]));
    body.appendChild(infoCard);

    const clCard = h('div', { style: 'margin-top:16px;' });
    clCard.appendChild(h('h3', {}, '交接清单'));
    const grid = h('div', { class: 'checklist-grid' });
    (s.checklistItems || []).forEach(ci => {
      const item = h('div', { class: 'checklist-item' });
      const cb = h('input', { type: 'checkbox', disabled: 'disabled' });
      cb.checked = !!ci.checked;
      const bodyEl = h('div', { class: 'ci-body' });
      bodyEl.appendChild(h('div', { class: 'ci-name' }, ci.name));
      bodyEl.appendChild(h('div', { class: 'ci-category' }, ci.category || ''));
      if (ci.remark) bodyEl.appendChild(h('div', { style: 'font-size:12px;color:#6b7280;margin-top:4px;' }, '备注: ' + ci.remark));
      item.appendChild(cb);
      item.appendChild(bodyEl);
      grid.appendChild(item);
    });
    clCard.appendChild(grid);
    body.appendChild(clCard);

    const exCard = h('div', { style: 'margin-top:16px;' });
    exCard.appendChild(h('h3', {}, '异常登记'));
    if (exceptions.length === 0) {
      exCard.appendChild(h('div', { class: 'empty-state', style: 'padding:24px;' }, '暂无异常记录'));
    } else {
      const tbody = h('tbody', {});
      const tbl = h('table', { style: 'font-size:12px;' }, [
        h('thead', {}, h('tr', {}, [
          h('th', {}, '类型'), h('th', {}, '品项'), h('th', {}, '金额/数量'),
          h('th', {}, '责任人'), h('th', {}, '状态'), h('th', {}, '登记人'), h('th', {}, '操作')
        ])),
        tbody
      ]);
      exceptions.forEach(e => {
        const est = EX_STATUS_MAP[e.status];
        const ops = h('td', {});
        if (e.status === 'open') {
          ops.appendChild(h('button', {
            class: 'btn btn-success btn-sm',
            style: 'margin-right:4px;',
            onclick: () => openHandleException(e.id, s.id)
          }, '处理'));
          ops.appendChild(h('button', {
            class: 'btn btn-warning btn-sm',
            onclick: () => openCreateTask(e.id, s.id)
          }, '发起整改'));
        }
        if (e.status === 'handled' && state.user.role === 'manager') {
          ops.appendChild(h('button', {
            class: 'btn btn-primary btn-sm',
            onclick: () => openCloseException(e.id, s.id)
          }, '关闭'));
        }
        const tr = h('tr', {}, [
          h('td', {}, e.type === 'cash' ? '现金差额' : '库存短缺'),
          h('td', {}, e.itemName || '-'),
          h('td', {}, e.amount ? String(e.amount) : '-'),
          h('td', {}, e.responsibleStaffName || '-'),
          h('td', {}, h('span', { class: 'badge ' + est.cls }, est.label)),
          h('td', {}, e.createdByName || '-'),
          ops
        ]);
        tbody.appendChild(tr);
      });
      exCard.appendChild(tbl);
    }
    if (s.status !== 'closed') {
      exCard.appendChild(h('button', {
        class: 'btn btn-danger btn-sm',
        style: 'margin-top:12px;',
        onclick: () => openAddException(s.id, store)
      }, '+ 登记异常'));
    }
    body.appendChild(exCard);

    const histCard = h('div', { style: 'margin-top:16px;' });
    histCard.appendChild(h('h3', {}, '操作历史'));
    const histBody = h('div', {}, h('div', { class: 'empty-state', style: 'padding:12px;' }, '加载中...'));
    histCard.appendChild(histBody);
    body.appendChild(histCard);
    API.get('/api/history?shiftId=' + s.id).then(r => {
      histBody.innerHTML = '';
      if (r.history.length === 0) {
        histBody.appendChild(h('div', { class: 'empty-state', style: 'padding:12px;' }, '暂无历史'));
        return;
      }
      r.history.forEach(item => {
        const hi = h('div', { class: 'history-item' });
        hi.appendChild(h('div', { class: 'hi-time' }, formatDate(item.timestamp)));
        hi.appendChild(h('div', { class: 'hi-action' }, ACTION_MAP[item.action] || item.action));
        hi.appendChild(h('div', { class: 'hi-user' }, item.userName));
        hi.appendChild(h('div', { class: 'hi-detail' }, item.detail));
        histBody.appendChild(hi);
      });
    }).catch(e => toast(e.message));

    const actionsBar = h('div', { style: 'margin-top:20px;display:flex;gap:8px;flex-wrap:wrap;' });
    if (s.status === 'draft' && (state.user.id === s.handoverStaffId || state.user.role === 'manager')) {
      actionsBar.appendChild(h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          try {
            await API.post('/api/shifts/' + s.id + '/handover');
            toast('已提交交接', 'success');
            state.modal = { type: 'shiftDetail', shiftId: s.id };
            render();
          } catch (e) { toast(e.message); }
        }
      }, '提交交接'));
    }
    if ((s.status === 'handed_over' || s.status === 'returned') && state.user.id === s.receiveStaffId) {
      actionsBar.appendChild(h('button', {
        class: 'btn btn-success',
        onclick: async () => {
          try {
            await API.post('/api/shifts/' + s.id + '/confirm');
            toast('已确认交接', 'success');
            state.modal = { type: 'shiftDetail', shiftId: s.id };
            render();
          } catch (e) { toast(e.message); }
        }
      }, '确认交接'));
    }
    if ((s.status === 'confirmed' || s.status === 'returned') && state.user.role !== 'manager') {
      actionsBar.appendChild(h('button', {
        class: 'btn btn-warning',
        onclick: async () => {
          try {
            await API.post('/api/shifts/' + s.id + '/submit-review');
            toast('已提交复核', 'success');
            state.modal = { type: 'shiftDetail', shiftId: s.id };
            render();
          } catch (e) { toast(e.message); }
        }
      }, '提交复核'));
    }
    if ((s.status === 'reviewing' || s.status === 'confirmed') && state.user.role === 'manager' && state.user.storeId === s.storeId) {
      actionsBar.appendChild(h('button', {
        class: 'btn btn-success',
        onclick: () => openCloseShift(s.id)
      }, '关闭班次'));
      actionsBar.appendChild(h('button', {
        class: 'btn btn-danger',
        onclick: () => openReturnShift(s.id)
      }, '退回班次'));
    }
    if (actionsBar.children.length > 0) body.appendChild(actionsBar);
  }

  function openAddException(shiftId, storeObj) {
    body.innerHTML = '';
    const card = h('div', {});
    card.appendChild(h('h3', {}, '登记异常'));

    const typeGroup = h('div', { class: 'form-group' });
    typeGroup.appendChild(h('label', {}, '异常类型'));
    const typeSel = h('select', {});
    typeSel.appendChild(h('option', { value: 'cash' }, '现金差额'));
    typeSel.appendChild(h('option', { value: 'stock' }, '库存短缺'));
    typeGroup.appendChild(typeSel);
    card.appendChild(typeGroup);

    const row = h('div', { class: 'row' });
    const amountGroup = h('div', { class: 'form-group' });
    amountGroup.appendChild(h('label', {}, '金额/数量'));
    const amountInput = h('input', { type: 'number', step: '0.01', placeholder: '请输入' });
    amountGroup.appendChild(amountInput);
    row.appendChild(amountGroup);

    const itemGroup = h('div', { class: 'form-group' });
    itemGroup.appendChild(h('label', {}, '品项名称'));
    const itemInput = h('input', { type: 'text', placeholder: '如：可口可乐、香烟等' });
    itemGroup.appendChild(itemInput);
    row.appendChild(itemGroup);
    card.appendChild(row);

    const storeUsers = state.users.filter(u => !storeObj || u.storeId === storeObj.id);
    const respGroup = h('div', { class: 'form-group' });
    respGroup.appendChild(h('label', {}, '责任人'));
    const respSel = h('select', {});
    respSel.appendChild(h('option', { value: '' }, '请选择'));
    storeUsers.forEach(u => respSel.appendChild(h('option', { value: u.id }, u.name)));
    respGroup.appendChild(respSel);
    card.appendChild(respGroup);

    const descGroup = h('div', { class: 'form-group' });
    descGroup.appendChild(h('label', {}, '异常描述'));
    const descInput = h('textarea', { placeholder: '详细描述异常情况' });
    descGroup.appendChild(descInput);
    card.appendChild(descGroup);

    const noteGroup = h('div', { class: 'form-group' });
    noteGroup.appendChild(h('label', {}, '备注'));
    const noteInput = h('textarea', { placeholder: '可选' });
    noteGroup.appendChild(noteInput);
    card.appendChild(noteGroup);

    const btnRow = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px;' });
    btnRow.appendChild(h('button', {
      class: 'btn btn-outline',
      onclick: () => { state.modal = { type: 'shiftDetail', shiftId }; render(); }
    }, '取消'));
    btnRow.appendChild(h('button', {
      class: 'btn btn-primary',
      onclick: async () => {
        try {
          await API.post('/api/exceptions', {
            shiftId,
            type: typeSel.value,
            amount: amountInput.value,
            itemName: itemInput.value,
            description: descInput.value,
            responsibleStaffId: respSel.value,
            note: noteInput.value
          });
          toast('异常已登记', 'success');
          state.modal = { type: 'shiftDetail', shiftId };
          render();
        } catch (e) { toast(e.message); }
      }
    }, '提交'));
    card.appendChild(btnRow);
    body.appendChild(card);
  }

  function openCloseShift(shiftId) {
    const note = prompt('请输入复核意见（可选）：') || '';
    API.post('/api/shifts/' + shiftId + '/close', { reviewNote: note }).then(() => {
      toast('班次已关闭', 'success');
      state.modal = { type: 'shiftDetail', shiftId };
      render();
    }).catch(e => toast(e.message));
  }

  function openReturnShift(shiftId) {
    const note = prompt('请输入退回原因：');
    if (note == null) return;
    API.post('/api/shifts/' + shiftId + '/return', { reviewNote: note }).then(() => {
      toast('班次已退回', 'success');
      state.modal = { type: 'shiftDetail', shiftId };
      render();
    }).catch(e => toast(e.message));
  }

  return wrap;
}

function renderHandleExceptionModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [
    h('h2', {}, '处理异常'),
    h('button', { class: 'modal-close', onclick: () => backFromException() }, '×')
  ]));
  const body = h('div', { class: 'modal-body' });
  const noteGroup = h('div', { class: 'form-group' });
  noteGroup.appendChild(h('label', {}, '处理说明'));
  const noteInput = h('textarea', { placeholder: '请填写处理措施和结果', required: 'required' });
  noteGroup.appendChild(noteInput);
  body.appendChild(noteGroup);
  wrap.appendChild(body);
  const footer = h('div', { class: 'modal-footer' });
  footer.appendChild(h('button', { class: 'btn btn-outline', onclick: () => backFromException() }, '取消'));
  footer.appendChild(h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      try {
        await API.post('/api/exceptions/' + state.modal.exceptionId + '/handle', { handleNote: noteInput.value });
        toast('异常已标记处理', 'success');
        backFromException();
      } catch (e) { toast(e.message); }
    }
  }, '确认处理'));
  wrap.appendChild(footer);
  return wrap;
}

function renderCloseExceptionModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [
    h('h2', {}, '关闭异常'),
    h('button', { class: 'modal-close', onclick: () => backFromException() }, '×')
  ]));
  const body = h('div', { class: 'modal-body' });
  const noteGroup = h('div', { class: 'form-group' });
  noteGroup.appendChild(h('label', {}, '关闭说明'));
  const noteInput = h('textarea', { placeholder: '请填写关闭意见', required: 'required' });
  noteGroup.appendChild(noteInput);
  body.appendChild(noteGroup);
  wrap.appendChild(body);
  const footer = h('div', { class: 'modal-footer' });
  footer.appendChild(h('button', { class: 'btn btn-outline', onclick: () => backFromException() }, '取消'));
  footer.appendChild(h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      try {
        await API.post('/api/exceptions/' + state.modal.exceptionId + '/close', { closeNote: noteInput.value });
        toast('异常已关闭', 'success');
        backFromException();
      } catch (e) { toast(e.message); }
    }
  }, '确认关闭'));
  wrap.appendChild(footer);
  return wrap;
}

function renderCreateTaskModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [
    h('h2', {}, '发起整改任务'),
    h('button', { class: 'modal-close', onclick: () => backFromException() }, '×')
  ]));
  const body = h('div', { class: 'modal-body' });

  const titleGroup = h('div', { class: 'form-group' });
  titleGroup.appendChild(h('label', {}, '任务标题'));
  const titleInput = h('input', { type: 'text', placeholder: '请输入任务标题，可选自动生成' });
  titleGroup.appendChild(titleInput);
  body.appendChild(titleGroup);

  const row1 = h('div', { class: 'row' });
  const respGroup = h('div', { class: 'form-group' });
  respGroup.appendChild(h('label', {}, '责任人'));
  const respSel = h('select', { required: 'required' });
  respSel.appendChild(h('option', { value: '' }, '请选择'));
  const storeUsers = state.users.filter(u => u.storeId === state.user.storeId);
  storeUsers.forEach(u => respSel.appendChild(h('option', { value: u.id }, u.name)));
  respGroup.appendChild(respSel);
  row1.appendChild(respGroup);

  const dlGroup = h('div', { class: 'form-group' });
  dlGroup.appendChild(h('label', {}, '截止时间'));
  const dlInput = h('input', { type: 'date' });
  dlGroup.appendChild(dlInput);
  row1.appendChild(dlGroup);
  body.appendChild(row1);

  const stepsGroup = h('div', { class: 'form-group' });
  stepsGroup.appendChild(h('label', {}, '处理步骤'));
  const stepsInput = h('textarea', { placeholder: '请描述处理步骤（如：盘点库存、调阅监控、联系供应商等）' });
  stepsGroup.appendChild(stepsInput);
  body.appendChild(stepsGroup);

  const attachGroup = h('div', { class: 'form-group' });
  attachGroup.appendChild(h('label', {}, '附件说明'));
  const attachInput = h('textarea', { placeholder: '请填写附件/相关凭证说明（如：上传照片编号、单据号等）' });
  attachGroup.appendChild(attachInput);
  body.appendChild(attachGroup);

  wrap.appendChild(body);

  const footer = h('div', { class: 'modal-footer' });
  footer.appendChild(h('button', { class: 'btn btn-outline', onclick: () => backFromException() }, '取消'));
  footer.appendChild(h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      try {
        if (!respSel.value) { toast('请选择责任人'); return; }
        await API.post('/api/tasks', {
          exceptionId: state.modal.exceptionId,
          title: titleInput.value,
          assigneeId: respSel.value,
          deadline: dlInput.value,
          steps: stepsInput.value,
          attachmentNote: attachInput.value
        });
        toast('整改任务已创建', 'success');
        backFromException();
      } catch (e) { toast(e.message); }
    }
  }, '提交'));
  wrap.appendChild(footer);
  return wrap;
}

function renderTaskDetailModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [
    h('h2', {}, '整改任务详情'),
    h('button', { class: 'modal-close', onclick: closeModal }, '×')
  ]));
  const body = h('div', { class: 'modal-body' }, h('div', { class: 'empty-state' }, '加载中...'));
  wrap.appendChild(body);

  (async () => {
    try {
      const r = await API.get('/api/tasks/' + state.modal.taskId);
      paintTaskDetail(r.task);
    } catch (e) { toast(e.message); }
  })();

  function paintTaskDetail(t) {
    body.innerHTML = '';
    const st = TASK_STATUS_MAP[t.status] || { label: t.status, cls: '' };
    const store = state.stores.find(x => x.id === t.storeId);

    const infoCard = h('div', {});
    infoCard.appendChild(h('h3', {}, '基本信息'));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '任务ID'), h('div', { class: 'value' }, t.id)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '门店'), h('div', { class: 'value' }, store ? store.name : t.storeId)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '标题'), h('div', { class: 'value' }, t.title)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '关联异常'), h('div', { class: 'value' }, t.exceptionId + ' / ' + t.shiftId)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '责任人'), h('div', { class: 'value' }, t.assigneeName)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '截止时间'), h('div', { class: 'value' }, t.deadline || '-')]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '状态'), h('div', { class: 'value' }, h('span', { class: 'badge ' + st.cls }, st.label))]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '发起人'), h('div', { class: 'value' }, t.createdByName)]));
    infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '创建时间'), h('div', { class: 'value' }, formatDate(t.createdAt))]));
    if (t.assignedAt) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '分派时间'), h('div', { class: 'value' }, formatDate(t.assignedAt))]));
    if (t.assignedByName) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '分派人'), h('div', { class: 'value' }, t.assignedByName)]));
    if (t.submittedAt) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '提交时间'), h('div', { class: 'value' }, formatDate(t.submittedAt))]));
    if (t.closedAt) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '关闭时间'), h('div', { class: 'value' }, formatDate(t.closedAt))]));
    if (t.description) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '异常描述'), h('div', { class: 'value' }, t.description)]));
    if (t.steps) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '处理步骤'), h('div', { class: 'value' }, t.steps)]));
    if (t.attachmentNote) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '附件说明'), h('div', { class: 'value' }, t.attachmentNote)]));
    if (t.submitNote) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '提交说明'), h('div', { class: 'value' }, t.submitNote)]));
    if (t.rejectNote) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '驳回原因'), h('div', { class: 'value' }, t.rejectNote)]));
    if (t.closeNote) infoCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '关闭说明'), h('div', { class: 'value' }, t.closeNote)]));
    body.appendChild(infoCard);

    const histCard = h('div', { style: 'margin-top:16px;' });
    histCard.appendChild(h('h3', {}, '状态历史'));
    const histBody = h('div', {});
    (t.statusHistory || []).forEach(item => {
      const hi = h('div', { class: 'history-item' });
      hi.appendChild(h('div', { class: 'hi-time' }, formatDate(item.at)));
      const labelMap = TASK_STATUS_MAP[item.status] || { label: item.status };
      hi.appendChild(h('div', { class: 'hi-action' }, labelMap.label));
      hi.appendChild(h('div', { class: 'hi-user' }, item.byName));
      hi.appendChild(h('div', { class: 'hi-detail' }, item.note || '-'));
      histBody.appendChild(hi);
    });
    histCard.appendChild(histBody);
    body.appendChild(histCard);

    const actionsBar = h('div', { style: 'margin-top:20px;display:flex;gap:8px;flex-wrap:wrap;' });
    if ((t.status === 'pending' || t.status === 'rejected') && state.user.role === 'manager' && t.storeId === state.user.storeId) {
      actionsBar.appendChild(h('button', {
        class: 'btn btn-primary',
        onclick: () => openAssignTask(t)
      }, '分派任务'));
      if (t.status === 'pending') {
        actionsBar.appendChild(h('button', {
          class: 'btn btn-danger',
          onclick: async () => {
            const note = prompt('请输入驳回原因：');
            if (note == null) return;
            try {
              await API.post('/api/tasks/' + t.id + '/reject', { rejectNote: note, updatedAt: t.updatedAt });
              toast('已驳回', 'success');
              state.modal = { type: 'taskDetail', taskId: t.id };
              render();
            } catch (e) { toast(e.message); }
          }
        }, '驳回'));
      }
    }
    if ((t.status === 'assigned' || t.status === 'rejected') && (t.assigneeId === state.user.id || state.user.role === 'manager') && t.storeId === state.user.storeId) {
      actionsBar.appendChild(h('button', {
        class: 'btn btn-success',
        onclick: () => openSubmitTask(t)
      }, '提交整改完成'));
    }
    if (t.status === 'submitted' && state.user.role === 'manager' && t.storeId === state.user.storeId) {
      actionsBar.appendChild(h('button', {
        class: 'btn btn-success',
        onclick: async () => {
          const note = prompt('请输入验收意见（可选）：') || '';
          try {
            await API.post('/api/tasks/' + t.id + '/accept', { closeNote: note, updatedAt: t.updatedAt });
            toast('已验收关闭', 'success');
            state.modal = { type: 'taskDetail', taskId: t.id };
            render();
          } catch (e) { toast(e.message); }
        }
      }, '验收关闭'));
      actionsBar.appendChild(h('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          const note = prompt('请输入驳回原因：');
          if (note == null) return;
          try {
            await API.post('/api/tasks/' + t.id + '/reject', { rejectNote: note, updatedAt: t.updatedAt });
            toast('已驳回', 'success');
            state.modal = { type: 'taskDetail', taskId: t.id };
            render();
          } catch (e) { toast(e.message); }
        }
      }, '驳回'));
    }
    if (actionsBar.children.length > 0) body.appendChild(actionsBar);
  }

  function openAssignTask(t) {
    body.innerHTML = '';
    const card = h('div', {});
    card.appendChild(h('h3', {}, '分派整改任务'));
    const respGroup = h('div', { class: 'form-group' });
    respGroup.appendChild(h('label', {}, '责任人'));
    const respSel = h('select', {});
    const storeUsers = state.users.filter(u => u.storeId === state.user.storeId);
    storeUsers.forEach(u => {
      const opt = h('option', { value: u.id }, u.name);
      if (u.id === t.assigneeId) opt.selected = true;
      respSel.appendChild(opt);
    });
    respGroup.appendChild(respSel);
    card.appendChild(respGroup);

    const noteGroup = h('div', { class: 'form-group' });
    noteGroup.appendChild(h('label', {}, '分派说明'));
    const noteInput = h('textarea', { placeholder: '可选' });
    noteGroup.appendChild(noteInput);
    card.appendChild(noteGroup);

    const btnRow = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px;' });
    btnRow.appendChild(h('button', {
      class: 'btn btn-outline',
      onclick: () => { state.modal = { type: 'taskDetail', taskId: t.id }; render(); }
    }, '取消'));
    btnRow.appendChild(h('button', {
      class: 'btn btn-primary',
      onclick: async () => {
        try {
          await API.post('/api/tasks/' + t.id + '/assign', { assigneeId: respSel.value, note: noteInput.value });
          toast('已分派', 'success');
          state.modal = { type: 'taskDetail', taskId: t.id };
          render();
        } catch (e) { toast(e.message); }
      }
    }, '确认分派'));
    card.appendChild(btnRow);
    body.appendChild(card);
  }

  function openSubmitTask(t) {
    body.innerHTML = '';
    const card = h('div', {});
    card.appendChild(h('h3', {}, '提交整改完成'));
    const noteGroup = h('div', { class: 'form-group' });
    noteGroup.appendChild(h('label', {}, '处理完成说明'));
    const noteInput = h('textarea', { placeholder: '请详细说明处理结果', required: 'required' });
    noteGroup.appendChild(noteInput);
    card.appendChild(noteGroup);

    const btnRow = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px;' });
    btnRow.appendChild(h('button', {
      class: 'btn btn-outline',
      onclick: () => { state.modal = { type: 'taskDetail', taskId: t.id }; render(); }
    }, '取消'));
    btnRow.appendChild(h('button', {
      class: 'btn btn-success',
      onclick: async () => {
        try {
          await API.post('/api/tasks/' + t.id + '/submit', { submitNote: noteInput.value, updatedAt: t.updatedAt });
          toast('已提交', 'success');
          state.modal = { type: 'taskDetail', taskId: t.id };
          render();
        } catch (e) { toast(e.message); }
      }
    }, '确认提交'));
    card.appendChild(btnRow);
    body.appendChild(card);
  }

  return wrap;
}

function backFromException() {
  if (state.modal.backToShift) {
    state.modal = { type: 'shiftDetail', shiftId: state.modal.backToShift };
  } else {
    state.modal = null;
  }
  render();
}

function exportData(type, format) {
  const params = new URLSearchParams();
  params.set('format', format);
  if (type === 'devices' || type === 'inspections' || type === 'repair-orders' || type === 'tasks') {
    const statusInput = prompt('按状态导出（留空导出全部，如 normal/fault/draft/submitted/reported/accepted/completed）：') || '';
    if (statusInput) params.set('status', statusInput);
  }
  if (type !== 'tasks' && type !== 'devices' && type !== 'repair-orders') {
    const storeInput = prompt('按门店ID导出（留空导出全部，例如 S001）：') || '';
    if (storeInput) params.set('storeId', storeInput);
    const dateInput = prompt('按日期导出（留空导出全部，格式 YYYY-MM-DD）：') || '';
    if (dateInput) params.set('date', dateInput);
  } else if (type === 'devices' || type === 'repair-orders') {
    const storeInput = prompt('按门店ID导出（留空导出全部，例如 S001）：') || '';
    if (storeInput) params.set('storeId', storeInput);
  }
  window.open('/api/export/' + type + '?' + params.toString(), '_blank');
}

function renderDevices() {
  const wrap = h('div', {});
  const header = h('div', { class: 'page-header' });
  header.appendChild(h('h1', {}, '设备管理'));
  const actions = h('div', { class: 'actions' });
  actions.appendChild(h('button', { class: 'btn btn-outline btn-sm', onclick: () => exportData('devices', 'csv') }, '导出CSV'));
  actions.appendChild(h('button', { class: 'btn btn-outline btn-sm', onclick: () => exportData('devices', 'json') }, '导出JSON'));
  if (state.user.role === 'manager') {
    actions.appendChild(h('button', { class: 'btn btn-primary btn-sm', onclick: () => { state.modal = { type: 'importDevice' }; render(); } }, 'CSV导入'));
    actions.appendChild(h('button', { class: 'btn btn-primary btn-sm', onclick: () => { state.modal = { type: 'createDevice' }; render(); } }, '+ 新增设备'));
  }
  header.appendChild(actions);
  wrap.appendChild(header);

  const filter = h('div', { class: 'card' });
  const fb = h('div', { class: 'filter-bar' });
  const statusGroup = h('div', { class: 'form-group' });
  statusGroup.appendChild(h('label', {}, '状态'));
  const statusSel = h('select', {});
  statusSel.appendChild(h('option', { value: '' }, '全部'));
  Object.entries(DEVICE_STATUS_MAP).forEach(([k, v]) => statusSel.appendChild(h('option', { value: k }, v.label)));
  statusGroup.appendChild(statusSel);
  fb.appendChild(statusGroup);
  const kwGroup = h('div', { class: 'form-group' });
  kwGroup.appendChild(h('label', {}, '关键字'));
  const kwInput = h('input', { type: 'text', placeholder: '编号/名称/位置' });
  kwGroup.appendChild(kwInput);
  fb.appendChild(kwGroup);
  const queryBtn = h('button', { class: 'btn btn-primary btn-sm' }, '查询');
  fb.appendChild(queryBtn);
  filter.appendChild(fb);
  wrap.appendChild(filter);

  const listCard = h('div', { class: 'card' });
  const tbody = h('tbody', {});
  tbody.appendChild(h('tr', {}, h('td', { colspan: '8', style: 'text-align:center;padding:40px;color:#6b7280;' }, '加载中...')));
  const table = h('table', {}, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '编号'), h('th', {}, '名称'), h('th', {}, '分类'), h('th', {}, '型号'),
      h('th', {}, '位置'), h('th', {}, '状态'), h('th', {}, '创建时间'), h('th', {}, '操作')
    ])),
    tbody
  ]);
  listCard.appendChild(table);
  wrap.appendChild(listCard);

  async function loadData() {
    try {
      const params = new URLSearchParams();
      if (statusSel.value) params.set('status', statusSel.value);
      if (kwInput.value) params.set('keyword', kwInput.value);
      const r = await API.get('/api/devices?' + params.toString());
      tbody.innerHTML = '';
      if (r.devices.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: '8', style: 'text-align:center;padding:40px;color:#6b7280;' }, '暂无数据')));
        return;
      }
      r.devices.forEach(d => {
        const st = DEVICE_STATUS_MAP[d.status] || { label: d.status, cls: '' };
        const ops = h('td', {});
        ops.appendChild(h('button', { class: 'btn btn-outline btn-sm', onclick: () => { state.modal = { type: 'deviceDetail', deviceId: d.id }; render(); } }, '详情'));
        if (state.user.role === 'manager' && d.storeId === state.user.storeId) {
          ops.appendChild(h('button', { class: 'btn btn-danger btn-sm', style: 'margin-left:4px;', onclick: async () => {
            if (!confirm('确定删除设备 ' + d.code + '？')) return;
            try { await API.post('/api/devices/' + d.id + '?_method=DELETE', {}); toast('已删除', 'success'); loadData(); } catch (e) { toast(e.message); }
          } }, '删除'));
        }
        tbody.appendChild(h('tr', {}, [
          h('td', {}, d.code), h('td', {}, d.name), h('td', {}, d.category || '-'),
          h('td', {}, d.model || '-'), h('td', {}, d.location || '-'),
          h('td', {}, h('span', { class: 'badge ' + st.cls }, st.label)),
          h('td', {}, formatDate(d.createdAt)), ops
        ]));
      });
    } catch (e) { toast(e.message); }
  }
  queryBtn.onclick = loadData;
  setTimeout(loadData, 0);
  return wrap;
}

function renderTemplates() {
  const wrap = h('div', {});
  const header = h('div', { class: 'page-header' });
  header.appendChild(h('h1', {}, '巡检模板'));
  if (state.user.role === 'manager') {
    const actions = h('div', { class: 'actions' });
    actions.appendChild(h('button', { class: 'btn btn-primary btn-sm', onclick: () => { state.modal = { type: 'createTemplate' }; render(); } }, '+ 新增模板'));
    header.appendChild(actions);
  }
  wrap.appendChild(header);

  const listCard = h('div', { class: 'card' });
  const tbody = h('tbody', {});
  tbody.appendChild(h('tr', {}, h('td', { colspan: '6', style: 'text-align:center;padding:40px;color:#6b7280;' }, '加载中...')));
  const table = h('table', {}, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '模板ID'), h('th', {}, '名称'), h('th', {}, '描述'), h('th', {}, '巡检项数'),
      h('th', {}, '创建时间'), h('th', {}, '操作')
    ])),
    tbody
  ]);
  listCard.appendChild(table);
  wrap.appendChild(listCard);

  API.get('/api/inspection-templates').then(r => {
    tbody.innerHTML = '';
    if (r.templates.length === 0) {
      tbody.appendChild(h('tr', {}, h('td', { colspan: '6', style: 'text-align:center;padding:40px;color:#6b7280;' }, '暂无数据')));
      return;
    }
    r.templates.forEach(t => {
      const ops = h('td', {});
      ops.appendChild(h('button', { class: 'btn btn-outline btn-sm', onclick: () => { state.modal = { type: 'templateDetail', templateId: t.id }; render(); } }, '详情'));
      if (state.user.role === 'manager' && t.storeId === state.user.storeId) {
        ops.appendChild(h('button', { class: 'btn btn-danger btn-sm', style: 'margin-left:4px;', onclick: async () => {
          if (!confirm('确定删除模板 ' + t.name + '？')) return;
          try { await API.post('/api/inspection-templates/' + t.id + '?_method=DELETE', {}); toast('已删除', 'success'); render(); } catch (e) { toast(e.message); }
        } }, '删除'));
      }
      tbody.appendChild(h('tr', {}, [
        h('td', {}, t.id), h('td', {}, t.name), h('td', {}, t.description || '-'),
        h('td', {}, String((t.items || []).length)), h('td', {}, formatDate(t.createdAt)), ops
      ]));
    });
  }).catch(e => toast(e.message));
  return wrap;
}

function renderInspections() {
  const wrap = h('div', {});
  const header = h('div', { class: 'page-header' });
  header.appendChild(h('h1', {}, '巡检管理'));
  const actions = h('div', { class: 'actions' });
  actions.appendChild(h('button', { class: 'btn btn-outline btn-sm', onclick: () => exportData('inspections', 'csv') }, '导出CSV'));
  actions.appendChild(h('button', { class: 'btn btn-outline btn-sm', onclick: () => exportData('inspections', 'json') }, '导出JSON'));
  actions.appendChild(h('button', { class: 'btn btn-primary btn-sm', onclick: () => { state.modal = { type: 'createInspection' }; render(); } }, '+ 创建巡检单'));
  header.appendChild(actions);
  wrap.appendChild(header);

  const filter = h('div', { class: 'card' });
  const fb = h('div', { class: 'filter-bar' });
  const statusGroup = h('div', { class: 'form-group' });
  statusGroup.appendChild(h('label', {}, '状态'));
  const statusSel = h('select', {});
  statusSel.appendChild(h('option', { value: '' }, '全部'));
  Object.entries(INSPECTION_STATUS_MAP).forEach(([k, v]) => statusSel.appendChild(h('option', { value: k }, v.label)));
  statusGroup.appendChild(statusSel);
  fb.appendChild(statusGroup);
  const queryBtn = h('button', { class: 'btn btn-primary btn-sm' }, '查询');
  fb.appendChild(queryBtn);
  filter.appendChild(fb);
  wrap.appendChild(filter);

  const listCard = h('div', { class: 'card' });
  const tbody = h('tbody', {});
  tbody.appendChild(h('tr', {}, h('td', { colspan: '8', style: 'text-align:center;padding:40px;color:#6b7280;' }, '加载中...')));
  const table = h('table', {}, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '巡检单ID'), h('th', {}, '班次'), h('th', {}, '巡检日期'), h('th', {}, '模板'),
      h('th', {}, '巡检人'), h('th', {}, '异常项'), h('th', {}, '状态'), h('th', {}, '操作')
    ])),
    tbody
  ]);
  listCard.appendChild(table);
  wrap.appendChild(listCard);

  async function loadData() {
    try {
      const params = new URLSearchParams();
      if (statusSel.value) params.set('status', statusSel.value);
      const r = await API.get('/api/inspections?' + params.toString());
      tbody.innerHTML = '';
      if (r.inspections.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: '8', style: 'text-align:center;padding:40px;color:#6b7280;' }, '暂无数据')));
        return;
      }
      r.inspections.forEach(ins => {
        const st = INSPECTION_STATUS_MAP[ins.status] || { label: ins.status, cls: '' };
        const abnormal = (ins.items || []).filter(it => it.result === 'abnormal').length;
        tbody.appendChild(h('tr', {}, [
          h('td', {}, ins.id), h('td', {}, ins.shiftType + ' ' + ins.shiftDate),
          h('td', {}, ins.inspectionDate), h('td', {}, ins.templateName),
          h('td', {}, ins.inspectorName), h('td', {}, String(abnormal)),
          h('td', {}, h('span', { class: 'badge ' + st.cls }, st.label)),
          h('td', {}, h('button', { class: 'btn btn-outline btn-sm', onclick: () => { state.modal = { type: 'inspectionDetail', inspectionId: ins.id }; render(); } }, '详情'))
        ]));
      });
    } catch (e) { toast(e.message); }
  }
  queryBtn.onclick = loadData;
  setTimeout(loadData, 0);
  return wrap;
}

function renderRepairOrders() {
  const wrap = h('div', {});
  const header = h('div', { class: 'page-header' });
  header.appendChild(h('h1', {}, '维修单'));
  const actions = h('div', { class: 'actions' });
  actions.appendChild(h('button', { class: 'btn btn-outline btn-sm', onclick: () => exportData('repair-orders', 'csv') }, '导出CSV'));
  actions.appendChild(h('button', { class: 'btn btn-outline btn-sm', onclick: () => exportData('repair-orders', 'json') }, '导出JSON'));
  header.appendChild(actions);
  wrap.appendChild(header);

  const filter = h('div', { class: 'card' });
  const fb = h('div', { class: 'filter-bar' });
  const statusGroup = h('div', { class: 'form-group' });
  statusGroup.appendChild(h('label', {}, '状态'));
  const statusSel = h('select', {});
  statusSel.appendChild(h('option', { value: '' }, '全部'));
  Object.entries(REPAIR_STATUS_MAP).forEach(([k, v]) => statusSel.appendChild(h('option', { value: k }, v.label)));
  statusGroup.appendChild(statusSel);
  fb.appendChild(statusGroup);
  const mineGroup = h('div', { class: 'form-group' });
  mineGroup.appendChild(h('label', {}, '范围'));
  const mineSel = h('select', {});
  mineSel.appendChild(h('option', { value: '' }, '全部'));
  mineSel.appendChild(h('option', { value: '1' }, '待我处理'));
  mineGroup.appendChild(mineSel);
  fb.appendChild(mineGroup);
  const queryBtn = h('button', { class: 'btn btn-primary btn-sm' }, '查询');
  fb.appendChild(queryBtn);
  filter.appendChild(fb);
  wrap.appendChild(filter);

  const listCard = h('div', { class: 'card' });
  const tbody = h('tbody', {});
  tbody.appendChild(h('tr', {}, h('td', { colspan: '8', style: 'text-align:center;padding:40px;color:#6b7280;' }, '加载中...')));
  const table = h('table', {}, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '维修单ID'), h('th', {}, '设备'), h('th', {}, '标题'), h('th', {}, '接修人'),
      h('th', {}, '状态'), h('th', {}, '报修人'), h('th', {}, '报修时间'), h('th', {}, '操作')
    ])),
    tbody
  ]);
  listCard.appendChild(table);
  wrap.appendChild(listCard);

  async function loadData() {
    try {
      const params = new URLSearchParams();
      if (statusSel.value) params.set('status', statusSel.value);
      if (mineSel.value) params.set('mine', mineSel.value);
      const r = await API.get('/api/repair-orders?' + params.toString());
      tbody.innerHTML = '';
      if (r.repairOrders.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: '8', style: 'text-align:center;padding:40px;color:#6b7280;' }, '暂无数据')));
        return;
      }
      r.repairOrders.forEach(o => {
        const st = REPAIR_STATUS_MAP[o.status] || { label: o.status, cls: '' };
        tbody.appendChild(h('tr', {}, [
          h('td', {}, o.id), h('td', {}, o.deviceCode + ' ' + o.deviceName),
          h('td', {}, o.title || '-'), h('td', {}, o.assigneeName || '未分派'),
          h('td', {}, h('span', { class: 'badge ' + st.cls }, st.label)),
          h('td', {}, o.createdByName || '-'), h('td', {}, formatDate(o.createdAt)),
          h('td', {}, h('button', { class: 'btn btn-outline btn-sm', onclick: () => { state.modal = { type: 'repairOrderDetail', repairOrderId: o.id }; render(); } }, '详情'))
        ]));
      });
    } catch (e) { toast(e.message); }
  }
  queryBtn.onclick = loadData;
  setTimeout(loadData, 0);
  return wrap;
}

function renderCreateDeviceModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [h('h2', {}, '新增设备'), h('button', { class: 'modal-close', onclick: closeModal }, '×')]));
  const body = h('div', { class: 'modal-body' });
  const codeGroup = h('div', { class: 'form-group' });
  codeGroup.appendChild(h('label', {}, '设备编号 *'));
  const codeInput = h('input', { type: 'text', placeholder: '如 POS-001', required: 'required' });
  codeGroup.appendChild(codeInput);
  body.appendChild(codeGroup);
  const nameGroup = h('div', { class: 'form-group' });
  nameGroup.appendChild(h('label', {}, '设备名称 *'));
  const nameInput = h('input', { type: 'text', placeholder: '如 收银机', required: 'required' });
  nameGroup.appendChild(nameInput);
  body.appendChild(nameGroup);
  const row1 = h('div', { class: 'row' });
  const catGroup = h('div', { class: 'form-group' });
  catGroup.appendChild(h('label', {}, '分类'));
  const catInput = h('input', { type: 'text', placeholder: '如 IT设备、制冷设备' });
  catGroup.appendChild(catInput);
  row1.appendChild(catGroup);
  const modelGroup = h('div', { class: 'form-group' });
  modelGroup.appendChild(h('label', {}, '型号'));
  const modelInput = h('input', { type: 'text', placeholder: '设备型号' });
  modelGroup.appendChild(modelInput);
  row1.appendChild(modelGroup);
  body.appendChild(row1);
  const locGroup = h('div', { class: 'form-group' });
  locGroup.appendChild(h('label', {}, '位置'));
  const locInput = h('input', { type: 'text', placeholder: '如 收银台1号位' });
  locGroup.appendChild(locInput);
  body.appendChild(locGroup);
  const row2 = h('div', { class: 'row' });
  const pdGroup = h('div', { class: 'form-group' });
  pdGroup.appendChild(h('label', {}, '购买日期'));
  const pdInput = h('input', { type: 'date' });
  pdGroup.appendChild(pdInput);
  row2.appendChild(pdGroup);
  const noteGroup = h('div', { class: 'form-group' });
  noteGroup.appendChild(h('label', {}, '备注'));
  const noteInput = h('input', { type: 'text', placeholder: '可选' });
  noteGroup.appendChild(noteInput);
  row2.appendChild(noteGroup);
  body.appendChild(row2);
  wrap.appendChild(body);
  const footer = h('div', { class: 'modal-footer' });
  footer.appendChild(h('button', { class: 'btn btn-outline', onclick: closeModal }, '取消'));
  footer.appendChild(h('button', { class: 'btn btn-primary', onclick: async () => {
    if (!codeInput.value || !nameInput.value) { toast('编号和名称必填'); return; }
    try {
      await API.post('/api/devices', { code: codeInput.value, name: nameInput.value, category: catInput.value, model: modelInput.value, location: locInput.value, purchaseDate: pdInput.value, note: noteInput.value });
      toast('设备已创建', 'success'); closeModal();
    } catch (e) { toast(e.message); }
  } }, '创建'));
  wrap.appendChild(footer);
  return wrap;
}

function renderDeviceDetailModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [h('h2', {}, '设备详情'), h('button', { class: 'modal-close', onclick: closeModal }, '×')]));
  const body = h('div', { class: 'modal-body' }, h('div', { class: 'empty-state' }, '加载中...'));
  wrap.appendChild(body);
  API.get('/api/devices/' + state.modal.deviceId).then(r => {
    const d = r.device;
    body.innerHTML = '';
    const st = DEVICE_STATUS_MAP[d.status] || { label: d.status, cls: '' };
    const card = h('div', {});
    card.appendChild(h('h3', {}, '基本信息'));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '编号'), h('div', { class: 'value' }, d.code)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '名称'), h('div', { class: 'value' }, d.name)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '分类'), h('div', { class: 'value' }, d.category || '-')]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '型号'), h('div', { class: 'value' }, d.model || '-')]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '位置'), h('div', { class: 'value' }, d.location || '-')]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '状态'), h('div', { class: 'value' }, h('span', { class: 'badge ' + st.cls }, st.label))]));
    if (d.purchaseDate) card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '购买日期'), h('div', { class: 'value' }, d.purchaseDate)]));
    if (d.note) card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '备注'), h('div', { class: 'value' }, d.note)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '创建人'), h('div', { class: 'value' }, d.createdByName)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '创建时间'), h('div', { class: 'value' }, formatDate(d.createdAt))]));
    body.appendChild(card);
  }).catch(e => toast(e.message));
  return wrap;
}

function renderImportDeviceModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [h('h2', {}, 'CSV批量导入设备'), h('button', { class: 'modal-close', onclick: closeModal }, '×')]));
  const body = h('div', { class: 'modal-body' });
  body.appendChild(h('p', { style: 'font-size:13px;color:#6b7280;margin-bottom:12px;' }, 'CSV表头：设备编号,设备名称,分类,型号,位置,购买日期,备注。重复编号将跳过并保留原数据。'));
  const csvGroup = h('div', { class: 'form-group' });
  csvGroup.appendChild(h('label', {}, 'CSV内容'));
  const csvInput = h('textarea', { placeholder: '设备编号,设备名称,分类,型号,位置,购买日期,备注\nPOS-001,收银机1号,IT设备,HP-500,收银台1号,2024-01-15,主收银', style: 'min-height:160px;font-family:monospace;' });
  csvGroup.appendChild(csvInput);
  body.appendChild(csvGroup);
  const resultDiv = h('div', { style: 'margin-top:12px;' });
  body.appendChild(resultDiv);
  wrap.appendChild(body);
  const footer = h('div', { class: 'modal-footer' });
  footer.appendChild(h('button', { class: 'btn btn-outline', onclick: closeModal }, '取消'));
  footer.appendChild(h('button', { class: 'btn btn-primary', onclick: async () => {
    if (!csvInput.value.trim()) { toast('CSV内容为空'); return; }
    try {
      const r = await API.post('/api/devices/import/csv', { csvText: csvInput.value });
      resultDiv.innerHTML = '';
      resultDiv.appendChild(h('div', { style: 'color:#059669;font-weight:500;' }, '导入成功：' + r.totalImported + ' 条'));
      if (r.totalSkipped > 0) {
        resultDiv.appendChild(h('div', { style: 'color:#d97706;margin-top:4px;' }, '跳过：' + r.totalSkipped + ' 条'));
        r.skipped.forEach(s => {
          resultDiv.appendChild(h('div', { style: 'font-size:12px;color:#6b7280;margin-top:2px;' }, (s.row['设备编号'] || s.row['code'] || '?') + ' - ' + s.reason));
        });
      }
      toast('导入完成', 'success');
    } catch (e) { toast(e.message); }
  } }, '导入'));
  wrap.appendChild(footer);
  return wrap;
}

function renderCreateTemplateModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [h('h2', {}, '新增巡检模板'), h('button', { class: 'modal-close', onclick: closeModal }, '×')]));
  const body = h('div', { class: 'modal-body' });
  const nameGroup = h('div', { class: 'form-group' });
  nameGroup.appendChild(h('label', {}, '模板名称 *'));
  const nameInput = h('input', { type: 'text', placeholder: '如 每日设备巡检', required: 'required' });
  nameGroup.appendChild(nameInput);
  body.appendChild(nameGroup);
  const descGroup = h('div', { class: 'form-group' });
  descGroup.appendChild(h('label', {}, '描述'));
  const descInput = h('textarea', { placeholder: '模板用途说明' });
  descGroup.appendChild(descInput);
  body.appendChild(descGroup);
  body.appendChild(h('h3', { style: 'margin:12px 0 8px;' }, '巡检项'));
  const itemsDiv = h('div', { id: 'tpl-items' });
  body.appendChild(itemsDiv);
  const addItemBtn = h('button', { class: 'btn btn-outline btn-sm', style: 'margin-top:8px;', onclick: () => {
    const row = h('div', { style: 'display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;' });
    const nameIn = h('input', { type: 'text', placeholder: '项名称 *', style: 'flex:2;' });
    const catIn = h('input', { type: 'text', placeholder: '分类', style: 'flex:1;' });
    const descIn = h('input', { type: 'text', placeholder: '说明', style: 'flex:2;' });
    row.appendChild(nameIn); row.appendChild(catIn); row.appendChild(descIn);
    itemsDiv.appendChild(row);
  } }, '+ 添加巡检项'));
  body.appendChild(addItemBtn);
  addItemBtn.onclick();
  addItemBtn.onclick();
  addItemBtn.onclick();
  wrap.appendChild(body);
  const footer = h('div', { class: 'modal-footer' });
  footer.appendChild(h('button', { class: 'btn btn-outline', onclick: closeModal }, '取消'));
  footer.appendChild(h('button', { class: 'btn btn-primary', onclick: async () => {
    if (!nameInput.value) { toast('模板名称必填'); return; }
    const itemRows = itemsDiv.children;
    const items = [];
    for (let i = 0; i < itemRows.length; i++) {
      const inputs = itemRows[i].querySelectorAll('input');
      if (inputs[0].value.trim()) items.push({ name: inputs[0].value, category: inputs[1].value, description: inputs[2].value });
    }
    if (items.length === 0) { toast('至少添加一个巡检项'); return; }
    try {
      await API.post('/api/inspection-templates', { name: nameInput.value, description: descInput.value, items });
      toast('模板已创建', 'success'); closeModal();
    } catch (e) { toast(e.message); }
  } }, '创建'));
  wrap.appendChild(footer);
  return wrap;
}

function renderTemplateDetailModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [h('h2', {}, '巡检模板详情'), h('button', { class: 'modal-close', onclick: closeModal }, '×')]));
  const body = h('div', { class: 'modal-body' }, h('div', { class: 'empty-state' }, '加载中...'));
  wrap.appendChild(body);
  API.get('/api/inspection-templates/' + state.modal.templateId).then(r => {
    const t = r.template;
    body.innerHTML = '';
    const card = h('div', {});
    card.appendChild(h('h3', {}, '基本信息'));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '模板ID'), h('div', { class: 'value' }, t.id)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '名称'), h('div', { class: 'value' }, t.name)]));
    if (t.description) card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '描述'), h('div', { class: 'value' }, t.description)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '创建人'), h('div', { class: 'value' }, t.createdByName)]));
    body.appendChild(card);
    const itemsCard = h('div', { style: 'margin-top:16px;' });
    itemsCard.appendChild(h('h3', {}, '巡检项列表'));
    (t.items || []).forEach((it, i) => {
      itemsCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '#' + (i + 1)), h('div', { class: 'value' }, it.name + (it.category ? ' [' + it.category + ']' : '') + (it.description ? ' - ' + it.description : ''))]));
    });
    body.appendChild(itemsCard);
  }).catch(e => toast(e.message));
  return wrap;
}

function renderCreateInspectionModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [h('h2', {}, '创建巡检单'), h('button', { class: 'modal-close', onclick: closeModal }, '×')]));
  const body = h('div', { class: 'modal-body' }, h('div', { class: 'empty-state' }, '加载中...'));
  wrap.appendChild(body);
  Promise.all([API.get('/api/shifts'), API.get('/api/inspection-templates')]).then(([shiftsR, tplsR]) => {
    body.innerHTML = '';
    const shiftGroup = h('div', { class: 'form-group' });
    shiftGroup.appendChild(h('label', {}, '选择班次 *'));
    const shiftSel = h('select', { required: 'required' });
    shiftSel.appendChild(h('option', { value: '' }, '请选择'));
    shiftsR.shifts.filter(s => s.status !== 'closed').forEach(s => {
      const store = state.stores.find(x => x.id === s.storeId);
      shiftSel.appendChild(h('option', { value: s.id }, s.id + ' ' + s.shiftType + ' ' + s.shiftDate + (store ? ' (' + store.name + ')' : '')));
    });
    shiftGroup.appendChild(shiftSel);
    body.appendChild(shiftGroup);

    const tplGroup = h('div', { class: 'form-group' });
    tplGroup.appendChild(h('label', {}, '巡检模板 *'));
    const tplSel = h('select', { required: 'required' });
    tplSel.appendChild(h('option', { value: '' }, '请选择'));
    tplsR.templates.forEach(t => tplSel.appendChild(h('option', { value: t.id }, t.name + ' (' + t.items.length + '项)')));
    tplGroup.appendChild(tplSel);
    body.appendChild(tplGroup);

    const dateGroup = h('div', { class: 'form-group' });
    dateGroup.appendChild(h('label', {}, '巡检日期'));
    const dateInput = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    dateGroup.appendChild(dateInput);
    body.appendChild(dateGroup);

    const footer = h('div', { class: 'modal-footer' });
    footer.appendChild(h('button', { class: 'btn btn-outline', onclick: closeModal }, '取消'));
    footer.appendChild(h('button', { class: 'btn btn-primary', onclick: async () => {
      if (!shiftSel.value || !tplSel.value) { toast('班次和模板必选'); return; }
      try {
        await API.post('/api/inspections', { shiftId: shiftSel.value, templateId: tplSel.value, inspectionDate: dateInput.value });
        toast('巡检单已创建', 'success'); closeModal();
      } catch (e) { toast(e.message); }
    } }, '创建'));
    wrap.appendChild(footer);
  }).catch(e => toast(e.message));
  return wrap;
}

function renderInspectionDetailModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [h('h2', {}, '巡检单详情'), h('button', { class: 'modal-close', onclick: closeModal }, '×')]));
  const body = h('div', { class: 'modal-body' }, h('div', { class: 'empty-state' }, '加载中...'));
  wrap.appendChild(body);
  API.get('/api/inspections/' + state.modal.inspectionId).then(r => {
    const ins = r.inspection;
    body.innerHTML = '';
    const st = INSPECTION_STATUS_MAP[ins.status] || { label: ins.status, cls: '' };
    const card = h('div', {});
    card.appendChild(h('h3', {}, '基本信息'));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '巡检单ID'), h('div', { class: 'value' }, ins.id)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '班次'), h('div', { class: 'value' }, ins.shiftType + ' ' + ins.shiftDate)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '模板'), h('div', { class: 'value' }, ins.templateName)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '巡检人'), h('div', { class: 'value' }, ins.inspectorName)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '状态'), h('div', { class: 'value' }, h('span', { class: 'badge ' + st.cls }, st.label))]));
    body.appendChild(card);

    const itemsCard = h('div', { style: 'margin-top:16px;' });
    itemsCard.appendChild(h('h3', {}, '巡检项'));
    const itemChanges = [];
    (ins.items || []).forEach((it, i) => {
      const row = h('div', { style: 'border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:8px;' });
      const header = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' });
      header.appendChild(h('div', { style: 'font-weight:500;' }, it.deviceCode + ' - ' + it.templateItemName));
      if (it.result) {
        header.appendChild(h('span', { class: 'badge ' + (it.result === 'normal' ? 'badge-normal' : 'badge-fault') }, it.result === 'normal' ? '正常' : '异常'));
      }
      row.appendChild(header);
      if (ins.status === 'draft') {
        const resultRow = h('div', { style: 'display:flex;gap:8px;margin-bottom:6px;' });
        const normalBtn = h('button', { class: 'btn btn-sm ' + (it.result === 'normal' ? 'btn-success' : 'btn-outline'), onclick: () => { it.result = 'normal'; renderInspectionDetailModal_update(ins, body, itemChanges); } }, '正常');
        const abnormalBtn = h('button', { class: 'btn btn-sm ' + (it.result === 'abnormal' ? 'btn-danger' : 'btn-outline'), onclick: () => { it.result = 'abnormal'; renderInspectionDetailModal_update(ins, body, itemChanges); } }, '异常');
        resultRow.appendChild(normalBtn); resultRow.appendChild(abnormalBtn);
        row.appendChild(resultRow);
        const attachRow = h('div', { style: 'margin-bottom:4px;' });
        attachRow.appendChild(h('input', { type: 'text', placeholder: '附件说明', value: it.attachmentNote || '', style: 'width:100%;', oninput: (e) => { it.attachmentNote = e.target.value; } }));
        row.appendChild(attachRow);
        const tempRow = h('div', {});
        tempRow.appendChild(h('input', { type: 'text', placeholder: '临时处理结果', value: it.tempHandling || '', style: 'width:100%;', oninput: (e) => { it.tempHandling = e.target.value; } }));
        row.appendChild(tempRow);
      } else {
        if (it.attachmentNote) row.appendChild(h('div', { style: 'font-size:12px;color:#6b7280;' }, '附件说明: ' + it.attachmentNote));
        if (it.tempHandling) row.appendChild(h('div', { style: 'font-size:12px;color:#6b7280;' }, '临时处理: ' + it.tempHandling));
      }
      itemsCard.appendChild(row);
    });
    body.appendChild(itemsCard);

    const actionsBar = h('div', { style: 'margin-top:20px;display:flex;gap:8px;flex-wrap:wrap;' });
    if (ins.status === 'draft' && (ins.inspectorId === state.user.id || state.user.role === 'manager')) {
      actionsBar.appendChild(h('button', { class: 'btn btn-primary', onclick: async () => {
        const items = ins.items.map(it => ({ id: it.id, result: it.result, attachmentNote: it.attachmentNote, tempHandling: it.tempHandling }));
        try {
          await API.put('/api/inspections/' + ins.id, { items, status: 'submitted', updatedAt: ins.updatedAt });
          toast('巡检单已提交', 'success'); state.modal = { type: 'inspectionDetail', inspectionId: ins.id }; render();
        } catch (e) { toast(e.message); }
      } }, '提交巡检单'));
      actionsBar.appendChild(h('button', { class: 'btn btn-outline', onclick: async () => {
        const items = ins.items.map(it => ({ id: it.id, result: it.result, attachmentNote: it.attachmentNote, tempHandling: it.tempHandling }));
        try {
          await API.put('/api/inspections/' + ins.id, { items, updatedAt: ins.updatedAt });
          toast('已保存', 'success'); state.modal = { type: 'inspectionDetail', inspectionId: ins.id }; render();
        } catch (e) { toast(e.message); }
      } }, '保存草稿'));
    }
    if (ins.status === 'submitted') {
      const abnormalItems = ins.items.filter(it => it.result === 'abnormal');
      if (abnormalItems.length > 0) {
        actionsBar.appendChild(h('button', { class: 'btn btn-danger', onclick: async () => {
          try {
            await API.post('/api/inspections/' + ins.id + '/convert-to-repair', { itemIds: abnormalItems.map(it => it.id) });
            toast('已转维修单', 'success'); state.modal = { type: 'inspectionDetail', inspectionId: ins.id }; render();
          } catch (e) { toast(e.message); }
        } }, '转维修单（' + abnormalItems.length + '项异常）'));
      }
    }
    if (actionsBar.children.length > 0) body.appendChild(actionsBar);
  }).catch(e => toast(e.message));
  return wrap;
}

function renderRepairOrderDetailModal() {
  const wrap = h('div', {});
  wrap.appendChild(h('div', { class: 'modal-header' }, [h('h2', {}, '维修单详情'), h('button', { class: 'modal-close', onclick: closeModal }, '×')]));
  const body = h('div', { class: 'modal-body' }, h('div', { class: 'empty-state' }, '加载中...'));
  wrap.appendChild(body);
  API.get('/api/repair-orders/' + state.modal.repairOrderId).then(r => {
    const o = r.repairOrder;
    body.innerHTML = '';
    const st = REPAIR_STATUS_MAP[o.status] || { label: o.status, cls: '' };
    const card = h('div', {});
    card.appendChild(h('h3', {}, '基本信息'));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '维修单ID'), h('div', { class: 'value' }, o.id)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '设备'), h('div', { class: 'value' }, o.deviceCode + ' ' + o.deviceName)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '位置'), h('div', { class: 'value' }, o.deviceLocation || '-')]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '标题'), h('div', { class: 'value' }, o.title)]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '描述'), h('div', { class: 'value' }, o.description || '-')]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '状态'), h('div', { class: 'value' }, h('span', { class: 'badge ' + st.cls }, st.label))]));
    card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '报修人'), h('div', { class: 'value' }, o.createdByName)]));
    if (o.assigneeName) card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '接修人'), h('div', { class: 'value' }, o.assigneeName)]));
    if (o.completedNote) card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '完成说明'), h('div', { class: 'value' }, o.completedNote)]));
    if (o.verifiedNote) card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '验收说明'), h('div', { class: 'value' }, o.verifiedNote)]));
    if (o.rejectedNote) card.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, '退回原因'), h('div', { class: 'value' }, o.rejectedNote)]));
    body.appendChild(card);

    if (o.abnormalItems && o.abnormalItems.length > 0) {
      const abnCard = h('div', { style: 'margin-top:16px;' });
      abnCard.appendChild(h('h3', {}, '异常项'));
      o.abnormalItems.forEach(it => {
        abnCard.appendChild(h('div', { class: 'detail-row' }, [h('div', { class: 'label' }, it.templateItemName), h('div', { class: 'value' }, (it.attachmentNote || '-') + (it.tempHandling ? ' [临时处理: ' + it.tempHandling + ']' : '')]));
      });
      body.appendChild(abnCard);
    }

    const histCard = h('div', { style: 'margin-top:16px;' });
    histCard.appendChild(h('h3', {}, '状态历史'));
    const histBody = h('div', {});
    (o.statusHistory || []).forEach(item => {
      const hi = h('div', { class: 'history-item' });
      hi.appendChild(h('div', { class: 'hi-time' }, formatDate(item.at)));
      const label = (REPAIR_STATUS_MAP[item.status] || { label: item.status }).label;
      hi.appendChild(h('div', { class: 'hi-action' }, label));
      hi.appendChild(h('div', { class: 'hi-user' }, item.byName));
      hi.appendChild(h('div', { class: 'hi-detail' }, item.note || '-'));
      histBody.appendChild(hi);
    });
    histCard.appendChild(histBody);
    body.appendChild(histCard);

    const actionsBar = h('div', { style: 'margin-top:20px;display:flex;gap:8px;flex-wrap:wrap;' });
    if ((o.status === 'reported' || o.status === 'rejected') && state.user.role === 'manager' && o.storeId === state.user.storeId) {
      actionsBar.appendChild(h('button', { class: 'btn btn-primary', onclick: async () => {
        const storeUsers = state.users.filter(u => u.storeId === state.user.storeId && u.role === 'staff');
        const names = storeUsers.map(u => u.id + ':' + u.name).join('\n');
        const assigneeId = prompt('选择接修人（输入用户ID）:\n' + names);
        if (!assigneeId) return;
        try {
          await API.post('/api/repair-orders/' + o.id + '/assign', { assigneeId, note: '', updatedAt: o.updatedAt });
          toast('已分派', 'success'); state.modal = { type: 'repairOrderDetail', repairOrderId: o.id }; render();
        } catch (e) { toast(e.message); }
      } }, '分派维修'));
    }
    if ((o.status === 'accepted' || o.status === 'rejected') && (o.assigneeId === state.user.id || state.user.role === 'manager') && o.storeId === state.user.storeId) {
      actionsBar.appendChild(h('button', { class: 'btn btn-success', onclick: async () => {
        const note = prompt('请填写维修完成说明：') || '';
        try {
          await API.post('/api/repair-orders/' + o.id + '/complete', { completedNote: note, updatedAt: o.updatedAt });
          toast('维修已完成', 'success'); state.modal = { type: 'repairOrderDetail', repairOrderId: o.id }; render();
        } catch (e) { toast(e.message); }
      } }, '完成维修'));
    }
    if (o.status === 'completed' && state.user.role === 'manager' && o.storeId === state.user.storeId) {
      actionsBar.appendChild(h('button', { class: 'btn btn-success', onclick: async () => {
        const note = prompt('验收意见（可选）：') || '';
        try {
          await API.post('/api/repair-orders/' + o.id + '/verify', { verifiedNote: note, updatedAt: o.updatedAt });
          toast('验收通过', 'success'); state.modal = { type: 'repairOrderDetail', repairOrderId: o.id }; render();
        } catch (e) { toast(e.message); }
      } }, '验收关闭'));
      actionsBar.appendChild(h('button', { class: 'btn btn-danger', onclick: async () => {
        const note = prompt('退回原因：');
        if (note == null) return;
        try {
          await API.post('/api/repair-orders/' + o.id + '/reject', { rejectedNote: note, updatedAt: o.updatedAt });
          toast('已退回', 'success'); state.modal = { type: 'repairOrderDetail', repairOrderId: o.id }; render();
        } catch (e) { toast(e.message); }
      } }, '退回'));
    }
    if (actionsBar.children.length > 0) body.appendChild(actionsBar);
  }).catch(e => toast(e.message));
  return wrap;
}

bootstrap();
