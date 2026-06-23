import { For, Show, createContext, useContext } from 'solid-js';
import { createStore, produce } from 'solid-js/store';

const FIELD_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'any', label: 'Any field' },
  { value: 'track', label: 'Track #' },
  { value: 'tag', label: 'Tags (coming soon)', disabled: true },
];

let nextId = 0;
const uid = () => String(++nextId);

const makeCondition = () => ({ id: uid(), type: 'condition', field: 'title' });
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
    const quoted = val.includes(' ') ? `"${val}"` : val;
    return `${node.field}=${quoted}`;
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
  const { inputRefs, onFieldChange, onRemove } = useContext(SearchCtx);

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
      <input
        ref={(el) => { if (el) inputRefs.set(node.id, el); }}
        type="text"
        class="advsearch-value-input"
        spellcheck={false}
        placeholder={node.field === 'track' ? 'e.g. 7' : 'Enter value...'}
      />
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
  const onFieldChange = (id, field) => mutate(id, node => { node.field = field; });
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
    <SearchCtx.Provider value={{ inputRefs, onModeChange, onFieldChange, onAddCondition, onAddGroup, onRemove }}>
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
