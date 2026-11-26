#!/usr/bin/env node
// The "latest" release's notes: the version, then a download table grouped by system, from the
// files actually on the release (GitHub lists assets flat and alphabetically; the notes show
// above them). Written by the release job in .github/workflows/build.yml.
//
//   gh release view latest --json assets | node .github/release-notes.js <version> <commit> <repo> <mac signed: true|false> [branch]

const [version, commit, repo, macSigned, branch] = process.argv.slice(2);
if (!version || !commit || !repo) {
  console.error('usage: … | release-notes.js <version> <commit> <repo> <mac signed> [branch]');
  process.exit(2);
}

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const names = (JSON.parse(input).assets ?? []).map((a) => a.name);
  const base = `https://github.com/${repo}/releases/download/latest/`;
  const link = (label, name) => `[${label}](${base}${encodeURIComponent(name)})`;
  /** The links for the files ending in each suffix, in that order. */
  const links = (kinds) =>
    kinds.flatMap(([suffix, label]) => names.filter((n) => n.endsWith(suffix)).map((n) => link(label, n))).join(' · ');

  const rows = [
    ['**macOS** (Apple silicon and Intel)', links([['.dmg', 'Disk image (.dmg)']]),
      macSigned === 'true' ? 'Signed and notarized' : 'Signed ad-hoc: the first time, open it, then System Settings › Privacy & Security › Open Anyway'],
    ['**Windows** (64-bit)', links([['-setup.exe', 'Installer (.exe)'], ['.msi', 'MSI']]),
      'Unsigned: if SmartScreen warns, More info › Run anyway'],
    ['**Linux** (x86-64)', links([['.AppImage', 'AppImage'], ['.deb', 'Debian/Ubuntu (.deb)'], ['.rpm', 'Fedora/openSUSE (.rpm)']]), ''],
  ].filter(([, l]) => l);

  const sha = commit.slice(0, 7);
  const out = [
    `**Version ${version}**, built from ${sha}${branch ? ` (\`${branch}\`)` : ''}.`,
    '',
    '| System | Download | Note |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    'Installed copies update themselves. The other files (`.sig`, `Email.app.tar.gz`, `latest.json`) are for those updates: you don’t need to download them.',
  ];
  process.stdout.write(out.join('\n') + '\n');
});
