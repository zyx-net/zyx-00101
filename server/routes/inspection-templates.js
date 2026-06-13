const express = require('express');
const router = express.Router();
const db = require('../store');
const { requireAuth, requireManager } = require('../middleware/auth');
const { filterTemplatesByStore } = require('../middleware/store');
const { checkUpdatedAt } = require('../middleware/conflict');

router.get('/', requireAuth, (req, res) => {
  const { storeId } = req.query;
  let templates = db.getInspectionTemplates();
  templates = filterTemplatesByStore(templates, req.session.user);
  if (storeId) templates = templates.filter(t => t.storeId === storeId);
  templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ templates });
});

router.get('/:id', requireAuth, (req, res) => {
  const tpl = db.getInspectionTemplates().find(t => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: '巡检模板不存在' });
  if (tpl.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '无权查看非本门店模板' });
  }
  res.json({ template: tpl });
});

router.post('/', requireManager, (req, res) => {
  const { name, description, items, storeId } = req.body;
  if (!name) return res.status(400).json({ error: '模板名称必填' });
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: '巡检项必填' });
  const targetStoreId = storeId || req.session.user.storeId;
  if (targetStoreId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可创建模板' });
  }
  const now = new Date().toISOString();
  const tpl = {
    id: db.genId('IT'),
    storeId: targetStoreId,
    name,
    description: description || '',
    items: items.map((it, i) => ({
      id: 'ITEM' + (i + 1),
      name: it.name || '',
      category: it.category || '',
      description: it.description || '',
      required: !!it.required,
      sort: i + 1
    })),
    createdAt: now,
    createdBy: req.session.user.id,
    createdByName: req.session.user.name,
    updatedAt: now
  };
  const templates = db.getInspectionTemplates();
  templates.push(tpl);
  db.saveInspectionTemplates(templates);
  db.addHistory({
    action: 'CREATE_TEMPLATE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '创建巡检模板 ' + name,
    storeId
  });
  res.json({ template: tpl });
});

router.put('/:id', requireManager, (req, res) => {
  const templates = db.getInspectionTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '巡检模板不存在' });
  const tpl = templates[idx];
  if (tpl.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可修改模板' });
  }
  const { updatedAt } = req.body;
  const conflict = checkUpdatedAt(tpl, updatedAt);
  if (!conflict.valid) {
    return res.status(409).json({ error: conflict.error, currentUpdatedAt: conflict.currentUpdatedAt });
  }
  if (req.body.name !== undefined) tpl.name = req.body.name;
  if (req.body.description !== undefined) tpl.description = req.body.description;
  if (req.body.items !== undefined && Array.isArray(req.body.items)) {
    tpl.items = req.body.items.map((it, i) => ({
      id: it.id || ('ITEM' + (i + 1)),
      name: it.name || '',
      category: it.category || '',
      description: it.description || '',
      required: !!it.required,
      sort: i + 1
    }));
  }
  tpl.updatedAt = new Date().toISOString();
  templates[idx] = tpl;
  db.saveInspectionTemplates(templates);
  db.addHistory({
    action: 'UPDATE_TEMPLATE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '修改巡检模板 ' + tpl.name,
    storeId: tpl.storeId
  });
  res.json({ template: tpl });
});

router.delete('/:id', requireManager, (req, res) => {
  const templates = db.getInspectionTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '巡检模板不存在' });
  const tpl = templates[idx];
  if (tpl.storeId !== req.session.user.storeId) {
    return res.status(403).json({ error: '仅本门店店长可删除模板' });
  }
  templates.splice(idx, 1);
  db.saveInspectionTemplates(templates);
  db.addHistory({
    action: 'DELETE_TEMPLATE',
    userId: req.session.user.id,
    userName: req.session.user.name,
    detail: '删除巡检模板 ' + tpl.name,
    storeId: tpl.storeId
  });
  res.json({ ok: true });
});

module.exports = router;
