function isMarkdownText(text) {
  if (!text || typeof text !== 'string') return false;
  const str = text.trim();
  if (!str) return false;
  return /^[ \t]*#{1,6}
module.exports = isMarkdownText;