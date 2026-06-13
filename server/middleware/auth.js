function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  next();
}

function requireManager(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '未登录' });
  }
  if (req.session.user.role !== 'manager') {
    return res.status(403).json({ error: '权限不足：仅店长可执行此操作' });
  }
  next();
}

function requireSameStore(resourceStoreId) {
  return function(req, res, next) {
    if (!req.session.user) {
      return res.status(401).json({ error: '未登录' });
    }
    const userStoreId = req.session.user.storeId;
    const targetStoreId = typeof resourceStoreId === 'function' 
      ? resourceStoreId(req) 
      : resourceStoreId;
    
    if (targetStoreId && targetStoreId !== userStoreId) {
      return res.status(403).json({ error: '无权操作非本门店数据' });
    }
    next();
  };
}

function checkStoreAccess(user, resourceStoreId) {
  if (user.role === 'staff') {
    return user.storeId === resourceStoreId;
  }
  return user.storeId === resourceStoreId;
}

function canAccessStore(user, storeId) {
  return user.storeId === storeId;
}

function isManager(user) {
  return user && user.role === 'manager';
}

function isStaff(user) {
  return user && user.role === 'staff';
}

module.exports = {
  requireAuth,
  requireManager,
  requireSameStore,
  checkStoreAccess,
  canAccessStore,
  isManager,
  isStaff
};
