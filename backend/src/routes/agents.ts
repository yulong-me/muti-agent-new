import { Router, type Request, type Response } from 'express';
import { getAgents, getAgent, saveAgents, type AgentConfig } from '../config/agentConfig.js';

export const agentsRouter = Router();

// GET /api/agents — list all agents
agentsRouter.get('/', (_req: Request, res: Response) => {
  res.json(getAgents());
});

// GET /api/agents/:id — get single agent
agentsRouter.get('/:id', (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

// POST /api/agents — create new agent
agentsRouter.post('/', (req: Request, res: Response) => {
  const agents = getAgents();
  const body = req.body as Partial<AgentConfig>;

  if (!body.id || !body.name || !body.provider) {
    return res.status(400).json({ error: 'id, name, and provider are required' });
  }
  if (agents.some(a => a.id === body.id)) {
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
  res.status(201).json(newAgent);
});

// PUT /api/agents/:id — update agent
agentsRouter.put('/:id', (req: Request, res: Response) => {
  const agents = getAgents();
  const idx = agents.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Agent not found' });

  const rawRole = req.body.role;
  const normalizedRole: AgentConfig['role'] = ((rawRole as unknown as string) === 'HOST' ? 'MANAGER' : (rawRole as unknown as string) === 'AGENT' ? 'WORKER' : (rawRole ?? 'WORKER')) as AgentConfig['role'];
  const updated: AgentConfig = { ...agents[idx], ...req.body, role: normalizedRole, id: req.params.id };
  agents[idx] = updated;
  saveAgents(agents);
  res.json(updated);
});

// DELETE /api/agents/:id — delete agent
agentsRouter.delete('/:id', (req: Request, res: Response) => {
  const agents = getAgents();
  const agent = agents.find(a => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  if (agent.role === 'MANAGER') {
    return res.status(403).json({ error: 'Cannot delete MANAGER agent' });
  }

  saveAgents(agents.filter(a => a.id !== req.params.id));
  res.status(204).end();
});
