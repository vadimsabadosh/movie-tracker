// movie-tracker web UI: hash-routed vanilla JS over the JSON API. All data is rendered as text (el/textContent), never parsed as HTML.

const app = document.getElementById('app');
const PAGE = 24;

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
    throw new Error([data.error?.message ?? `HTTP ${res.status}`, details].filter(Boolean).join(': '));
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
/** "2026-11-13" → Date at local midnight (avoids the UTC shift of new Date('2026-11-13')). */
const day = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const shortDate = (iso) => day(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const monthLabel = (iso) => day(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

const chips = (genres) =>
  el(
    'span',
    { class: 'chips' },
    genres.map((g) => el('span', { class: 'chip', text: g })),
  );

/**
 * Decorative poster (alt=''; the title is always next to it). On 404/503 it becomes a same-sized
 * placeholder carrying the title, so a catalog without TMDB still reads as a wall of films.
 */
const poster = (movieId, cls, width, label = '') =>
  el('img', {
    class: `poster ${cls}`,
    src: `/movies/${movieId}/poster`,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    width,
    height: Math.round(width * 1.5),
    // Chrome draws a broken-image icon on any failed <img>, so swap it for an element of the same class.
    // Each film gets its own stable tint (hue from its id), so a wall of placeholders still looks like different films.
    onerror: (e) =>
      e.target.replaceWith(
        el('span', { class: `poster ${cls} missing`, style: `--h: ${(Number(movieId) * 47) % 360}`, 'aria-hidden': 'true' }, label ? el('span', { text: label }) : null),
      ),
  });

/** "IMDb 7.9", or null for a movie without IMDb data (added by hand). */
const imdbShort = (m) => (m.imdbRating === null ? null : `IMDb ${m.imdbRating.toFixed(1)}`);
/** "7.9 IMDb · 612,345 votes", or null. */
const imdbLong = (m) => (m.imdbRating === null ? null : `IMDb ${m.imdbRating.toFixed(1)} · ${m.imdbVotes.toLocaleString('en-US')} votes`);

/** Genre <select> for filters: "Any genre", then GET /genres (exact stored names). A failed load shows in `error`, its own line, so a list load cannot clear it. */
function genreSelect(error) {
  const select = el('select', {}, el('option', { value: '', text: 'Any genre' }));
  api('/genres')
    .then((genres) => select.append(...genres.items.map((name) => el('option', { value: name, text: name }))))
    .catch((e) => showError(error, new Error(`Could not load genres: ${e.message}`)));
  return select;
}
const errorLine = () => el('p', { class: 'error', role: 'alert', hidden: true });
function showError(node, error) {
  node.textContent = error ? error.message : '';
  node.hidden = !error;
}
function field(label, input, cls = '') {
  return el('label', { class: `field ${cls}`.trim() }, el('span', { text: label }), input);
}
const options = (pairs) => pairs.map(([value, text]) => el('option', { value, text }));
/** Filter bar in a disclosure: open on wide screens, folded on phones so the films come first. */
const foldable = (form) =>
  el(
    'details',
    { class: 'filters', open: matchMedia('(min-width: 641px)').matches },
    el('summary', { class: 'button ghost filters-toggle', text: 'Filters & sort' }),
    form,
  );

/** Prev/next pager for a { total, limit, offset } page. */
export function pager(page, go) {
  if (page.total <= page.limit && page.offset === 0) return null;
  const from = page.total === 0 ? 0 : page.offset + 1;
  const to = Math.min(page.offset + page.limit, page.total);
  return el(
    'nav',
    { class: 'pager', 'aria-label': 'Pages' },
    el('button', { type: 'button', class: 'ghost', disabled: page.offset === 0, onclick: () => go(Math.max(0, page.offset - page.limit)), text: '← Previous' }),
    el('span', { class: 'muted', text: `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${page.total.toLocaleString('en-US')}` }),
    el('button', { type: 'button', class: 'ghost', disabled: to >= page.total, onclick: () => go(page.offset + page.limit), text: 'Next →' }),
  );
}
/** Scrolls back to the top of a list after paging, without jumping past the toolbar. */
const toTop = (node) => node.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

// ---------- Catalog (#/) ----------

function catalog() {
  const state = { q: '', offset: 0 };
  const search = el('input', { type: 'search', class: 'search', placeholder: 'Search 19,000 films by title', autofocus: true, 'aria-label': 'Search by title' });
  const list = el('div', { class: 'list', 'aria-live': 'polite' });
  const count = el('p', { class: 'count muted', role: 'status' });
  const error = errorLine();
  const genreError = errorLine();
  const year = { type: 'number', min: 1888, max: new Date().getFullYear() + 1, inputmode: 'numeric', placeholder: 'Any' };
  const inputs = {
    genre: genreSelect(genreError),
    yearFrom: el('input', year),
    yearTo: el('input', year),
    director: el('input', { maxlength: 200, placeholder: 'Any' }),
    watched: el('select', {}, options([['', 'All films'], ['false', 'Not watched'], ['true', 'Watched']])),
    sort: el('select', {}, options([['votes', 'Popularity'], ['rating', 'IMDb rating'], ['year', 'Release year'], ['title', 'Title']])),
    order: el('select', {}, options([['', 'Default'], ['desc', 'Descending'], ['asc', 'Ascending']])),
  };

  async function load() {
    const params = new URLSearchParams({ limit: PAGE, offset: state.offset });
    if (state.q) params.set('q', state.q);
    for (const [key, input] of Object.entries(inputs)) if (input.value.trim()) params.set(key, input.value.trim());
    list.setAttribute('aria-busy', 'true');
    try {
      const page = await api(`/movies?${params}`);
      showError(error, null);
      const filtered = ['q', 'genre', 'yearFrom', 'yearTo', 'director', 'watched'].some((k) => params.has(k));
      count.textContent = page.total === 0 ? '' : `${page.total.toLocaleString('en-US')} ${page.total === 1 ? 'film' : 'films'}`;
      list.replaceChildren(
        page.items.length === 0
          ? emptyState(
              filtered ? 'No films match' : 'The catalog is empty',
              filtered ? 'Try a broader title, another genre or a wider year range.' : 'Run npm run import:imdb to load the IMDb catalog, or add a film by hand.',
            )
          : el(
              'ul',
              { class: 'grid-posters' },
              page.items.map((m) =>
                el(
                  'li',
                  {},
                  el(
                    'a',
                    { class: 'tile', href: `#/movies/${m.id}` },
                    el(
                      'span',
                      { class: 'tile-art' },
                      poster(m.id, 'tile-poster', 200, m.title),
                      m.watched ? el('span', { class: 'seen', text: '✓ Watched' }) : null,
                    ),
                    el('span', { class: 'tile-title', text: m.title }),
                    el('span', { class: 'tile-meta' }, el('span', { text: String(m.year) }), imdbShort(m) ? el('span', { text: imdbShort(m) }) : null),
                  ),
                ),
              ),
            ),
        pager(page, (offset) => {
          state.offset = offset;
          load().then(() => toTop(head));
        }) ?? '',
      );
    } catch (e) {
      list.replaceChildren();
      count.textContent = '';
      showError(error, e);
    } finally {
      list.removeAttribute('aria-busy');
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

  const reload = () => {
    state.offset = 0;
    load();
  };
  const filters = el(
    'form',
    {
      class: 'filterbar',
      'aria-label': 'Filter and sort the catalog',
      onsubmit: (event) => {
        event.preventDefault();
        reload();
      },
      onchange: reload,
    },
    field('Genre', inputs.genre),
    el('div', { class: 'field-pair' }, field('From', inputs.yearFrom, 'narrow'), field('To', inputs.yearTo, 'narrow')),
    field('Director', inputs.director),
    field('Show', inputs.watched),
    el('span', { class: 'spacer', 'aria-hidden': 'true' }),
    field('Sort by', inputs.sort),
    field('Order', inputs.order),
  );

  const head = el('div', { class: 'page-head' }, el('div', { class: 'search-row' }, search, addMovieForm()), foldable(filters));
  load();
  return [head, genreError, error, count, list];
}

function addMovieForm() {
  const title = el('input', { required: true, maxlength: 300 });
  const year = el('input', { type: 'number', required: true, min: 1888, max: new Date().getFullYear() + 1, inputmode: 'numeric' });
  const genres = el('input', { required: true, placeholder: 'Drama, Sci-Fi' });
  const director = el('input', { required: true, maxlength: 200 });
  const error = errorLine();
  const form = el(
    'form',
    {
      class: 'panel stack add-form',
      onsubmit: async (event) => {
        event.preventDefault();
        try {
          const movie = await api('/movies', {
            method: 'POST',
            body: {
              title: title.value,
              year: Number(year.value),
              genres: genres.value
                .split(',')
                .map((g) => g.trim())
                .filter(Boolean),
              director: director.value,
            },
          });
          location.hash = `#/movies/${movie.id}`;
        } catch (e) {
          showError(error, e);
        }
      },
    },
    el('p', { class: 'muted', text: 'For films missing from the IMDb import. Added films have no poster or IMDb rating.' }),
    el('div', { class: 'form-grid' }, field('Title', title), field('Year', year), field('Genres (comma-separated)', genres), field('Director', director)),
    error,
    el('div', {}, el('button', { class: 'primary', text: 'Add film' })),
  );
  return el('details', { class: 'add' }, el('summary', { class: 'button ghost', text: 'Add a film' }), form);
}

function emptyState(title, text) {
  return el('div', { class: 'empty' }, el('p', { class: 'empty-title', text: title }), el('p', { class: 'muted', text }));
}

// ---------- Movie detail (#/movies/:id) ----------

function movieDetail(id) {
  const root = el('div', { class: 'detail' }, el('div', { class: 'skeleton-hero', 'aria-hidden': 'true' }));
  (async () => {
    try {
      const movie = await api(`/movies/${id}`);
      const watch = await api(`/movies/${id}/watch`).catch(() => null);
      document.title = `${movie.title} (${movie.year}) · movie-tracker`;
      const meta = el('p', { class: 'meta' }, el('span', { text: String(movie.year) }), el('span', { text: movie.director }), imdbLong(movie) ? el('span', { text: imdbLong(movie) }) : null);
      const info = el('div', { class: 'hero-info' }, el('h1', { class: 'hero-title', text: movie.title }), meta, chips(movie.genres));
      const hero = el(
        'section',
        { class: 'hero' },
        // The poster again, blurred and enlarged, as the stage lighting behind the page. A failed load just leaves it dark.
        el('div', { class: 'backdrop', style: `background-image: url("/movies/${movie.id}/poster")`, 'aria-hidden': 'true' }),
        el('a', { class: 'back', href: '#/', text: '← Catalog' }),
        el('div', { class: 'hero-body' }, poster(movie.id, 'hero-poster', 240, movie.title), info),
      );
      const body = el('div', { class: 'detail-body' }, watchForm(movie, watch));
      root.replaceChildren(hero, body);
      // TMDB plot and cast (FR-10) fill in after first paint; any failure or empty result adds nothing (NFR-7).
      api(`/movies/${id}/details`)
        .then((d) => {
          if (d.overview) info.append(el('p', { class: 'overview', text: d.overview }));
          if (d.cast.length) {
            body.append(
              el(
                'section',
                { class: 'cast', 'aria-labelledby': 'cast-title' },
                el('h2', { id: 'cast-title', text: 'Cast' }),
                el(
                  'ul',
                  {},
                  d.cast.map((c) => el('li', {}, el('span', { class: 'actor', text: c.name }), c.character ? el('span', { class: 'role', text: c.character }) : null)),
                ),
              ),
            );
          }
        })
        .catch(() => {});
    } catch (e) {
      root.replaceChildren(el('a', { class: 'back plain', href: '#/', text: '← Catalog' }), el('p', { class: 'error', role: 'alert', text: e.message }));
    }
  })();
  return root;
}

function watchForm(movie, watch) {
  const ratingName = `rating-${movie.id}`;
  const ratings = el(
    'div',
    { class: 'rating-scale' },
    Array.from({ length: 10 }, (_, i) =>
      el(
        'label',
        { class: 'rate' },
        el('input', { type: 'radio', name: ratingName, value: i + 1, required: i === 0, checked: watch?.rating === i + 1 }),
        el('span', { text: String(i + 1) }),
      ),
    ),
  );
  const date = el('input', { type: 'date', max: today(), value: watch?.watchedAt ?? today() });
  const note = el('textarea', { rows: 3, maxlength: 2000, placeholder: 'What stayed with you?' });
  note.value = watch?.note ?? '';
  const error = errorLine();

  const save = async (event) => {
    event.preventDefault();
    const rating = form.querySelector(`input[name="${ratingName}"]:checked`)?.value;
    try {
      const saved = await api(`/movies/${movie.id}/watch`, {
        method: watch ? 'PUT' : 'POST',
        body: { rating: Number(rating), watchedAt: date.value || undefined, note: note.value },
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

  const status = watch
    ? el('p', { class: 'status logged', role: 'status' }, el('span', { class: 'score-badge', text: String(watch.rating) }), `Watched ${shortDate(watch.watchedAt)}`)
    : el('p', { class: 'status muted', role: 'status', text: 'Not watched yet' });
  const form = el(
    'form',
    { class: 'log', onsubmit: save, 'aria-labelledby': `log-${movie.id}` },
    el('div', { class: 'log-head' }, el('h2', { id: `log-${movie.id}`, text: watch ? 'Your watch' : 'Log this film' }), status),
    el('fieldset', { class: 'rating' }, el('legend', { text: 'Your rating, 1 to 10' }), ratings),
    el('div', { class: 'log-grid' }, field('Watched on', date), field('Note', note, 'grow')),
    error,
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'primary', text: watch ? 'Save changes' : 'Log watch' }),
      watch ? el('button', { type: 'button', class: 'ghost danger', onclick: remove, text: 'Remove from history' }) : null,
    ),
  );
  return form;
}

// ---------- History (#/history) ----------

function history() {
  const state = { offset: 0 };
  const list = el('div', { class: 'list', 'aria-live': 'polite' });
  const error = errorLine();
  const genreError = errorLine();
  const inputs = {
    genre: genreSelect(genreError),
    ratingMin: el('input', { type: 'number', min: 1, max: 10, inputmode: 'numeric', placeholder: 'Any' }),
    ratingMax: el('input', { type: 'number', min: 1, max: 10, inputmode: 'numeric', placeholder: 'Any' }),
    watchedFrom: el('input', { type: 'date', max: today() }),
    watchedTo: el('input', { type: 'date', max: today() }),
    sort: el('select', {}, options([['watchedAt', 'Watch date'], ['rating', 'Your rating'], ['year', 'Release year'], ['title', 'Title']])),
    order: el('select', {}, options([['', 'Default'], ['desc', 'Descending'], ['asc', 'Ascending']])),
  };

  const row = (w) =>
    el(
      'li',
      {},
      el(
        'a',
        { class: 'entry', href: `#/movies/${w.movieId}` },
        poster(w.movieId, 'entry-poster', 48, w.movie.title),
        el(
          'span',
          { class: 'entry-main' },
          el('span', { class: 'entry-title' }, w.movie.title, el('span', { class: 'year', text: ` ${w.movie.year}` })),
          w.note ? el('span', { class: 'note', text: w.note }) : null,
        ),
        el('span', { class: 'entry-date', text: shortDate(w.watchedAt) }),
        el('span', { class: 'score-badge', text: String(w.rating), 'aria-label': `Rated ${w.rating} of 10` }),
      ),
    );

  async function load() {
    const params = new URLSearchParams({ limit: PAGE, offset: state.offset });
    for (const [key, input] of Object.entries(inputs)) if (input.value.trim()) params.set(key, input.value.trim());
    list.setAttribute('aria-busy', 'true');
    try {
      const page = await api(`/watches?${params}`);
      showError(error, null);
      const filtered = ['genre', 'ratingMin', 'ratingMax', 'watchedFrom', 'watchedTo'].some((k) => params.has(k));
      // A diary reads by month when it is in date order; other sorts stay one flat list.
      const byMonth = inputs.sort.value === 'watchedAt';
      const groups = [];
      for (const w of page.items) {
        const key = byMonth ? monthLabel(w.watchedAt) : '';
        if (groups.at(-1)?.key !== key) groups.push({ key, items: [] });
        groups.at(-1).items.push(w);
      }
      list.replaceChildren(
        page.items.length === 0
          ? emptyState(
              filtered ? 'No watches match' : 'Your diary is empty',
              filtered ? 'Widen the rating or date range, or pick another genre.' : 'Open any film in the catalog and log it. It will show up here.',
            )
          : el(
              'div',
              { class: 'diary' },
              groups.map((g) =>
                el(
                  'section',
                  { class: 'month' },
                  g.key ? el('h2', { class: 'month-title', text: g.key }) : null,
                  el('ul', { class: 'entries' }, g.items.map(row)),
                ),
              ),
            ),
        pager(page, (offset) => {
          state.offset = offset;
          load().then(() => toTop(head));
        }) ?? '',
      );
    } catch (e) {
      list.replaceChildren();
      showError(error, e);
    } finally {
      list.removeAttribute('aria-busy');
    }
  }

  const reload = () => {
    state.offset = 0;
    load();
  };
  const filters = el(
    'form',
    {
      class: 'filterbar',
      'aria-label': 'Filter and sort your history',
      onsubmit: (event) => {
        event.preventDefault();
        reload();
      },
      onchange: reload,
    },
    field('Genre', inputs.genre),
    el('div', { class: 'field-pair' }, field('Rating from', inputs.ratingMin, 'narrow'), field('to', inputs.ratingMax, 'narrow')),
    el('div', { class: 'field-pair' }, field('Watched from', inputs.watchedFrom), field('to', inputs.watchedTo)),
    el('span', { class: 'spacer', 'aria-hidden': 'true' }),
    field('Sort by', inputs.sort),
    field('Order', inputs.order),
  );

  const head = el('div', { class: 'page-head' }, el('h1', { class: 'page-title', text: 'Diary' }), foldable(filters));
  load();
  return [head, genreError, error, list];
}

// ---------- Dashboard (#/dashboard) ----------

/** Horizontal bar list; `value` is what the bar length is scaled by. */
function bars(items, label, value, caption) {
  const max = Math.max(...items.map(value), 1);
  return el(
    'ul',
    { class: 'bars' },
    items.map((item) =>
      el(
        'li',
        {},
        el('span', { class: 'bar-label', text: label(item) }),
        el('span', { class: 'bar-track', 'aria-hidden': 'true' }, el('span', { class: 'bar', style: `width: ${(value(item) / max) * 100}%` })),
        el('span', { class: 'bar-value', text: caption(item) }),
      ),
    ),
  );
}

function section(title, ...body) {
  return el('section', { class: 'stat' }, el('h2', { text: title }), ...body);
}

function dashboard() {
  const root = el('div', { class: 'dashboard' }, el('h1', { class: 'page-title', text: 'Your taste' }), el('div', { class: 'skeleton-shelf', 'aria-hidden': 'true' }));
  (async () => {
    try {
      const [stats, profile, recs] = await Promise.all([api('/stats'), api('/profile'), api('/recommendations?limit=12')]);
      const empty = () => el('p', { class: 'muted small', text: 'Log a film to see this.' });
      const preference = (items) =>
        items.length === 0
          ? empty()
          : bars(
              items.slice(0, 8),
              (i) => i.name,
              (i) => i.count,
              (i) => `${i.count} · avg ${i.averageRating}`,
            );
      const summary =
        stats.watchedCount === 0
          ? 'Nothing logged yet. Rate a few films and this page fills in with your taste and what to watch next.'
          : `${stats.watchedCount} ${stats.watchedCount === 1 ? 'film' : 'films'} logged, rated ${stats.averageRating} on average.`;

      root.replaceChildren(
        el('div', { class: 'page-head' }, el('h1', { class: 'page-title', text: 'Your taste' }), el('p', { class: 'lede', text: summary })),
        el(
          'section',
          { class: 'shelf-section', 'aria-labelledby': 'recs-title' },
          el('h2', { id: 'recs-title', text: 'Watch next' }),
          recs.items.length === 0
            ? el('p', { class: 'muted small', text: 'Recommendations appear once you have rated a film.' })
            : el(
                'ol',
                { class: 'shelf' },
                recs.items.map((r) =>
                  el(
                    'li',
                    {},
                    el(
                      'a',
                      { class: 'shelf-item', href: `#/movies/${r.movie.id}`, title: r.explanation },
                      el('span', { class: 'tile-art' }, poster(r.movie.id, 'tile-poster', 180, r.movie.title)),
                      el('span', { class: 'tile-title', text: r.movie.title }),
                      el('span', { class: 'tile-meta' }, el('span', { text: String(r.movie.year) }), el('span', { class: 'match', text: `score ${r.score}` })),
                      el('span', { class: 'why', text: r.explanation }),
                    ),
                  ),
                ),
              ),
        ),
        el(
          'div',
          { class: 'stats' },
          section('Favourite genres', preference(profile.genres)),
          section('Favourite directors', preference(profile.directors)),
          section(
            'Watched by genre',
            stats.byGenre.length === 0
              ? empty()
              : bars(
                  stats.byGenre,
                  (g) => g.name,
                  (g) => g.count,
                  (g) => String(g.count),
                ),
          ),
          section(
            'Watched by release year',
            stats.byYear.length === 0
              ? empty()
              : bars(
                  stats.byYear,
                  (y) => String(y.year),
                  (y) => y.count,
                  (y) => String(y.count),
                ),
          ),
        ),
      );
    } catch (e) {
      root.replaceChildren(el('p', { class: 'error', role: 'alert', text: e.message }));
    }
  })();
  return root;
}

// ---------- Router ----------

const routes = [
  [/^#\/history$/, () => history(), '#/history', 'Diary'],
  [/^#\/dashboard$/, () => dashboard(), '#/dashboard', 'Your taste'],
  [/^#\/movies\/(\d+)$/, (m) => movieDetail(m[1]), '#/', null],
  [/^#?\/?$/, () => catalog(), '#/', 'Films'],
];

export function route() {
  const hash = location.hash || '#/';
  for (const [pattern, render, nav, title] of routes) {
    const match = hash.match(pattern);
    if (!match) continue;
    for (const a of document.querySelectorAll('.top nav a')) {
      if (a.getAttribute('href') === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    if (title) document.title = `${title} · movie-tracker`;
    app.replaceChildren(...[render(match)].flat());
    window.scrollTo(0, 0);
    return;
  }
  app.replaceChildren(emptyState('Page not found', 'That address does not match any screen.'), el('a', { class: 'button ghost', href: '#/', text: 'Back to the films' }));
}

window.addEventListener('hashchange', route);
route();
