// Just Fun client vendor bundle.
// Third-party libraries are bundled here by esbuild and exposed on window.JF
// before the application scripts run. The legacy manifest concatenation stays
// untouched so existing shared-scope modules keep their initialization order.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,      // never trust raw HTML in notes (same policy as the legacy renderer)
  linkify: true,    // bare URLs become links
  breaks: true,     // a single newline stays a <br>, matching the previous behaviour
  typographer: false
});

// GFM strikethrough: the legacy renderer supported ~~text~~, so keep it.
md.inline.ruler.before('emphasis', 'jf_strike', (state, silent) => {
  const start = state.pos;
  const max = state.posMax;
  if (state.src.charCodeAt(start) !== 0x7e || state.src.charCodeAt(start + 1) !== 0x7e) return false;
  let pos = start + 2;
  while (pos < max) {
    if (state.src.charCodeAt(pos) === 0x7e && state.src.charCodeAt(pos + 1) === 0x7e) {
      if (pos === start + 2) return false;
      if (!silent) {
        state.push('jf_strike_open', 's', 1);
        const text = state.push('text', '', 0);
        text.content = state.src.slice(start + 2, pos);
        state.push('jf_strike_close', 's', -1);
      }
      state.pos = pos + 2;
      return true;
    }
    pos++;
  }
  return false;
});

// External links open in a new tab without leaking window.opener.
const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:/i.test(href)) {
    const target = tokens[idx].attrIndex('target');
    if (target < 0) tokens[idx].attrPush(['target', '_blank']);
    else tokens[idx].attrs[target][1] = '_blank';
    tokens[idx].attrPush(['rel', 'noopener noreferrer']);
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

window.JF = window.JF || {};
window.JF.markdown = md;
