const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const { shiftId } = req.query;
  let history = db.getHistory();
  if (shiftId) history = history.filter(h => h.shiftId === shiftId);
  history.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  res.json({ history });
});

module.exports = router;
