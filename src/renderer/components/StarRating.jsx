import { For, createSignal } from 'solid-js';
import { MAX_RATING, rateFromRow, toggleRating } from '../stores/ratings.js';

const STARS = Array.from({ length: MAX_RATING }, (_, i) => i + 1);

/**
 * The five-star rating cell for one song row.
 *
 * Props:
 *   rating: number|null  - the song's current rating
 *   itemId: number       - the placement this row represents (what the rating gesture targets)
 *
 * Hovering previews the rating you would get by clicking, so the widget shows
 * the outcome before you commit to it.
 */
/**
 * A read-only average rating, filling stars fractionally: 3.4 is three full
 * stars and four tenths of the fourth.
 */
export function AverageStars(props) {
  const fill = (star) => Math.min(Math.max(props.rating - (star - 1), 0), 1);
  return (
    <span class="star-rating average-stars qa-average-stars" data-rating={props.rating} title={`Average ${props.rating} stars`}>
      <For each={STARS}>
        {(star) => (
          <span class="average-star">
            <i class="star bi bi-star" />
            <i class="star bi bi-star-fill average-star-fill" style={{ 'clip-path': `inset(0 ${100 - fill(star) * 100}% 0 0)` }} />
          </span>
        )}
      </For>
    </span>
  );
}

export function StarRating(props) {
  const [hovered, setHovered] = createSignal(null);

  // What to draw: the hover preview while the pointer is over the stars,
  // otherwise the stored rating.
  const shown = () => hovered() ?? props.rating ?? 0;

  const handleClick = (star, e) => {
    // Rating a row must never also play it or disturb the selection.
    e.stopPropagation();
    rateFromRow(props.itemId, toggleRating(props.rating ?? null, star));
  };

  return (
    <span
      class="star-rating qa-star-rating"
      data-rating={props.rating ?? ''}
      onMouseLeave={() => setHovered(null)}
      onDblClick={(e) => e.stopPropagation()}
    >
      <For each={STARS}>
        {(star) => (
          <i
            class="star"
            classList={{
              'bi bi-star-fill': star <= shown(),
              'bi bi-star': star > shown(),
              'star-preview': hovered() !== null,
            }}
            data-star={star}
            title={
              props.rating === star
                ? `Clear ${star}-star rating`
                : `Rate ${star} star${star === 1 ? '' : 's'}`
            }
            onMouseEnter={() => setHovered(star)}
            onClick={(e) => handleClick(star, e)}
          />
        )}
      </For>
    </span>
  );
}
