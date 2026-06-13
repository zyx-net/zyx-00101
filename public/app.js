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
  REJECT_TASK: '驳回整改'
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
  const storeInput = prompt('按门店ID导出（留空导出全部，例如 S001）：') || '';
  const params = new URLSearchParams();
  if (storeInput) params.set('storeId', storeInput);
  if (type !== 'tasks') {
    const dateInput = prompt('按日期导出（留空导出全部，格式 YYYY-MM-DD）：') || '';
    if (dateInput) params.set('date', dateInput);
  }
  params.set('format', format);
  window.open('/api/export/' + type + '?' + params.toString(), '_blank');
}

bootstrap();
