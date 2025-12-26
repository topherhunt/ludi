/**
 * Explorer header with title and controls
 */
export function ExplorerHeader(props) {
  return (
    <div class="explorer-header">
      <h1 id="currentListTitle">{props.title || 'Main Library'}</h1>
      <div class="explorer-controls">
        <button
          id="collapseAllBtn"
          title="Collapse All"
          onClick={props.onCollapseAll}
        >
          Collapse All
        </button>
        <button
          id="expandAllBtn"
          title="Expand All"
          onClick={props.onExpandAll}
        >
          Expand All
        </button>
      </div>
    </div>
  );
}
