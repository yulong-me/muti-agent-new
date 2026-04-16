/**
 * F016: Scene API routes
 *
 * GET    /api/scenes        — list all scenes
 * POST   /api/scenes        — create custom scene
 * PUT    /api/scenes/:id    — update scene
 * DELETE /api/scenes/:id    — delete custom scene
 */

import { Router } from 'express';
import { scenesRepo } from '../db/index.js';
import { log } from '../lib/logger.js';

export const scenesRouter = Router();

// GET /api/scenes — list all scenes with permission flags
scenesRouter.get('/', (_req, res) => {
  const scenes = scenesRepo.list();
  const result = scenes.map(s => ({
    ...s,
    canDelete: !s.builtin,
    canEditName: !s.builtin,
    canEditPrompt: true, // both builtin and custom can edit prompt
  }));
  res.json(result);
});

// POST /api/scenes — create custom scene
scenesRouter.post('/', (req, res) => {
  const { name, description, prompt } = req.body as {
    name?: string;
    description?: string;
    prompt?: string;
  };

  if (!name?.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  if (!prompt?.trim()) {
    return res.status(400).json({ error: 'prompt required' });
  }

  try {
    const scene = scenesRepo.create({
      name: name.trim(),
      description: description?.trim() || undefined,
      prompt: prompt.trim(),
    });
    log('INFO', 'scene:create', { id: scene.id, name: scene.name });
    res.status(201).json(scene);
  } catch (err) {
    log('ERROR', 'scene:create:failed', { error: String(err) });
    res.status(500).json({ error: 'Failed to create scene' });
  }
});

// PUT /api/scenes/:id — update scene
scenesRouter.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, prompt } = req.body as {
    name?: string;
    description?: string;
    prompt?: string;
  };

  const existing = scenesRepo.get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Scene not found' });
  }

  if (existing.builtin && name !== undefined) {
    return res.status(403).json({ code: 'BUILTIN_NAME_LOCKED', error: 'Cannot rename builtin scene' });
  }

  // P2-5: reject empty name (but allow omitting it via undefined)
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }

  if (prompt !== undefined && !prompt.trim()) {
    return res.status(400).json({ error: 'prompt cannot be empty' });
  }

  const updated = scenesRepo.update(id, {
    name: name?.trim(),
    description: description?.trim(),
    prompt: prompt?.trim(),
  });

  if (!updated) {
    return res.status(403).json({ code: 'BUILTIN_NAME_LOCKED', error: 'Cannot rename builtin scene' });
  }

  log('INFO', 'scene:update', { id: updated.id });
  res.json(updated);
});

// DELETE /api/scenes/:id — delete custom scene
scenesRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  const result = scenesRepo.delete(id);

  if (result === 'BUILTIN') {
    return res.status(403).json({ code: 'BUILTIN_SCENE', error: 'Cannot delete builtin scene' });
  }
  if (result === 'IN_USE') {
    return res.status(409).json({ code: 'SCENE_IN_USE', error: 'Scene is referenced by one or more rooms' });
  }

  log('INFO', 'scene:delete', { id });
  res.json({ status: 'ok' });
});