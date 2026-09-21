/** Match history and lifetime stats. */

import { useKeyboard } from '../render/runtime.js';
import { UI } from '../render/theme.js';
import type { Store } from '../game/store.js';

export function StatsScreen({ store, onBack }: { store: Store; onBack: () => void }) {
  useKeyboard((key) => {
    if (key.name === 'q' || key.name === 'escape') onBack();
  });

  const stats = store.stats();
  const recent = store.recent(8);

  if (store.disabled) {
    return (
      <box flexGrow={1} backgroundColor={UI.bg} flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
        <text fg={UI.danger}>stats unavailable</text>
        <text fg={UI.dim}>{store.disabled}</text>
        <text fg={UI.dim}>[q] back</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={UI.bg} padding={2} gap={1}>
      <text fg={UI.danger} attributes={1}>YOUR RECORD</text>

      {stats.games === 0 ? (
        <text fg={UI.dim}>no games yet — go get eliminated a few times</text>
      ) : (
        <box flexDirection="column" gap={1}>
          <box flexDirection="row" gap={4}>
            <Stat label="played" value={String(stats.games)} />
            <Stat label="won" value={String(stats.wins)} />
            <Stat label="win rate" value={`${(stats.winRate * 100).toFixed(0)}%`} />
            <Stat label="avg turns" value={stats.avgTurns.toFixed(0)} />
            <Stat label="worst hit" value={`+${stats.worstHit}`} tone={UI.danger} />
          </box>

          <box
            flexDirection="column"
            border
            borderStyle="rounded"
            borderColor={UI.border}
            backgroundColor={UI.panel}
            paddingX={2}
            title=" by difficulty "
            titleColor={UI.dim}
          >
            {stats.byDifficulty.map((d) => (
              <text key={d.difficulty} fg={UI.text}>
                {d.difficulty.padEnd(8)} {String(d.wins).padStart(3)} / {String(d.games).padEnd(3)}  (
                {d.games ? ((d.wins / d.games) * 100).toFixed(0) : '0'}%)
              </text>
            ))}
          </box>

          <box
            flexDirection="column"
            border
            borderStyle="rounded"
            borderColor={UI.border}
            backgroundColor={UI.panel}
            paddingX={2}
            flexGrow={1}
            title=" recent "
            titleColor={UI.dim}
          >
            {recent.map((m, i) => (
              // MatchRecord.id is optional (unset before insert), so fall back
              // to the index rather than passing undefined as a React key.
              <text key={m.id ?? `row-${i}`} fg={m.won ? UI.good : UI.dim}>
                {m.won ? 'W' : 'L'}  {m.difficulty.padEnd(7)} {String(m.players)}p  {String(m.turns).padStart(3)} turns
                {m.worstHit > 0 ? `  worst +${m.worstHit}` : ''}
              </text>
            ))}
          </box>
        </box>
      )}

      <text fg={UI.borderActive}>[q] back</text>
    </box>
  );
}

function Stat({ label, value, tone = UI.text }: { label: string; value: string; tone?: string }) {
  return (
    <box flexDirection="column">
      <text fg={UI.dim}>{label}</text>
      <text fg={tone} attributes={1}>{value}</text>
    </box>
  );
}
