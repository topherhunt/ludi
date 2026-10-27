import { createEffect, onCleanup, onMount } from 'solid-js';

const WINDOW_MARGIN = 8;

// How many menus are open: while any is, the window-drag regions let clicks
// through (see .floating-menu-open), so a click there can close it.
let openCount = 0;

/**
 * A fixed-position menu or popover opened at the cursor (x, y), pulled back
 * inside the window when it would run past an edge: opened low in the window it
 * would otherwise be cut off, and nothing scrolls to bring it back. Its
 * `.context-submenu` flyouts get the same treatment when they open.
 *
 * Props: x, y, class, ref, children
 */
export function FloatingMenu(props) {
  let el;

  onMount(() => {
    openCount += 1;
    document.body.classList.add('floating-menu-open');
  });
  onCleanup(() => {
    openCount -= 1;
    if (openCount === 0) document.body.classList.remove('floating-menu-open');
  });

  createEffect(() => {
    const { x, y } = props;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(WINDOW_MARGIN, Math.min(x, window.innerWidth - width - WINDOW_MARGIN))}px`;
    el.style.top = `${Math.max(WINDOW_MARGIN, Math.min(y, window.innerHeight - height - WINDOW_MARGIN))}px`;
  });

  // A flyout shows on hover, so it can only be measured once it's open.
  const fitSubmenu = (e) => {
    const item = e.target.closest('.has-submenu');
    if (!item) return;
    const submenu = item.querySelector(':scope > .context-submenu');
    submenu.style.top = '';
    submenu.style.left = '';
    submenu.style.right = '';
    const rect = submenu.getBoundingClientRect();
    const overflowBottom = rect.bottom - (window.innerHeight - WINDOW_MARGIN);
    if (overflowBottom > 0) submenu.style.top = `${submenu.offsetTop - overflowBottom}px`;
    if (rect.right > window.innerWidth - WINDOW_MARGIN) {
      submenu.style.left = 'auto';
      submenu.style.right = '100%';
    }
  };

  return (
    <div
      class={props.class}
      ref={(element) => {
        el = element;
        props.ref?.(element);
      }}
      onMouseOver={fitSubmenu}
    >
      {props.children}
    </div>
  );
}
