import type { ReactNode } from 'react';
import { createContext } from 'react';
import type { RefObject } from 'react';
import { use, useCallback, useMemo, useRef, useState } from 'react';

import { api } from '../utils/api';

interface EditHistoryEntry {
  createdAt: string;
  [key: string]: unknown;
}

interface EditHistoryContextValue {
  editHistoryRef: RefObject<EditHistoryEntry[]>;
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
  children?: ReactNode;
  statusID: string;
}) {
  const editHistoryRef = useRef<EditHistoryEntry[]>([]);
  const [editHistoryMode, setEditHistoryMode] = useState(false);
  // 0 is latest
  const [editedAtIndex, _setEditedAtIndex] = useState(0);

  // setEditedAtIndex, with View Transitions API
  const setEditedAtIndex = useCallback(
    (i: number | ((prev: number) => number)) => {
      const updateIndex = (prev: number) => {
        const next = typeof i === 'function' ? i(prev) : i;
        return next === prev ? prev : next;
      };
      if (supportsViewTransition) {
        document.startViewTransition(() => {
          _setEditedAtIndex(updateIndex);
        });
      } else {
        _setEditedAtIndex(updateIndex);
      }
    },
    [],
  );

  const fetchEditHistory = useCallback(async () => {
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
  }, [statusID]);

  const initEditHistory = useCallback(async () => {
    console.log('initEditHistory', statusID);
    try {
      await fetchEditHistory();
      setEditHistoryMode(true);
      setEditedAtIndex(0);
    } catch (e) {
      console.error(e);
      setEditHistoryMode(false);
    }
  }, [fetchEditHistory, setEditedAtIndex, statusID]);

  const exitEditHistory = useCallback(() => {
    editHistoryRef.current = [];
    setEditHistoryMode(false);
    setEditedAtIndex(0);
  }, [setEditedAtIndex]);

  const prevEditedAt = useCallback(() => {
    setEditedAtIndex((i: number) =>
      Math.min(i + 1, editHistoryRef.current.length - 1),
    );
  }, [setEditedAtIndex]);

  const nextEditedAt = useCallback(() => {
    setEditedAtIndex((i: number) => Math.max(i - 1, 0));
  }, [setEditedAtIndex]);

  const contextValue = useMemo(
    () => ({
      editHistoryRef,
      initEditHistory,
      exitEditHistory,
      editHistoryMode,
      editedAtIndex,
      prevEditedAt,
      nextEditedAt,
    }),
    [
      editHistoryRef,
      initEditHistory,
      exitEditHistory,
      editHistoryMode,
      editedAtIndex,
      prevEditedAt,
      nextEditedAt,
    ],
  );

  return (
    <EditHistoryContext.Provider value={contextValue}>
      {children}
    </EditHistoryContext.Provider>
  );
}

export function useEditHistory() {
  return use(EditHistoryContext);
}
