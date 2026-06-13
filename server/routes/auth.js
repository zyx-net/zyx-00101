const express = require('express');
const router = express.Router();
const db = require('../store');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.findUserByUsername(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const { password: _, ...safeUser } = user;
  req.session.user = safeUser;
  res.json({ user: safeUser });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

module.exports = router;
