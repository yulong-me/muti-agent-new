import { Router } from 'express';
import { debug, info, warn } from '../lib/logger.js';
import {
  createManagedSkill,
  deleteManagedSkill,
  discoverSystemGlobalSkills,
  discoverWorkspaceSkills,
  getManagedSkill,
  importManagedSkillFolder,
  listManagedSkills,
  updateManagedSkill,
} from '../services/skills.js';
import { validateWorkspacePath } from '../services/workspace.js';

export const skillsRouter = Router();

skillsRouter.get('/', async (_req, res) => {
  const skills = await listManagedSkills();
  debug('skill:list', { count: skills.length });
  res.json(skills);
});

skillsRouter.get('/global', async (_req, res) => {
  const skills = await discoverSystemGlobalSkills();
  debug('skill:global:list', { count: skills.length });
  res.json(skills);
});

skillsRouter.post('/import-folder', async (req, res) => {
  const sourcePath = typeof req.body?.sourcePath === 'string' ? req.body.sourcePath.trim() : '';
  if (!sourcePath) {
    warn('skill:import:invalid', { reason: 'missing_source_path' });
    return res.status(400).json({ error: 'sourcePath is required' });
  }

  try {
    await validateWorkspacePath(sourcePath);
    const skill = await importManagedSkillFolder({
      sourcePath,
      name: typeof req.body?.name === 'string' ? req.body.name : undefined,
    });
    info('skill:import', { name: skill.name, sourcePath, enabled: skill.enabled });
    res.status(201).json(skill);
  } catch (err) {
    const message = (err as Error).message || 'Failed to import skill folder';
    const status = /already exists/i.test(message) ? 409 : 400;
    warn('skill:import:failed', { sourcePath, status, error: err });
    res.status(status).json({ error: message });
  }
});

skillsRouter.post('/discover', async (req, res) => {
  const workspacePath = typeof req.body?.workspacePath === 'string' ? req.body.workspacePath.trim() : '';

  try {
    const globalSkills = await discoverSystemGlobalSkills();
    if (!workspacePath) {
      debug('skill:discover', { workspacePath: null, globalCount: globalSkills.length, workspaceCount: 0 });
      return res.json({
        workspacePath: null,
        workspaceRoot: null,
        scanBoundary: null,
        globalSkills,
        workspaceSkills: [],
        skills: globalSkills,
      });
    }

    await validateWorkspacePath(workspacePath);
    const result = await discoverWorkspaceSkills(workspacePath);
    debug('skill:discover', {
      workspacePath: result.workspacePath,
      workspaceRoot: result.workspaceRoot,
      scanBoundary: result.scanBoundary,
      globalCount: result.globalSkills.length,
      workspaceCount: result.workspaceSkills.length,
      mergedCount: result.skills.length,
    });
    res.json({
      workspacePath: result.workspacePath,
      workspaceRoot: result.workspaceRoot,
      scanBoundary: result.scanBoundary,
      globalSkills: result.globalSkills,
      workspaceSkills: result.workspaceSkills,
      skills: result.skills,
    });
  } catch (err) {
    warn('skill:discover:failed', { workspacePath, error: err });
    res.status(400).json({ error: (err as Error).message || 'Workspace discovery failed' });
  }
});

skillsRouter.post('/', async (req, res) => {
  try {
    const skill = await createManagedSkill(req.body ?? {});
    info('skill:create', { name: skill.name, enabled: skill.enabled });
    res.status(201).json(skill);
  } catch (err) {
    const message = (err as Error).message || 'Failed to create skill';
    const status = /already exists/i.test(message) ? 409 : 400;
    warn('skill:create:failed', { status, error: err });
    res.status(status).json({ error: message });
  }
});

skillsRouter.put('/:name', async (req, res) => {
  try {
    const skill = await updateManagedSkill(req.params.name, req.body ?? {});
    info('skill:update', { name: skill.name, enabled: skill.enabled });
    res.json(skill);
  } catch (err) {
    const message = (err as Error).message || 'Failed to update skill';
    const status = /not found/i.test(message) ? 404 : 400;
    warn('skill:update:failed', { name: req.params.name, status, error: err });
    res.status(status).json({ error: message });
  }
});

skillsRouter.delete('/:name', async (req, res) => {
  const result = await deleteManagedSkill(req.params.name);
  if (result === 'NOT_FOUND') {
    warn('skill:delete:not_found', { name: req.params.name });
    return res.status(404).json({ error: 'Skill not found' });
  }
  if (result === 'IN_USE') {
    warn('skill:delete:in_use', { name: req.params.name });
    return res.status(409).json({ code: 'SKILL_IN_USE', error: 'Skill is still bound to agents or rooms' });
  }
  info('skill:delete', { name: req.params.name });
  res.status(204).end();
});

skillsRouter.get('/:name', async (req, res) => {
  const skill = await getManagedSkill(req.params.name);
  if (!skill) {
    warn('skill:get:not_found', { name: req.params.name });
    return res.status(404).json({ error: 'Skill not found' });
  }
  debug('skill:get', { name: skill.name, enabled: skill.enabled });
  res.json(skill);
});
