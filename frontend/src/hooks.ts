import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Carrega dados com os três estados que toda tela precisa: carregando, erro e
 * conteúdo. Com `intervaloMs`, continua atualizando em segundo plano — e aí a
 * tela NÃO volta ao esqueleto a cada ciclo, só na primeira carga.
 */
export function useCarregar<T>(
  buscar: () => Promise<T>,
  deps: unknown[],
  intervaloMs?: number
): { dados: T | null; erro: string | null; carregando: boolean; recarregar: () => Promise<void> } {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const ref = useRef(buscar);
  ref.current = buscar;

  const recarregar = useCallback(async () => {
    try {
      setDados(await ref.current());
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    const tick = async () => {
      if (!ativo) return;
      try {
        const v = await ref.current();
        if (ativo) { setDados(v); setErro(null); }
      } catch (e) {
        if (ativo) setErro((e as Error).message);
      } finally {
        if (ativo) setCarregando(false);
      }
    };
    tick();
    if (!intervaloMs) return () => { ativo = false; };
    const id = setInterval(tick, intervaloMs);
    return () => { ativo = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { dados, erro, carregando, recarregar };
}

/**
 * Executa uma ação que muda dados: trava o botão, guarda o erro e avisa quem
 * precisa recarregar. Evita repetir try/catch/setOcupado em toda tela.
 */
export function useAcao(): {
  ocupado: boolean;
  erro: string | null;
  sucesso: string | null;
  limpar: () => void;
  executar: (fn: () => Promise<unknown>, mensagemOk?: string) => Promise<boolean>;
} {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const limpar = useCallback(() => { setErro(null); setSucesso(null); }, []);

  const executar = useCallback(async (fn: () => Promise<unknown>, mensagemOk?: string) => {
    setOcupado(true);
    setErro(null);
    setSucesso(null);
    try {
      await fn();
      if (mensagemOk) setSucesso(mensagemOk);
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }, []);

  return { ocupado, erro, sucesso, limpar, executar };
}
