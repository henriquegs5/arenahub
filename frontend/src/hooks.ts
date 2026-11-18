import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Torneio } from "./types";

/** Executa fn agora e a cada `ms` milissegundos, sem acumular chamadas. */
export function usePolling(fn: () => Promise<void>, ms: number, deps: unknown[]) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let ativo = true;
    const tick = async () => { if (ativo) { try { await ref.current(); } catch { /* tratado em fn */ } } };
    tick();
    const id = setInterval(tick, ms);
    return () => { ativo = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useTorneios(ms = 4000): { torneios: Torneio[]; erro: string | null; recarregar: () => Promise<void> } {
  const [torneios, setTorneios] = useState<Torneio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const recarregar = async () => {
    try { setTorneios(await api<Torneio[]>("GET", "torneios")); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  };
  usePolling(recarregar, ms, []);
  return { torneios, erro, recarregar };
}
