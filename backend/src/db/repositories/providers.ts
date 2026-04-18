import { db } from '../db.js';
import type { ProviderConfig } from '../../config/providerConfig.js';

export const providersRepo = {
  list(): Record<string, ProviderConfig> {
    const rows = db.prepare('SELECT * FROM providers').all() as Record<string, unknown>[];
    const result: Record<string, ProviderConfig> = {};
    for (const r of rows) {
      result[r.name as string] = {
        name: r.name as string,
        label: r.label as string,
        cliPath: r.cli_path as string,
        defaultModel: r.default_model as string,
        apiKey: r.api_key as string,
        baseUrl: r.base_url as string,
        timeout: r.timeout as number,
        thinking: Boolean(r.thinking),
        lastTested: r.last_tested as number | null,
        lastTestResult: r.last_test_result
          ? JSON.parse(r.last_test_result as string)
          : null,
      };
    }
    return result;
  },

  get(name: string): ProviderConfig | undefined {
    const r = db.prepare('SELECT * FROM providers WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      name: r.name as string,
      label: r.label as string,
      cliPath: r.cli_path as string,
      defaultModel: r.default_model as string,
      apiKey: r.api_key as string,
      baseUrl: r.base_url as string,
      timeout: r.timeout as number,
      thinking: Boolean(r.thinking),
      lastTested: r.last_tested as number | null,
      lastTestResult: r.last_test_result
        ? JSON.parse(r.last_test_result as string)
        : null,
    };
  },

  /**
   * Upsert — used for explicit user updates (settings page).
   * Preserves last_tested / last_test_result.
   */
  upsert(name: string, data: Omit<ProviderConfig, 'name' | 'lastTested' | 'lastTestResult'>): void {
    db.prepare(`
      INSERT OR REPLACE INTO providers (name, label, cli_path, default_model, api_key, base_url, timeout, thinking, last_tested, last_test_result)
      VALUES (@name, @label, @cliPath, @defaultModel, @apiKey, @baseUrl, @timeout, @thinking, NULL, NULL)
    `).run({
      name,
      label: data.label ?? name,
      cliPath: data.cliPath,
      defaultModel: data.defaultModel,
      apiKey: data.apiKey,
      baseUrl: data.baseUrl,
      timeout: data.timeout,
      thinking: data.thinking ? 1 : 0,
    });
  },

  /**
   * Seed-once insert — only inserts if the record does not exist.
   * Existing provider configs (user-modified api_key, base_url, etc.) are preserved.
   */
  insertIfNotExists(name: string, data: Omit<ProviderConfig, 'name' | 'lastTested' | 'lastTestResult'>): void {
    db.prepare(`
      INSERT INTO providers (name, label, cli_path, default_model, api_key, base_url, timeout, thinking)
      SELECT @name, @label, @cliPath, @defaultModel, @apiKey, @baseUrl, @timeout, @thinking
      WHERE NOT EXISTS (SELECT 1 FROM providers WHERE name = @name)
    `).run({
      name,
      label: data.label ?? name,
      cliPath: data.cliPath,
      defaultModel: data.defaultModel,
      apiKey: data.apiKey,
      baseUrl: data.baseUrl,
      timeout: data.timeout,
      thinking: data.thinking ? 1 : 0,
    });
  },

  delete(name: string): void {
    db.prepare('DELETE FROM providers WHERE name = ?').run(name);
  },

  updateTestResult(name: string, result: ProviderConfig['lastTestResult']): void {
    db.prepare(`
      UPDATE providers SET last_tested = @lastTested, last_test_result = @lastTestResult WHERE name = @name
    `).run({
      name,
      lastTested: Date.now(),
      lastTestResult: result ? JSON.stringify(result) : null,
    });
  },
};
