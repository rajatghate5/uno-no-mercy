/**
 * Cross-compile standalone executables.
 *
 * `bun build --compile` embeds the Bun runtime AND OpenTUI's native Zig
 * library, parser worker and grammars, so the output is one file with no
 * runtime to install — that is what makes "send friends one file" work.
 *
 * Cross-compiling requires every target's native package to be present:
 *   bun install --os="*" --cpu="*" @opentui/core
 */

const TARGETS = [
  { target: 'bun-darwin-arm64', out: 'uno-macos-arm64' },
  { target: 'bun-darwin-x64', out: 'uno-macos-x64' },
  { target: 'bun-linux-x64', out: 'uno-linux-x64' },
  { target: 'bun-linux-arm64', out: 'uno-linux-arm64' },
  { target: 'bun-windows-x64', out: 'uno-windows-x64.exe' },
] as const;

const only = process.argv[2];
const selected = only ? TARGETS.filter((t) => t.target.includes(only)) : TARGETS;

if (selected.length === 0) {
  console.error(`No target matches "${only}". Known: ${TARGETS.map((t) => t.target).join(', ')}`);
  process.exit(1);
}

for (const { target, out } of selected) {
  const isMusl = target.includes('musl');
  process.stdout.write(`building ${out} … `);
  const started = performance.now();
  const result = await Bun.build({
    entrypoints: ['./packages/tui/src/main.tsx'],
    compile: { target, outfile: `./dist/${out}` },
    // Without this, musl builds carry both libc branches and are larger.
    ...(isMusl ? { define: { 'process.env.OPENTUI_LIBC': JSON.stringify('musl') } } : {}),
  });
  if (!result.success) {
    console.log('FAILED');
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  const ms = (performance.now() - started) / 1000;
  const size = Bun.file(`./dist/${out}`).size;
  console.log(`ok  ${(size / 1024 / 1024).toFixed(1)}MB  ${ms.toFixed(1)}s`);
}
