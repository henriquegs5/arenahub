import { useState } from "react";
import { statusServicos } from "./api";
import { usePolling } from "./hooks";
import { StatusServico } from "./types";

/** Faixa no topo: mostra cada serviço e o estado do seu circuito (útil na demo de resiliência). */
export function StatusServicos() {
  const [st, setSt] = useState<Record<string, StatusServico> | null>(null);
  usePolling(async () => {
    try { setSt(await statusServicos()); } catch { setSt(null); }
  }, 3000, []);

  if (!st) return <div className="status"><span className="chip vermelho">gateway fora do ar</span></div>;
  return (
    <div className="status">
      {Object.entries(st).map(([nome, s]) => {
        const cor = s.servico === "no ar" ? "verde" : s.servico === "degradado" ? "amarelo" : "vermelho";
        return (
          <span key={nome} className={`chip ${cor}`} title={`circuito: ${s.circuito}`}>
            {nome}{s.circuito !== "FECHADO" ? ` · ${s.circuito}` : ""}
          </span>
        );
      })}
    </div>
  );
}
