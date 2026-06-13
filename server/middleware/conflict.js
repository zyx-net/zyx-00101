function checkUpdatedAt(resource, clientUpdatedAt) {
  if (!clientUpdatedAt) {
    return { valid: true };
  }
  if (resource.updatedAt !== clientUpdatedAt) {
    return {
      valid: false,
      error: '数据已被他人修改，请刷新后重试',
      currentUpdatedAt: resource.updatedAt
    };
  }
  return { valid: true };
}

function createConflictCheck(getUpdatedAt) {
  return function(req, res, next) {
    const clientUpdatedAt = req.body.updatedAt;
    if (!clientUpdatedAt) {
      return next();
    }
    const resourceUpdatedAt = getUpdatedAt(req);
    if (resourceUpdatedAt && resourceUpdatedAt !== clientUpdatedAt) {
      return res.status(409).json({
        error: '数据已被他人修改，请刷新后重试',
        currentUpdatedAt: resourceUpdatedAt
      });
    }
    next();
  };
}

function conflictMiddleware(resourceGetter) {
  return function(req, res, next) {
    const clientUpdatedAt = req.body.updatedAt;
    if (!clientUpdatedAt) {
      return next();
    }
    const resource = resourceGetter(req);
    if (!resource) {
      return next();
    }
    const result = checkUpdatedAt(resource, clientUpdatedAt);
    if (!result.valid) {
      return res.status(409).json({
        error: result.error,
        currentUpdatedAt: result.currentUpdatedAt
      });
    }
    next();
  };
}

module.exports = {
  checkUpdatedAt,
  createConflictCheck,
  conflictMiddleware
};
