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
