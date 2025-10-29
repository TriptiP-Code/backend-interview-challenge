// src/routes/tasks.ts
import express from 'express';
import * as taskService from '../services/taskService';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const tasks = await taskService.getAllTasks();
    return res.json({ tasks });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const t = await taskService.getTaskById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    return res.json({ task: t });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', express.json(), async (req, res) => {
  try {
    const { title, description, completed } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const t = await taskService.createTask({ title: title.trim(), description, completed });
    return res.status(201).json({ task: t });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', express.json(), async (req, res) => {
  try {
    const { title, description, completed } = req.body ?? {};
    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ error: 'title must be a non-empty string' });
    }
    const updated = await taskService.updateTask(req.params.id, {
      title: title === undefined ? undefined : title.trim(),
      description,
      completed
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json({ task: updated });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await taskService.softDeleteTask(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    return res.status(204).send();
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
