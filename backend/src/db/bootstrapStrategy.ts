export type BootstrapAction =
  | 'fresh_seed_all'
  | 'legacy_mark_only'
  | 'legacy_backfill_agents'
  | 'repair_partial'
  | 'skip';

export interface BootstrapState {
  metaPresent: boolean;
  agentsCount: number;
  providersCount: number;
  scenesCount: number;
  roomsCount: number;
}

export function resolveBootstrapAction(state: BootstrapState): BootstrapAction {
  if (!state.metaPresent) {
    const hasHistoricalData =
      state.agentsCount > 0 ||
      state.providersCount > 0 ||
      state.scenesCount > 0;

    if (!hasHistoricalData) {
      return 'fresh_seed_all';
    }

    if (state.agentsCount === 0) {
      return 'legacy_backfill_agents';
    }

    return 'legacy_mark_only';
  }

  if (state.agentsCount === 0 && state.scenesCount === 0 && state.roomsCount === 0) {
    return 'repair_partial';
  }

  return 'skip';
}
