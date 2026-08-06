/**
 * Automated Release Tool for PapeRuss 2.0
 * Usage: node tools/release.mjs <versionTag> "<Release Title>" "<Release Summary>"
 * Example: node tools/release.mjs v2.2.0 "Feature Title" "Summary notes..."
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const tag = args[0] || `v2.${Date.now().toString().slice(-4)}.0`;
const title = args[1] || `PapeRuss Release ${tag}`;
const body = args[2] || `Automated release ${tag} with latest features and enhancements.`;

function run(cmd) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd: root, stdio: 'inherit' });
}

async function main() {
  console.log(`\n🚀 Starting automated release process for ${tag}...`);

  // 1. Read & Update changelog.json
  const jsonPath = path.join(root, 'changelog.json');
  let data = { generatedAt: new Date().toISOString(), source: 'https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases', releases: [] };
  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    data = JSON.parse(raw);
  } catch (_) {}

  const newRelease = {
    tagName: tag,
    name: title,
    title: title,
    publishedAt: new Date().toISOString(),
    body: body,
    url: 'https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases',
    prerelease: false
  };

  // Avoid duplicate tags
  data.releases = [newRelease, ...data.releases.filter(r => r.tagName !== tag)];
  data.generatedAt = new Date().toISOString();
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2) + '\n');

  // 2. Update CHANGELOG.md
  const mdPath = path.join(root, 'CHANGELOG.md');
  const dateStr = new Date().toISOString().slice(0, 10);
  const mdSnippet = `## [${tag}](https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases) — ${dateStr}\n\n**${title}**\n\n${body}\n\n`;
  
  let existingMd = '';
  try {
    existingMd = await fs.readFile(mdPath, 'utf8');
  } catch (_) {}

  let newMd = '';
  const headerPrefix = '# Changelog\n\nThis file is generated from [GitHub Releases](https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases).\n\n';
  if (existingMd.startsWith(headerPrefix)) {
    newMd = headerPrefix + mdSnippet + existingMd.slice(headerPrefix.length);
  } else {
    newMd = `# Changelog\n\n${mdSnippet}` + existingMd;
  }
  await fs.writeFile(mdPath, newMd);

  // 3. Git Add, Commit, Merge, Push & Tag
  run('git add changelog.json CHANGELOG.md');
  try {
    run(`git commit -m "docs: release ${tag} version changelog"`);
  } catch (_) {
    console.log('No changelog changes to commit, continuing...');
  }

  const currentBranch = execSync('git branch --show-current', { cwd: root }).toString().trim();
  if (currentBranch && currentBranch !== 'main') {
    run(`git push origin ${currentBranch}`);
    run('git checkout main');
    run(`git merge ${currentBranch}`);
  }

  run('git push origin main');
  
  // Tag creation & push
  try {
    run(`git tag -a ${tag} -m "${title}"`);
  } catch (_) {
    console.log(`Tag ${tag} already exists locally, updating...`);
  }
  run(`git push origin ${tag}`);

  console.log(`\n🎉 Automated release ${tag} successfully published and pushed to GitHub!\n`);
}

main().catch(err => {
  console.error('❌ Release failed:', err);
  process.exit(1);
});
