// latest.json, what the apps ask for to update themselves (app/src-tauri/src/updater.rs; Tauri's
// updater format): the version, and per platform and kind of install the file to download and
// its signature. Written by the release job in .github/workflows/build.yml from the signatures
// on the "latest" release, each named after its file (Email_0.1.200_x64-setup.exe.sig).
//
//   node .github/latest-json.js <folder with the .sig files> <version> <commit> <release download url>
//
// The app looks for "<os>-<arch>-<kind of install>" first, then "<os>-<arch>".

const fs = require('fs');
const path = require('path');

const [dir, version, commit, base] = process.argv.slice(2);
if (!dir || !version || !base) {
  console.error('usage: latest-json.js <sig folder> <version> <commit> <base url>');
  process.exit(2);
}

// The file's ending → the keys it answers.
const KINDS = [
  ['.app.tar.gz', ['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app']],
  ['-setup.exe', ['windows-x86_64', 'windows-x86_64-nsis']],
  ['.msi', ['windows-x86_64-msi']],
  // Only by kind on Linux: a .deb or .rpm install must never be handed the AppImage.
  ['.AppImage', ['linux-x86_64-appimage']],
  ['.deb', ['linux-x86_64-deb']],
  ['.rpm', ['linux-x86_64-rpm']],
];

const platforms = {};
for (const sigFile of fs.readdirSync(dir).filter((f) => f.endsWith('.sig')).sort()) {
  const file = sigFile.slice(0, -'.sig'.length);
  const kind = KINDS.find(([end]) => file.endsWith(end));
  if (!kind) continue;
  const signature = fs.readFileSync(path.join(dir, sigFile), 'utf8').trim();
  for (const key of kind[1]) platforms[key] = { signature, url: `${base}/${encodeURIComponent(file)}` };
}

const out = { version, notes: commit ? `Built from ${commit}.` : '', pub_date: new Date().toISOString(), platforms };
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
