const SHIFT_STATUS = {
  DRAFT: 'draft',
  HANDED_OVER: 'handed_over',
  CONFIRMED: 'confirmed',
  REVIEWING: 'reviewing',
  CLOSED: 'closed',
  RETURNED: 'returned'
};

const EXCEPTION_STATUS = {
  OPEN: 'open',
  HANDLED: 'handled',
  CLOSED: 'closed'
};

const TASK_STATUS = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  SUBMITTED: 'submitted',
  REJECTED: 'rejected',
  CLOSED: 'closed'
};

const DEVICE_STATUS = {
  NORMAL: 'normal',
  FAULT: 'fault',
  MAINTENANCE: 'maintenance',
  SCRAPPED: 'scrapped'
};

const INSPECTION_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  CONVERTED: 'converted'
};

const REPAIR_STATUS = {
  REPORTED: 'reported',
  ACCEPTED: 'accepted',
  COMPLETED: 'completed',
  VERIFIED: 'verified',
  REJECTED: 'rejected'
};

const STATUS_LABELS = {
  shift: {
    draft: '草稿',
    handed_over: '待确认',
    confirmed: '已确认',
    reviewing: '复核中',
    closed: '已关闭',
    returned: '已退回'
  },
  exception: {
    open: '待处理',
    handled: '已处理',
    closed: '已关闭'
  },
  task: {
    pending: '待分派',
    assigned: '已分派',
    submitted: '已提交',
    rejected: '已驳回',
    closed: '已关闭'
  },
  device: {
    normal: '正常',
    fault: '故障',
    maintenance: '维护中',
    scrapped: '已报废'
  },
  inspection: {
    draft: '草稿',
    submitted: '已提交',
    converted: '已转维修'
  },
  repair: {
    reported: '已报修',
    accepted: '已接单',
    completed: '已完成',
    verified: '已验收',
    rejected: '已退回'
  }
};

module.exports = {
  SHIFT_STATUS,
  EXCEPTION_STATUS,
  TASK_STATUS,
  DEVICE_STATUS,
  INSPECTION_STATUS,
  REPAIR_STATUS,
  STATUS_LABELS
};
