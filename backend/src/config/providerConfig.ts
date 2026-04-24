// ⚠️ api_key stored in plaintext in DB; production should use KMS or env-var injection
export interface ProviderConfig {
  name: string
  label: string
  cliPath: string
  defaultModel: string
  contextWindow: number
  apiKey: string
  baseUrl: string
  timeout: number
  thinking: boolean
  lastTested: number | null
  lastTestResult: { success: boolean; version?: string; error?: string } | null
}

export type ProvidersConfig = Record<string, ProviderConfig>

import { providersRepo } from '../db/repositories/providers.js';

export function getAllProviders(): ProvidersConfig {
  return providersRepo.list();
}

export function getProvider(name: string): ProviderConfig | undefined {
  return providersRepo.get(name);
}

export function upsertProvider(name: string, data: Omit<ProviderConfig, 'name' | 'lastTested' | 'lastTestResult'>): ProvidersConfig {
  providersRepo.upsert(name, data);
  return providersRepo.list();
}

export function deleteProvider(name: string): ProvidersConfig {
  providersRepo.delete(name);
  return providersRepo.list();
}

export function updateTestResult(name: string, result: ProviderConfig['lastTestResult']): void {
  providersRepo.updateTestResult(name, result);
}
