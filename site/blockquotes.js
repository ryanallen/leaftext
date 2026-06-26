// Verse / hard-break blockquotes. Markdown turns two trailing spaces into a
// <br> inside one <p>. CSS gives blockquote paragraphs a hanging indent so a
// long wrapped prose line hangs — but that pushes every line AFTER a <br> to
// the right, which is wrong for verse (see desktop app, which decorates the
// same way). We split each <br>-separated run into its own .blockquote-line
// span so each line sits flush left and only true wraps hang.
export function decorateBlockquoteLines(root) {
  root.querySelectorAll('blockquote:not(.markdown-alert) p').forEach((paragraph) => {
    if (paragraph.querySelector('.blockquote-line')) return;

    const children = Array.from(paragraph.childNodes);
    if (!children.some((node) => node.nodeName === 'BR')) return;

    const fragment = document.createDocumentFragment();
    let line = document.createElement('span');
    line.className = 'blockquote-line';

    children.forEach((node) => {
      if (node.nodeName === 'BR') {
        fragment.appendChild(line);
        line = document.createElement('span');
        line.className = 'blockquote-line';
        return;
      }
      line.appendChild(node);
    });

    fragment.appendChild(line);
    paragraph.replaceChildren(fragment);
    paragraph.classList.add('blockquote-lines');
  });
}
