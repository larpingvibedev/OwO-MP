import { create } from 'zustand';
import type { Track } from '../types';
import { getTrackInstanceId } from '../types';

interface SelectionState {
  contextId: string | null;
  selectedItemIds: Set<string>;
  anchorItemId: string | null;
  selectionMode: boolean;
  contextItems: Track[];

  // Actions
  setContext: (contextId: string, items?: Track[]) => void;
  updateContextItems: (items: Track[]) => void;
  toggleItem: (
    itemId: string, 
    options?: { 
      isMulti?: boolean; 
      isRange?: boolean; 
      allItems?: Track[];
      forceSelect?: boolean;
    }
  ) => void;
  selectAll: (items?: Track[]) => void;
  clearSelection: () => void;
  setSelectionMode: (mode: boolean) => void;
  getSelectedTracks: () => Track[];
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  contextId: null,
  selectedItemIds: new Set<string>(),
  anchorItemId: null,
  selectionMode: false,
  contextItems: [],

  setContext: (contextId: string, items: Track[] = []) => {
    const current = get();
    if (current.contextId !== contextId) {
      set({
        contextId,
        selectedItemIds: new Set<string>(),
        anchorItemId: null,
        selectionMode: false,
        contextItems: items
      });
    } else {
      set({ contextItems: items });
    }
  },

  updateContextItems: (items: Track[]) => {
    set({ contextItems: items });
  },

  toggleItem: (itemId: string, options = {}) => {
    const { isMulti, isRange, allItems, forceSelect } = options;
    const { selectedItemIds, anchorItemId, selectionMode } = get();
    const items = allItems || get().contextItems;

    const nextSelected = new Set(selectedItemIds);

    // Range Selection (Shift + Click)
    if (isRange && anchorItemId && items.length > 0) {
      const anchorIdx = items.findIndex((t, idx) => getTrackInstanceId(t, idx) === anchorItemId);
      const targetIdx = items.findIndex((t, idx) => getTrackInstanceId(t, idx) === itemId);

      if (anchorIdx !== -1 && targetIdx !== -1) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);

        for (let i = start; i <= end; i++) {
          nextSelected.add(getTrackInstanceId(items[i], i));
        }

        set({
          selectedItemIds: nextSelected,
          selectionMode: true
        });
        return;
      }
    }

    // Toggle single item (Ctrl/Cmd or Selection Mode)
    if (isMulti || selectionMode) {
      if (forceSelect === true) {
        nextSelected.add(itemId);
      } else if (forceSelect === false) {
        nextSelected.delete(itemId);
      } else {
        if (nextSelected.has(itemId)) {
          nextSelected.delete(itemId);
        } else {
          nextSelected.add(itemId);
        }
      }

      const hasSelections = nextSelected.size > 0;
      set({
        selectedItemIds: nextSelected,
        anchorItemId: itemId,
        selectionMode: hasSelections ? selectionMode : false
      });
      return;
    }

    // Normal Click inside selection-mode toggle button
    if (forceSelect !== undefined) {
      if (forceSelect) nextSelected.add(itemId);
      else nextSelected.delete(itemId);
      set({
        selectedItemIds: nextSelected,
        anchorItemId: itemId,
        selectionMode: nextSelected.size > 0
      });
      return;
    }

    // Direct single selection
    set({
      selectedItemIds: new Set([itemId]),
      anchorItemId: itemId,
      selectionMode: true
    });
  },

  selectAll: (providedItems?: Track[]) => {
    const items = providedItems || get().contextItems;
    if (!items || items.length === 0) return;

    const allIds = new Set(items.map((t, idx) => getTrackInstanceId(t, idx)));
    set({
      selectedItemIds: allIds,
      anchorItemId: getTrackInstanceId(items[0], 0),
      selectionMode: true
    });
  },

  clearSelection: () => {
    set({
      selectedItemIds: new Set<string>(),
      anchorItemId: null,
      selectionMode: false
    });
  },

  setSelectionMode: (mode: boolean) => {
    set((state) => ({
      selectionMode: mode,
      selectedItemIds: mode ? state.selectedItemIds : new Set<string>(),
      anchorItemId: mode ? state.anchorItemId : null
    }));
  },

  getSelectedTracks: () => {
    const { selectedItemIds, contextItems } = get();
    if (selectedItemIds.size === 0) return [];
    return contextItems.filter((t, idx) => selectedItemIds.has(getTrackInstanceId(t, idx)));
  }
}));
