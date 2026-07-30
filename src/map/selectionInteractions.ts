type ModifierPointerEvent = {
  originalEvent: {
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    button?: number;
  };
};

/**
 * Own Ctrl/Cmd + primary-button drag for map selection on every platform.
 *
 * OpenLayers' platform helper chooses either Ctrl or Cmd from its runtime OS
 * detection. Browser and remote-desktop environments can report that platform
 * differently, so accepting either modifier here is both clearer and more
 * reliable. Shift remains free of selection semantics.
 */
export function modifierBoxSelection(event: ModifierPointerEvent): boolean {
  const original = event.originalEvent;
  return (
    (original.button ?? 0) === 0 &&
    !original.altKey &&
    !original.shiftKey &&
    (original.ctrlKey || original.metaKey)
  );
}
