# Product

## Register

product

## Users
One person tracking the films they watch. They run the app on their own laptop (localhost). They use it mostly in the evening, in a dim room, right after a film: they find the movie they just watched, rate it, and leave a note. Sometimes they browse the catalog of ~19 000 IMDb films or check recommendations to pick the next one.

## Product Purpose
movie-tracker is a personal film log with a large catalog. Its main loop: find the film you watched, then rate it, then see your history, taste profile, recommendations and stats update. Posters, plots and cast from TMDB make it feel like a real film app. Success means logging a film takes seconds, and browsing the catalog or your history feels like flipping through a film collection, not a database.

## Brand Personality
Cinematic, moody, personal. It should feel like the moment the lights go down in a screening room. The posters bring the colour, and the interface recedes into the dark around them. The voice is short and plain, the way a film fan talks about films. The emotional goal is calm pleasure in your own collection.

References: Letterboxd (poster-led browsing, a diary of what you watched, a film-nerd sensibility) and Apple TV (large imagery, cinematic depth, a dark and glossy stage for the artwork).

## Anti-references
- IMDb-style clutter: dense, yellow-accented information overload.
- Generic SaaS dashboards: hero-metric tiles, identical card grids, gradient accents.
- Light, cream "notebook" aesthetics. This is a screening room, not a paper journal.

## Design Principles
1. **Posters lead, chrome recedes.** Artwork is the colour and the focal point. UI surfaces stay dark and quiet so the films stand out.
2. **Logging is the hero action.** Rating a film you just watched must be obvious and quick on the movie page.
3. **Browse like a collection.** The catalog and history should feel like flipping through films, with clear but unobtrusive filters.
4. **Graceful without data.** No poster, no TMDB token, no history yet: every screen still looks intentional, never broken.
5. **Evening comfort.** Low glare, readable contrast, nothing that shouts.

## Accessibility & Inclusion
WCAG 2.2 AA contrast for all text, including muted text and placeholders. Full keyboard use with a visible focus. Labelled form controls. Every animation respects `prefers-reduced-motion`. Information is never carried by colour alone (ratings and states also have text).
