import { create } from "zustand";
import type { InstructionSet } from "./chat.types";
import {
  clearSelectedInstructionSet,
  getSelectedInstructionSetId,
  listInstructionSets,
  setSelectedInstructionSetId,
} from "./instructionSetsApi";

// module-level rather than LLMChat state because ChatPage remounts LLMChat on every conversation
// switch (key={chatKey}). Component state would refetch both endpoints per switch and, worse, sit
// at "None" until they resolved — a message sent in that window would silently go without the
// user's stored default. The selection is a global user setting anyway, so one page-lifetime copy
// is the right scope; a full page load (login/logout) resets it.

interface InstructionSetsState {
  sets: InstructionSet[];
  selectedId: string | null;
  loaded: boolean;
  /** force refetches after the management dialog may have renamed, created or archived a set */
  load: (force?: boolean) => Promise<void>;
  select: (id: string | null) => void;
}

let inflight: Promise<void> | null = null;

export const useInstructionSetsStore = create<InstructionSetsState>((set, get) => ({
  sets: [],
  selectedId: null,
  loaded: false,

  load: (force = false) => {
    if (inflight) return inflight;
    if (get().loaded && !force) return Promise.resolve();
    inflight = (async () => {
      try {
        const [sets, selected] = await Promise.all([
          listInstructionSets(),
          getSelectedInstructionSetId(),
        ]);
        // reached only once BOTH fetches resolved, so a list that failed to load can never be read
        // as "the selected set is gone"
        if (selected && !sets.some((s) => s.id === selected)) {
          // archiving a set deliberately leaves the stored pointer behind, so it can outlive the
          // set it names. drop to None and clear the setting rather than showing it as unavailable:
          // the server ignores an id it cannot resolve, so a dangling selection would claim to be
          // shaping every answer while doing nothing, and it can never become valid again.
          set({ sets, selectedId: null, loaded: true });
          await clearSelectedInstructionSet();
          return;
        }
        set({ sets, selectedId: selected, loaded: true });
      } catch (err) {
        // instructions are optional; a failure here leaves the selector at None rather than
        // blocking chat entirely
        console.error("Failed to load instruction sets:", err);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  select: (id: string | null) => {
    set({ selectedId: id });
    // the selection is the user's global default, so it outlives the page. clearing goes through
    // DELETE because the settings endpoint rejects an empty setting_value with a 400
    const persisted = id ? setSelectedInstructionSetId(id) : clearSelectedInstructionSet();
    persisted.catch((err) => console.error("Failed to save the selected instruction set:", err));
  },
}));
