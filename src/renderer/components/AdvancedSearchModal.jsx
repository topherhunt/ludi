import { For, Match, Show, Switch, createContext, useContext } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { tags } from '../stores/tags.js';

const FIELD_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'any', label: 'Any field' },
  { value: 'track', label: 'Track #' },
  { value: 'tag', label: 'Tag' },
  { value: 'rating', label: 'Rating' },
  { value: 'plays', label: 'Play count' },
  { value: 'lastplayed', label: 'Last played' },
];

// Countable fields compare rather than match, because "songs I like" is a
// threshold ("4 or more"), not an equality.
const NUMBER_OPERATORS = [
  { value: '>=', label: 'is at least' },
  { value: '=',  label: 'is exactly' },
  { value: '<=', label: 'is at most' },
];

// The same three operators read as nonsense against a date ("last played is at
// least June 1"), so the date field gets its own labels for them.
const DATE_OPERATORS = [
  { value: '>=', label: 'is on or after' },
  { value: '=',  label: 'is on' },
  { value: '<=', label: 'is on or before' },
];

const COMPARED_FIELDS = ['track', 'rating', 'plays', 'lastplayed'];
const operatorsFor = (field) => (field === 'lastplayed' ? DATE_OPERATORS : NUMBER_OPERATORS);

const numericPlaceholder = (field) => {
  if (field === 'track') return 'e.g. 7';
  if (field === 'plays') return 'e.g. 5';
  return 'Enter value...';
};

const RATING_VALUES = [
  { value: '5', label: '★★★★★' },
  { value: '4', label: '★★★★' },
  { value: '3', label: '★★★' },
  { value: '2', label: '★★' },
  { value: '1', label: '★' },
  { value: 'any', label: 'Rated (any)' },
  { value: 'none', label: 'Unrated' },
];

// `none`/`any` are membership tests, not thresholds -- "at least unrated" is
// meaningless, so those two values force plain equality and hide the operator
// rather than leaving a stale "is at least" sitting next to "Unrated".
const isRatingMembership = (value) => value === 'none' || value === 'any';

const hasOperator = (node) =>
  COMPARED_FIELDS.includes(node.field) &&
  !(node.field === 'rating' && isRatingMembership(node.value));

let nextId = 0;
const uid = () => String(++nextId);

const makeCondition = () => ({ id: uid(), type: 'condition', field: 'title', negate: false, op: '>=' });
const makeGroup = (mode = 'any') => ({ id: uid(), type: 'group', mode, children: [makeCondition()] });

// Recursively find a node by id and call fn(node)
function findAndMutate(node, targetId, fn) {
  if (node.id === targetId) { fn(node); return true; }
  if (node.children) {
    for (const child of node.children) {
      if (findAndMutate(child, targetId, fn)) return true;
    }
  }
  return false;
}

// Find a node's parent and call fn(parent, childIndex)
function findParentAndMutate(node, targetId, fn) {
  if (node.children) {
    const idx = node.children.findIndex(c => c.id === targetId);
    if (idx !== -1) { fn(node, idx); return true; }
    for (const child of node.children) {
      if (findParentAndMutate(child, targetId, fn)) return true;
    }
  }
  return false;
}

// Build the query string from the tree, reading text input values from the refs map
function buildQuery(node, inputRefs, isRoot = false) {
  if (node.type === 'condition') {
    const val = (inputRefs.get(node.id)?.value || '').trim();
    if (!val) return '';
    if (COMPARED_FIELDS.includes(node.field)) {
      const op = node.field === 'rating' && isRatingMembership(val) ? '=' : node.op;
      return `${node.field}${op}${val}`;
    }
    const quoted = val.includes(' ') ? `"${val}"` : val;
    const base = `${node.field}=${quoted}`;
    return node.negate ? `NOT ${base}` : base;
  }
  if (node.type === 'group') {
    const op = node.mode === 'all' ? ' AND ' : ' OR ';
    const parts = node.children.map(c => buildQuery(c, inputRefs)).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    const joined = parts.join(op);
    return isRoot ? joined : `(${joined})`;
  }
  return '';
}

const SearchCtx = createContext();

function ConditionRow({ node, canRemove }) {
  const { inputRefs, onFieldChange, onNegateChange, onOpChange, onValueChange, onRemove } = useContext(SearchCtx);

  return (
    <div class="advsearch-condition-row">
      <select
        class="advsearch-field-select"
        value={node.field}
        onChange={(e) => onFieldChange(node.id, e.target.value)}
      >
        <For each={FIELD_OPTIONS}>
          {(opt) => (
            <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
          )}
        </For>
      </select>

      {/* Every compared field shares one operator dropdown -- only the labels
          differ (see operatorsFor), so a date never offers "is at least". */}
      <Show when={hasOperator(node)}>
        <select
          class="advsearch-op-select qa-compare-op"
          value={node.op}
          onChange={(e) => onOpChange(node.id, e.target.value)}
        >
          <For each={operatorsFor(node.field)}>
            {(op) => <option value={op.value}>{op.label}</option>}
          </For>
        </select>
      </Show>

      <Switch fallback={
        <input
          ref={(el) => { if (el) inputRefs.set(node.id, el); }}
          type="text"
          class="advsearch-value-input"
          spellcheck={false}
          placeholder={numericPlaceholder(node.field)}
        />
      }>
        {/* Tag condition: is / is not toggle + a dropdown of all defined tags */}
        <Match when={node.field === 'tag'}>
          <select
            class="advsearch-op-select advsearch-op-narrow"
            value={node.negate ? 'not' : 'is'}
            onChange={(e) => onNegateChange(node.id, e.target.value === 'not')}
          >
            <option value="is">is</option>
            <option value="not">is not</option>
          </select>
          <select
            ref={(el) => { if (el) inputRefs.set(node.id, el); }}
            class="advsearch-value-input advsearch-tag-select"
          >
            <For each={tags()}>
              {(tag) => <option value={tag.name}>{tag.name}</option>}
            </For>
          </select>
        </Match>

        {/* Rating condition: a star value, or one of the two membership tests */}
        <Match when={node.field === 'rating'}>
          <select
            ref={(el) => { if (el) inputRefs.set(node.id, el); }}
            class="advsearch-value-input qa-rating-value"
            onChange={(e) => onValueChange(node.id, e.target.value)}
          >
            <For each={RATING_VALUES}>
              {(v) => <option value={v.value}>{v.label}</option>}
            </For>
          </select>
        </Match>

        {/* Last played: a real date picker, so the query never has to be typed */}
        <Match when={node.field === 'lastplayed'}>
          <input
            ref={(el) => { if (el) inputRefs.set(node.id, el); }}
            type="date"
            class="advsearch-value-input qa-date-value"
          />
        </Match>
      </Switch>

      <button
        class="advsearch-remove-btn"
        onClick={() => onRemove(node.id)}
        disabled={!canRemove()}
        title="Remove"
      >
        <i class="bi bi-x" />
      </button>
    </div>
  );
}

function GroupNode({ node, isRoot }) {
  const { onModeChange, onAddCondition, onAddGroup, onRemove } = useContext(SearchCtx);

  return (
    <div class="advsearch-group" classList={{ 'advsearch-group-root': isRoot }}>
      <div class="advsearch-group-header">
        <select
          class="advsearch-mode-select"
          value={node.mode}
          onChange={(e) => onModeChange(node.id, e.target.value)}
        >
          <option value="all">Match all (AND)</option>
          <option value="any">Match any (OR)</option>
        </select>
        <Show when={!isRoot}>
          <button
            class="advsearch-remove-group-btn"
            onClick={() => onRemove(node.id)}
            title="Remove group"
          >
            <i class="bi bi-x" />
          </button>
        </Show>
      </div>

      <div class="advsearch-group-body">
        <For each={node.children}>
          {(child) => (
            <Show
              when={child.type === 'condition'}
              fallback={<GroupNode node={child} isRoot={false} />}
            >
              <ConditionRow node={child} canRemove={() => node.children.length > 1} />
            </Show>
          )}
        </For>
      </div>

      <div class="advsearch-group-actions">
        <button class="advsearch-action-btn" onClick={() => onAddCondition(node.id)}>
          <i class="bi bi-plus" /> Condition
        </button>
        <button class="advsearch-action-btn" onClick={() => onAddGroup(node.id)}>
          <i class="bi bi-plus" /> Group
        </button>
      </div>
    </div>
  );
}

export function AdvancedSearchModal(props) {
  const inputRefs = new Map();
  const [root, setRoot] = createStore({ id: uid(), type: 'group', mode: 'all', children: [makeCondition()] });

  const mutate = (id, fn) => setRoot(produce(draft => findAndMutate(draft, id, fn)));
  const mutateParent = (id, fn) => setRoot(produce(draft => findParentAndMutate(draft, id, fn)));

  const onModeChange = (id, mode) => mutate(id, node => { node.mode = mode; });
  // Switching fields swaps in a different value control, so the recorded value
  // is stale -- keeping it would let a rating row that once said "Unrated" come
  // back from another field still missing its operator.
  const onFieldChange = (id, field) => mutate(id, node => { node.field = field; node.value = undefined; });
  const onNegateChange = (id, negate) => mutate(id, node => { node.negate = negate; });
  const onOpChange = (id, op) => mutate(id, node => { node.op = op; });
  // Only the dropdown-valued fields report their value into the tree; it is
  // what tells the rating row whether it still has an operator to show.
  const onValueChange = (id, value) => mutate(id, node => { node.value = value; });
  const onAddCondition = (parentId) => mutate(parentId, node => { node.children.push(makeCondition()); });
  const onAddGroup = (parentId) => mutate(parentId, node => { node.children.push(makeGroup('any')); });

  const onRemove = (id) => {
    mutateParent(id, (parent, idx) => {
      if (parent.children.length <= 1) return;
      const cleanup = (node) => {
        if (node.type === 'condition') inputRefs.delete(node.id);
        if (node.children) node.children.forEach(cleanup);
      };
      cleanup(parent.children[idx]);
      parent.children.splice(idx, 1);
    });
  };

  const handleSubmit = () => {
    const query = buildQuery(root, inputRefs, true);
    if (query) {
      props.onSearch?.(query);
      props.onClose?.();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') props.onClose?.();
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') handleSubmit();
  };

  return (
    <SearchCtx.Provider value={{ inputRefs, onModeChange, onFieldChange, onNegateChange, onOpChange, onValueChange, onAddCondition, onAddGroup, onRemove }}>
      <Show when={props.open}>
        <div
          class="modal-overlay visible"
          onClick={(e) => e.target === e.currentTarget && props.onClose?.()}
        >
          <div class="modal-dialog advanced-search-dialog" onKeyDown={handleKeyDown}>
            <div class="modal-title">
              <i class="bi bi-gear-wide-connected" style={{ 'margin-right': '8px' }} />
              Advanced Search
            </div>

            <div class="modal-content advanced-search-content">
              <GroupNode node={root} isRoot={true} />
            </div>

            <div class="modal-buttons">
              <button class="modal-btn modal-btn-secondary" onClick={props.onClose}>Cancel</button>
              <button class="modal-btn" onClick={handleSubmit}>Search</button>
            </div>
          </div>
        </div>
      </Show>
    </SearchCtx.Provider>
  );
}
