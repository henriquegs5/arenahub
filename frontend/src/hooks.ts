import { useEffect, useRef } from "react";

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
