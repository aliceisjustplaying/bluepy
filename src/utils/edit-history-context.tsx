import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import type { MutableRef } from 'preact/hooks';
import { useContext, useRef, useState } from 'preact/hooks';

import { api } from '../utils/api';

interface EditHistoryEntry {
  createdAt: string;
  [key: string]: unknown;
}

interface EditHistoryContextValue {
  editHistoryRef: MutableRef<EditHistoryEntry[]>;
  initEditHistory: () => Promise<void>;
  exitEditHistory: () => void;
  editHistoryMode: boolean;
  editedAtIndex: number;
  prevEditedAt: () => void;
  nextEditedAt: () => void;
}

const EditHistoryContext = createContext<EditHistoryContextValue>(
  {} as EditHistoryContextValue,
);

const supportsViewTransition = !!document.startViewTransition;

export function EditHistoryProvider({
  children,
  statusID,
}: {
  children?: ComponentChildren;
  statusID: string;
}) {
  const editHistoryRef = useRef<EditHistoryEntry[]>([]);
  const [editHistoryMode, setEditHistoryMode] = useState(false);
  // 0 is latest
  const [editedAtIndex, _setEditedAtIndex] = useState(0);

  // setEditedAtIndex, with View Transitions API
  function setEditedAtIndex(i: number | ((prev: number) => number)) {
    if (i === editedAtIndex) return;
    if (supportsViewTransition) {
      document.startViewTransition(() => {
        _setEditedAtIndex(i);
      });
    } else {
      _setEditedAtIndex(i);
    }
  }

  async function fetchEditHistory() {
    const { masto } = api();
    const statuses = masto.v1.statuses as {
      $select: (id: string) => {
        history: { list: () => Promise<EditHistoryEntry[]> };
      };
    };
    const history = await statuses.$select(statusID).history.list();
    // sort latest first
    history.sort(
      (a: EditHistoryEntry, b: EditHistoryEntry) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    editHistoryRef.current = history;
  }

  async function initEditHistory() {
    console.log('initEditHistory', statusID);
    try {
      await fetchEditHistory();
      setEditHistoryMode(true);
      setEditedAtIndex(0);
    } catch (e) {
      console.error(e);
      setEditHistoryMode(false);
    }
  }

  function exitEditHistory() {
    editHistoryRef.current = [];
    setEditHistoryMode(false);
    setEditedAtIndex(0);
  }

  function prevEditedAt() {
    setEditedAtIndex((i: number) =>
      Math.min(i + 1, editHistoryRef.current.length - 1),
    );
  }

  function nextEditedAt() {
    setEditedAtIndex((i: number) => Math.max(i - 1, 0));
  }

  return (
    <EditHistoryContext.Provider
      value={{
        editHistoryRef,
        initEditHistory,
        exitEditHistory,
        editHistoryMode,
        editedAtIndex,
        prevEditedAt,
        nextEditedAt,
      }}
    >
      {children}
    </EditHistoryContext.Provider>
  );
}

export function useEditHistory() {
  return useContext(EditHistoryContext);
}
