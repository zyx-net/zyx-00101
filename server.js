const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const authRoutes = require('./server/routes/auth');
const configRoutes = require('./server/routes/config');
const shiftRoutes = require('./server/routes/shifts');
const exceptionRoutes = require('./server/routes/exceptions');
const taskRoutes = require('./server/routes/tasks');
const deviceRoutes = require('./server/routes/devices');
const inspectionRoutes = require('./server/routes/inspections');
const inspectionTemplateRoutes = require('./server/routes/inspection-templates');
const repairOrderRoutes = require('./server/routes/repair-orders');
const exportRoutes = require('./server/routes/export');
const historyRoutes = require('./server/routes/history');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (req.body && req.body._method) {
    req.method = req.body._method.toUpperCase();
    delete req.body._method;
  }
  if (req.query._method) {
    req.method = req.query._method.toUpperCase();
    delete req.query._method;
  }
  next();
});
app.use(session({
  secret: 'store-shift-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', authRoutes);
app.use('/api/config', configRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/exceptions', exceptionRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/inspection-templates', inspectionTemplateRoutes);
app.use('/api/repair-orders', repairOrderRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/history', historyRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  门店交接班异常追踪系统启动成功`);
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`========================================\n`);
  console.log(`样例账号：`);
  console.log(`  店长张店长： manager1 / manager123  (朝阳店)`);
  console.log(`  店长李店长： manager2 / manager123  (海淀店)`);
  console.log(`  员工王早班： staff1   / staff123    (朝阳店)`);
  console.log(`  员工赵中班： staff2   / staff123    (朝阳店)`);
  console.log(`  员工孙晚班： staff3   / staff123    (朝阳店)`);
  console.log(``);
});
