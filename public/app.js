// movie-tracker web UI: hash-routed vanilla JS over the JSON API. All data is rendered as text (el/textContent), never parsed as HTML.

const app = document.getElementById('app');
const PAGE = 20;

/** Calls the API; throws Error(message) on non-2xx (validation details appended), returns null on 204. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    const details = Array.isArray(data.error?.details)
      ? data.error.details.map((d) => `${d.path.replace(/^\//, '') || 'request'}: ${d.message}`).join('; ')
      : '';
    throw new Error([data.error?.message ?? `HTTP ${res.status}`, details].filter(Boolean).join(' — '));
  }
  return data;
}

/** Creates an element. Props: class, text, on* handlers, anything else becomes an attribute. Children: nodes or strings. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD in local time
const chips = (genres) => el('span', { class: 'chips' }, genres.map((g) => el('span', { class: 'chip', text: g })));
const errorLine = () => el('p', { class: 'error', role: 'alert', hidden: true });
function showError(node, error) {
  node.textContent = error ? error.message : '';
  node.hidden = !error;
}
function field(label, input) {
  return el('label', { class: 'field' }, el('span', { text: label }), input);
}

/** Prev/next pager for a { total, limit, offset } page. */
export function pager(page, go) {
  if (page.total <= page.limit && page.offset === 0) return null;
  const from = page.total === 0 ? 0 : page.offset + 1;
  const to = Math.min(page.offset + page.limit, page.total);
  return el(
    'div',
    { class: 'pager' },
    el('button', { type: 'button', disabled: page.offset === 0, onclick: () => go(Math.max(0, page.offset - page.limit)), text: '‹ Prev' }),
    el('span', { class: 'muted', text: `${from}–${to} of ${page.total.toLocaleString()}` }),
    el('button', { type: 'button', disabled: to >= page.total, onclick: () => go(page.offset + page.limit), text: 'Next ›' }),
  );
}

// ---------- Catalog (#/) ----------

function catalog() {
  const state = { q: '', offset: 0 };
  const search = el('input', { type: 'search', placeholder: 'Search by title…', autofocus: true, 'aria-label': 'Search by title' });
  const list = el('div', { class: 'list', 'aria-live': 'polite' });
  const error = errorLine();

  async function load() {
    const params = new URLSearchParams({ limit: PAGE, offset: state.offset });
    if (state.q) params.set('q', state.q);
    try {
      const page = await api(`/movies?${params}`);
      showError(error, null);
      list.replaceChildren(
        page.items.length === 0
          ? el('p', { class: 'empty', text: state.q ? `No movies match “${state.q}”.` : 'The catalog is empty. Run npm run import:imdb or add a movie.' })
          : el(
              'ul',
              { class: 'rows' },
              page.items.map((m) =>
                el(
                  'li',
                  {},
                  el(
                    'a',
                    { class: 'row', href: `#/movies/${m.id}` },
                    el('span', { class: 'title' }, m.title, el('span', { class: 'muted', text: ` (${m.year})` })),
                    el('span', { class: 'muted', text: m.director }),
                    chips(m.genres),
                  ),
                ),
              ),
            ),
        pager(page, (offset) => {
          state.offset = offset;
          load();
        }) ?? '',
      );
    } catch (e) {
      showError(error, e);
    }
  }

  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = search.value.trim();
      state.offset = 0;
      load();
    }, 250);
  });

  load();
  return [el('div', { class: 'toolbar' }, search, addMovieForm()), error, list];
}

function addMovieForm() {
  const title = el('input', { required: true, maxlength: 300 });
  const year = el('input', { type: 'number', required: true, min: 1888, max: new Date().getFullYear() + 1 });
  const genres = el('input', { required: true, placeholder: 'Drama, Sci-Fi' });
  const director = el('input', { required: true, maxlength: 200 });
  const error = errorLine();
  const form = el(
    'form',
    {
      class: 'card stack',
      onsubmit: async (event) => {
        event.preventDefault();
        try {
          const movie = await api('/movies', {
            method: 'POST',
            body: {
              title: title.value,
              year: Number(year.value),
              genres: genres.value.split(',').map((g) => g.trim()).filter(Boolean),
              director: director.value,
            },
          });
          location.hash = `#/movies/${movie.id}`;
        } catch (e) {
          showError(error, e);
        }
      },
    },
    el('div', { class: 'grid' }, field('Title', title), field('Year', year), field('Genres (comma-separated)', genres), field('Director', director)),
    error,
    el('div', {}, el('button', { class: 'primary', text: 'Add movie' })),
  );
  return el('details', { class: 'add' }, el('summary', { text: '+ Add movie' }), form);
}

// ---------- Movie detail (#/movies/:id) ----------

function movieDetail(id) {
  const root = el('div', { class: 'stack' }, el('p', { class: 'muted', text: 'Loading…' }));
  (async () => {
    try {
      const movie = await api(`/movies/${id}`);
      const watch = await api(`/movies/${id}/watch`).catch(() => null);
      root.replaceChildren(
        el('a', { class: 'back', href: '#/', text: '‹ Catalog' }),
        el(
          'section',
          { class: 'card' },
          el('h1', {}, movie.title, el('span', { class: 'muted', text: ` (${movie.year})` })),
          el('p', { class: 'muted', text: `Directed by ${movie.director}` }),
          chips(movie.genres),
        ),
        watchForm(movie, watch),
      );
    } catch (e) {
      root.replaceChildren(el('a', { class: 'back', href: '#/', text: '‹ Catalog' }), el('p', { class: 'error', role: 'alert', text: e.message }));
    }
  })();
  return root;
}

function watchForm(movie, watch) {
  const rating = el(
    'select',
    { required: true },
    el('option', { value: '', text: '—' }),
    Array.from({ length: 10 }, (_, i) => el('option', { value: i + 1, text: String(i + 1), selected: watch?.rating === i + 1 })),
  );
  const date = el('input', { type: 'date', max: today(), value: watch?.watchedAt ?? today() });
  const note = el('textarea', { rows: 3, maxlength: 2000 });
  note.value = watch?.note ?? '';
  const error = errorLine();
  const status = el('span', { class: 'muted', role: 'status' });

  const save = async (event) => {
    event.preventDefault();
    try {
      const saved = await api(`/movies/${movie.id}/watch`, {
        method: watch ? 'PUT' : 'POST',
        body: { rating: Number(rating.value), watchedAt: date.value || undefined, note: note.value },
      });
      form.replaceWith(watchForm(movie, saved));
    } catch (e) {
      showError(error, e);
    }
  };
  const remove = async () => {
    try {
      await api(`/movies/${movie.id}/watch`, { method: 'DELETE' });
      form.replaceWith(watchForm(movie, null));
    } catch (e) {
      showError(error, e);
    }
  };

  status.textContent = watch ? `Watched on ${watch.watchedAt}, rated ${watch.rating}/10` : 'Not watched yet';
  const form = el(
    'form',
    { class: 'card stack', onsubmit: save },
    el('div', { class: 'between' }, el('h2', { text: 'Your watch' }), status),
    el('div', { class: 'grid' }, field('Rating (1–10)', rating), field('Watched on', date)),
    field('Note', note),
    error,
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'primary', text: watch ? 'Save changes' : 'Mark as watched' }),
      watch ? el('button', { type: 'button', class: 'danger', onclick: remove, text: 'Remove watch' }) : null,
    ),
  );
  return form;
}

// ---------- Router ----------

const routes = [
  [/^#\/movies\/(\d+)$/, (m) => movieDetail(m[1]), '#/'],
  [/^#?\/?$/, () => catalog(), '#/'],
];

export function route() {
  const hash = location.hash || '#/';
  for (const [pattern, render, nav] of routes) {
    const match = hash.match(pattern);
    if (!match) continue;
    for (const a of document.querySelectorAll('.top nav a')) {
      if (a.getAttribute('href') === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    app.replaceChildren(...[render(match)].flat());
    window.scrollTo(0, 0);
    return;
  }
  app.replaceChildren(el('p', { class: 'empty', text: 'Page not found.' }), el('a', { href: '#/', text: 'Back to the catalog' }));
}

window.addEventListener('hashchange', route);
route();
