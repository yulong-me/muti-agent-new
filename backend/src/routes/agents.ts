import { Router, type Request, type Response } from 'express';
import { getAgents, getAgent, saveAgents, type AgentConfig } from '../config/agentConfig.js';
import { debug, info, warn } from '../lib/logger.js';
import { listAgentSkillBindings, replaceAgentSkillBindings } from '../services/skills.js';

export const agentsRouter = Router();

// GET /api/agents — list all agents
agentsRouter.get('/', (_req: Request, res: Response) => {
  const agents = getAgents();
  debug('agent:list', { count: agents.length });
  res.json(agents);
});

// GET /api/agents/:id — get single agent
agentsRouter.get('/:id', (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    warn('agent:get:not_found', { agentId: req.params.id });
    return res.status(404).json({ error: 'Agent not found' });
  }
  debug('agent:get', { agentId: agent.id, provider: agent.provider, role: agent.role });
  res.json(agent);
});

agentsRouter.get('/:id/skills', (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    warn('agent:skills:get:not_found', { agentId: req.params.id });
    return res.status(404).json({ error: 'Agent not found' });
  }
  const bindings = listAgentSkillBindings(req.params.id);
  debug('agent:skills:get', { agentId: req.params.id, bindingCount: bindings.length });
  res.json(bindings);
});

agentsRouter.put('/:id/skills', (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    warn('agent:skills:update:not_found', { agentId: req.params.id });
    return res.status(404).json({ error: 'Agent not found' });
  }

  const bindings = Array.isArray(req.body?.bindings) ? req.body.bindings : [];
  try {
    const next = replaceAgentSkillBindings(req.params.id, bindings);
    info('agent:skills:update', { agentId: req.params.id, bindingCount: next.length });
    res.json(next);
  } catch (err) {
    warn('agent:skills:update:invalid', { agentId: req.params.id, error: err });
    res.status(400).json({ error: (err as Error).message || 'Failed to update agent skills' });
  }
});

// POST /api/agents — create new agent
agentsRouter.post('/', (req: Request, res: Response) => {
  const agents = getAgents();
  const body = req.body as Partial<AgentConfig>;

  if (!body.id || !body.name || !body.provider) {
    warn('agent:create:invalid', { reason: 'missing_required_fields', agentId: body.id, provider: body.provider });
    return res.status(400).json({ error: 'id, name, and provider are required' });
  }
  if (agents.some(a => a.id === body.id)) {
    warn('agent:create:duplicate', { agentId: body.id });
    return res.status(409).json({ error: 'Agent with this id already exists' });
  }

  const newAgent: AgentConfig = {
    id: body.id,
    name: body.name,
    roleLabel: body.roleLabel ?? body.name,
    role: (body.role as string === 'HOST' ? 'MANAGER' : (body.role as string) === 'AGENT' ? 'WORKER' : (body.role ?? 'WORKER')) as AgentConfig['role'],
    provider: body.provider,
    providerOpts: body.providerOpts ?? {},
    systemPrompt: body.systemPrompt ?? '',
    enabled: body.enabled ?? true,
    tags: body.tags ?? [],
  };

  agents.push(newAgent);
  saveAgents(agents);
  info('agent:create', {
    agentId: newAgent.id,
    name: newAgent.name,
    provider: newAgent.provider,
    role: newAgent.role,
    enabled: newAgent.enabled,
  });
  res.status(201).json(newAgent);
});

// PUT /api/agents/:id — update agent
agentsRouter.put('/:id', (req: Request, res: Response) => {
  const agents = getAgents();
  const idx = agents.findIndex(a => a.id === req.params.id);
  if (idx === -1) {
    warn('agent:update:not_found', { agentId: req.params.id });
    return res.status(404).json({ error: 'Agent not found' });
  }

  const rawRole = req.body.role;
  const normalizedRole: AgentConfig['role'] = ((rawRole as unknown as string) === 'HOST' ? 'MANAGER' : (rawRole as unknown as string) === 'AGENT' ? 'WORKER' : (rawRole ?? 'WORKER')) as AgentConfig['role'];
  const updated: AgentConfig = { ...agents[idx], ...req.body, role: normalizedRole, id: req.params.id };
  agents[idx] = updated;
  saveAgents(agents);
  info('agent:update', {
    agentId: updated.id,
    name: updated.name,
    provider: updated.provider,
    role: updated.role,
    enabled: updated.enabled,
  });
  res.json(updated);
});

// DELETE /api/agents/:id — delete agent
agentsRouter.delete('/:id', (req: Request, res: Response) => {
  const agents = getAgents();
  const agent = agents.find(a => a.id === req.params.id);
  if (!agent) {
    warn('agent:delete:not_found', { agentId: req.params.id });
    return res.status(404).json({ error: 'Agent not found' });
  }
  if (agent.role === 'MANAGER') {
    warn('agent:delete:forbidden', { agentId: req.params.id, reason: 'manager_agent' });
    return res.status(403).json({ error: 'Cannot delete MANAGER agent' });
  }

  saveAgents(agents.filter(a => a.id !== req.params.id));
  info('agent:delete', {
    agentId: agent.id,
    name: agent.name,
    provider: agent.provider,
    role: agent.role,
  });
  res.status(204).end();
});
