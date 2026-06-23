/**
 * Explorer header with title and controls
 */
export function ExplorerHeader(props) {
  return (
    <div class="explorer-header">
      <h1 id="currentListTitle">{props.title || 'Main Library'}</h1>
    </div>
  );
}
