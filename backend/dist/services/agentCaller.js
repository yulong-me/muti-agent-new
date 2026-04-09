import { spawn } from 'child_process';
export async function callClaudeCode(prompt, timeout = 90000) {
    return new Promise((resolve, reject) => {
        const proc = spawn('claude', ['-p', prompt], { timeout });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0)
                resolve(stdout.trim());
            else
                reject(new Error(`claude -p exited ${code}: ${stderr}`));
        });
        proc.on('error', reject);
    });
}
export async function callAgent(ctx) {
    const prompt = `【角色】${ctx.domainLabel}（${ctx.systemPrompt}）

${ctx.userMessage}`;
    return callClaudeCode(prompt);
}
