"use client";
import { useReducer, useRef } from "react";

/** File-local undo history. Consecutive keystrokes in one edit form one step. */
export function useSpreadsheetHistory(content: string, onChange?: (content: string) => void) {
  const [, refresh] = useReducer(value => value + 1, 0);
  const history = useRef({ past: [] as string[], future: [] as string[], current: content, group: undefined as string | undefined });
  if (history.current.current !== content) history.current = { past: [], future: [], current: content, group: undefined };
  function finish() { history.current.group = undefined; }
  function commit(next: string, group?: string) {
    const state = history.current;
    if (!onChange || next === state.current) return;
    if (!group || group !== state.group) {
      state.past.push(state.current);
      // Bound retained file text as well as the number of edits.
      while (state.past.length > 50 || (state.past.length > 1 && state.past.reduce((sum, value) => sum + value.length, 0) > 8_000_000)) state.past.shift();
    }
    state.current = next; state.group = group; state.future = [];
    if (state.past.at(-1) === next) { state.past.pop(); state.group = undefined; }
    onChange(next); refresh();
  }
  function restore(direction: "undo" | "redo") {
    const state = history.current, source = direction === "undo" ? state.past : state.future, destination = direction === "undo" ? state.future : state.past;
    const next = source.pop(); if (next === undefined || !onChange) return;
    destination.push(state.current); state.current = next; finish(); onChange(next); refresh();
  }
  return { commit, finish, undo: () => restore("undo"), redo: () => restore("redo"), canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 };
}
