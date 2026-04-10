import { spawn } from 'child_process';

function telemetry(event: 'call_start' | 'call_end' | 'call_error', meta: Record<string, unknown>) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [TELEMETRY] agent:${event} ${JSON.stringify(meta)}`);
}

export interface AgentPromptContext {
  domainLabel: string;
  systemPrompt: string;
  userMessage: string;
}

export async function callClaudeCode(prompt: string, timeout = 90000): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    telemetry('call_start', { type: 'claude-code', promptLength: prompt.length, timeout });

    const proc = spawn('claude', ['-p', prompt], { timeout });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      const dur = Date.now() - start;
      if (code === 0) {
        telemetry('call_end', { type: 'claude-code', duration_ms: dur, outputLength: stdout.length });
        resolve(stdout.trim());
      } else {
        telemetry('call_error', { type: 'claude-code', duration_ms: dur, exitCode: code, stderr: stderr.slice(0, 500) });
        reject(new Error(`claude -p exited ${code}: ${stderr}`));
      }
    });
    proc.on('error', (err) => {
      const dur = Date.now() - start;
      telemetry('call_error', { type: 'claude-code', duration_ms: dur, error: err.message });
      reject(err);
    });
  });
}

export async function callAgent(ctx: AgentPromptContext): Promise<string> {
  const start = Date.now();
  telemetry('call_start', { type: 'agent', domainLabel: ctx.domainLabel, systemPrompt: ctx.systemPrompt.slice(0, 50) });

  try {
    const prompt = `【角色】${ctx.domainLabel}（${ctx.systemPrompt}）

${ctx.userMessage}`;
    const result = await callClaudeCode(prompt);
    const dur = Date.now() - start;
    telemetry('call_end', { type: 'agent', domainLabel: ctx.domainLabel, duration_ms: dur, outputLength: result.length });
    return result;
  } catch (err) {
    const dur = Date.now() - start;
    telemetry('call_error', { type: 'agent', domainLabel: ctx.domainLabel, duration_ms: dur, error: String(err) });
    throw err;
  }
}
