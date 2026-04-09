import { spawn } from 'child_process';

export interface AgentPromptContext {
  domainLabel: string;
  systemPrompt: string;
  userMessage: string;
}

export async function callClaudeCode(prompt: string, timeout = 90000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt], { timeout });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude -p exited ${code}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}

export async function callAgent(ctx: AgentPromptContext): Promise<string> {
  const prompt = `【角色】${ctx.domainLabel}（${ctx.systemPrompt}）

${ctx.userMessage}`;
  return callClaudeCode(prompt);
}
