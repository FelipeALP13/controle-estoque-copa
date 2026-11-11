"use client";

import { useCallback, useEffect, useState } from "react";
import type { Absence } from "./absences";

export type LoadedAbsence = Absence & { createdByName: string; canDelete: boolean };
export type AbsencesData = { absences: LoadedAbsence[]; people: { id: number; name: string }[]; me: { id: number; manageable: "all" | number[] } };

const CHANGED = "absences-changed";
let cache: { at: number; promise: Promise<AbsencesData | null> } | null = null;

function fetchAbsences(force = false) {
  if (!force && cache && Date.now() - cache.at < 60000) return cache.promise;
  const promise = fetch("/api/absences", { cache: "no-store" })
    .then(async (response) => (response.ok ? (await response.json()) as AbsencesData : null))
    .catch(() => null);
  cache = { at: Date.now(), promise };
  return promise;
}

/** Avisa todas as telas abertas que as ausências mudaram. */
export function absencesChanged() {
  cache = null;
  window.dispatchEvent(new Event(CHANGED));
}

/** Ausências do último mês em diante. Sem a migração aplicada, volta vazio sem quebrar a tela. */
export function useAbsences() {
  const [data, setData] = useState<AbsencesData | null>(null);
  const load = useCallback(async (force = false) => { setData(await fetchAbsences(force)); }, []);
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const onChange = () => { void load(true); };
    window.addEventListener(CHANGED, onChange);
    return () => { window.clearTimeout(first); window.removeEventListener(CHANGED, onChange); };
  }, [load]);
  return { absences: data?.absences ?? [], people: data?.people ?? [], me: data?.me ?? null, loaded: data !== null };
}
