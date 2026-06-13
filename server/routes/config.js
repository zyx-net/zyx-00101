const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth } = require('../middleware/auth');

router.get('/stores', requireAuth, (req, res) => {
  res.json({ stores: db.getStores() });
});

router.get('/checklist', requireAuth, (req, res) => {
  res.json({ checklist: db.getChecklist() });
});

router.get('/users', requireAuth, (req, res) => {
  const users = db.getUsers().map(u => {
    const { password, ...safe } = u;
    return safe;
  });
  if (req.session.user.role === 'staff') {
    res.json({ users: users.filter(u => u.storeId === req.session.user.storeId) });
  } else {
    res.json({ users });
  }
});

module.exports = router;
