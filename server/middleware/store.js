const db = require('../store');

function filterByStore(items, user, getStoreId) {
  const userStoreId = user.storeId;
  return items.filter(item => {
    const itemStoreId = getStoreId ? getStoreId(item) : item.storeId;
    return itemStoreId === userStoreId;
  });
}

function filterShiftsByStore(shifts, user) {
  return filterByStore(shifts, user, s => s.storeId);
}

function filterExceptionsByStore(exceptions, user) {
  if (user.role === 'staff') {
    const myShifts = db.getShifts().filter(s => s.storeId === user.storeId).map(s => s.id);
    return exceptions.filter(e => myShifts.includes(e.shiftId));
  }
  return exceptions;
}

function filterTasksByStore(tasks, user) {
  return filterByStore(tasks, user, t => t.storeId);
}

function filterDevicesByStore(devices, user) {
  return filterByStore(devices, user, d => d.storeId);
}

function filterInspectionsByStore(inspections, user) {
  return filterByStore(inspections, user, i => i.storeId);
}

function filterRepairOrdersByStore(orders, user) {
  return filterByStore(orders, user, o => o.storeId);
}

function filterTemplatesByStore(templates, user) {
  return filterByStore(templates, user, t => t.storeId);
}

function requireSameStoreOrManager(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
}

function createStoreFilter(user) {
  return function(items, getStoreId) {
    return filterByStore(items, user, getStoreId);
  };
}

module.exports = {
  filterByStore,
  filterShiftsByStore,
  filterExceptionsByStore,
  filterTasksByStore,
  filterDevicesByStore,
  filterInspectionsByStore,
  filterRepairOrdersByStore,
  filterTemplatesByStore,
  requireSameStoreOrManager,
  createStoreFilter
};
