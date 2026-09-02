// The text every subject writes with: escaping markup so a document's own words cannot become part of the page, and counting a thing without saying "1 matches". It follows the shared state and leads every fragment that draws a word, so a helper about words has one obvious home rather than the tail of a subject file about something else.
//
// Only text belongs here. A helper that reads or writes the page goes in the fragment that draws it.

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function escapeAttr(value) {
  return escapeText(value).replace(/`/g, '&#96;');
}
// Thousands separators, so a big count reads as "2,000" rather than "2000".
function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : String(value);
}
// The one place a counted sentence chooses its word, so a count of one never reads as a plural. Whole labels, because the pair is sometimes "match is" against "matches are".
function formatCountLabel(value, singular, plural) {
  return `${formatCount(value)} ${Number(value) === 1 ? singular : plural}`;
}
