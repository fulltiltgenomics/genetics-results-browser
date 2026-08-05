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
  /** what the selector shows and what the next message sends */
  selectedId: string | null;
  /** the user's own last explicit choice, persisted server-side. see useChatOptions for why the
   * two are separate: opening an old conversation changes the former and never the latter */
  defaultId: string | null;
  loaded: boolean;
  /** whether a conversation's set is on screen; it outranks the user default being fetched */
  conversationApplied: boolean;
  /** force refetches after the management dialog may have renamed, created or archived a set */
  load: (force?: boolean) => Promise<void>;
  select: (id: string | null) => void;
  /** apply a conversation's stored set without touching the user's default */
  applyFromConversation: (id: string | null) => void;
  /** starting a new chat returns the selector to the user's default */
  resetToDefault: () => void;
}

let inflight: Promise<void> | null = null;
// the most recent selection PUT/DELETE, so load() can wait for it to land before reading back
let pendingSelection: Promise<void> | null = null;

/** an archived set keeps its id in the messages it shaped but is gone from the list. the server
 * ignores an id it cannot resolve, so showing one would claim to shape answers while doing nothing */
function resolve(id: string | null, sets: InstructionSet[]): string | null {
  return id !== null && sets.some((s) => s.id === id) ? id : null;
}

export const useInstructionSetsStore = create<InstructionSetsState>((set, get) => ({
  sets: [],
  selectedId: null,
  defaultId: null,
  loaded: false,
  conversationApplied: false,

  load: (force = false) => {
    if (inflight) return inflight;
    if (get().loaded && !force) return Promise.resolve();
    inflight = (async () => {
      try {
        // a selection made moments ago persists without being awaited, so wait for it here or
        // this GET can return the pre-PUT value and the dialog reopens on the old set
        // (genetics-results-suite-uvh 14)
        await pendingSelection?.catch(() => {});
        // serialized, not Promise.all: read the pointer first and the list second, so the list is
        // provably no older than the pointer it is validated against. Fetched in parallel, a set
        // created and selected in a SECOND TAB between the two responses arrives as list=[] with
        // selected=X, and the dangling-pointer branch below clears a perfectly valid selection.
        // Costs one serialized round trip (genetics-results-suite-uvh 13)
        const selected = await getSelectedInstructionSetId();
        const sets = await listInstructionSets();
        // reached only once BOTH fetches resolved, so a list that failed to load can never be read
        // as "the selected set is gone"
        if (selected && !sets.some((s) => s.id === selected)) {
          // archiving a set deliberately leaves the stored pointer behind, so it can outlive the
          // set it names. drop to None and clear the setting rather than showing it as unavailable:
          // the server ignores an id it cannot resolve, so a dangling selection would claim to be
          // shaping every answer while doing nothing, and it can never become valid again.
          set({
            sets,
            defaultId: null,
            loaded: true,
            // a conversation opened while this was in flight is showing its own set, which is
            // unrelated to the dangling default being cleared here
            selectedId: get().conversationApplied ? resolve(get().selectedId, sets) : null,
          });
          await clearSelectedInstructionSet();
          return;
        }
        set({
          sets,
          defaultId: selected,
          loaded: true,
          selectedId: get().conversationApplied ? resolve(get().selectedId, sets) : selected,
        });
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
    set({ selectedId: id, defaultId: id });
    // the selection is the user's global default, so it outlives the page. clearing goes through
    // DELETE because the settings endpoint rejects an empty setting_value with a 400
    const persisted = id ? setSelectedInstructionSetId(id) : clearSelectedInstructionSet();
    // not awaited here — the selector must not block on the network — but load() waits for it, so
    // a reload triggered right after a change cannot read the pre-PUT value
    pendingSelection = persisted;
    persisted.catch((err) => console.error("Failed to save the selected instruction set:", err));
  },

  applyFromConversation: (id: string | null) => {
    // taken as-is until the list is in hand: this can land before load() resolves, and validating
    // against an empty list would drop the conversation's set. load() re-resolves it afterwards
    set({
      selectedId: get().loaded ? resolve(id, get().sets) : id,
      conversationApplied: true,
    });
  },

  resetToDefault: () => {
    set({ selectedId: get().defaultId, conversationApplied: false });
  },
}));
