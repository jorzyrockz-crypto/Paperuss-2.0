const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.resolve(process.argv[2] || "");
const outputRoot = path.resolve(process.argv[3] || path.join(root, ".merge-preview"));

if (!sourcePath.startsWith(root + path.sep) || !outputRoot.startsWith(root + path.sep)) {
  throw new Error("Source and output paths must stay inside the workspace.");
}

const source = fs.readFileSync(sourcePath, "utf8");
const stylePattern = /<style>\r?\n([\s\S]*?)\r?\n<\/style>/;
const scriptPattern = /<script>\r?\n([\s\S]*?)\r?\n<\/script>\r?\n<\/body>/;
const styleMatch = source.match(stylePattern);
const scriptMatch = source.match(scriptPattern);

if (!styleMatch || !scriptMatch) {
  throw new Error("Expected one inline stylesheet and one application script.");
}

function splitAtMarkers(content, entries) {
  const positions = entries.map(({ marker }) => {
    const index = marker ? content.indexOf(marker) : 0;
    if (index < 0) throw new Error(`Missing marker: ${marker}`);
    return index;
  });
  if (positions.some((position, index) => index && position <= positions[index - 1])) {
    throw new Error("Markers are not in source order.");
  }
  const sections = entries.map((entry, index) => ({
    ...entry,
    content: content.slice(positions[index], positions[index + 1] ?? content.length),
  }));
  if (sections.map(({ content: section }) => section).join("") !== content) {
    throw new Error("Split validation failed.");
  }
  return sections;
}

const jsEntries = [
  ["core.js", null],
  ["productivity.js", "CALENDAR VIEW"],
  ["editor-ui.js", "SYSTEM FONT STYLING"],
  ["tasks-settings.js", "STANDALONE TASKS + REMINDERS + NOTIFICATIONS"],
  ["cloud-notifications.js", "FIREBASE AUTH + CLOUD SYNC"],
  ["actions.js", "DIVIDERS & TABLES"],
  ["formatting.js", "WYSIWYG FORMATTING"],
  ["media.js", "MEDIA INSERTION"],
  ["data-transfer.js", "IMPORT / EXPORT"],
  ["responsive-images.js", "RESPONSIVE IMAGE EXPERIENCE"],
  ["tables.js", "TABLE TOOLS"],
  ["bootstrap.js", "EVENT WIRING + INIT"],
].map(([file, title]) => ({
  file,
  marker: title ? `/* ============================================================\n   ${title}` : null,
}));

const cssEntries = [
  ["core.css", null],
  ["features.css", "/* ============ MEDIA EMBEDS ============ */"],
  ["responsive.css", "/* ============ TABLET & PHONE PREMIUM RESPONSIVE ============ */"],
  ["settings.css", "/* ============ SETTINGS PAGE ============ */"],
].map(([file, marker]) => ({ file, marker }));

const scripts = splitAtMarkers(`${scriptMatch[1]}\n`, jsEntries);
const styles = splitAtMarkers(`${styleMatch[1]}\n`, cssEntries);
const stylesheetTags = cssEntries
  .map(({ file }) => `<link rel="stylesheet" href="assets/css/${file}">`)
  .join("\n");
const scriptTags = jsEntries
  .map(({ file }) => `<script src="js/${file}"></script>`)
  .join("\n");
const html = source
  .replace(stylePattern, stylesheetTags)
  .replace(scriptPattern, `${scriptTags}\n</body>`);

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(outputRoot, "assets", "css"), { recursive: true });
fs.mkdirSync(path.join(outputRoot, "js"), { recursive: true });
fs.writeFileSync(path.join(outputRoot, "index.html"), html, "utf8");
for (const { file, content } of styles) {
  fs.writeFileSync(path.join(outputRoot, "assets", "css", file), content, "utf8");
}
for (const { file, content } of scripts) {
  fs.writeFileSync(path.join(outputRoot, "js", file), content, "utf8");
}

console.log(`Prepared ${styles.length} stylesheets and ${scripts.length} scripts.`);
