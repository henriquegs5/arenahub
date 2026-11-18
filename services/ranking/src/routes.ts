import { Router } from "express";
import { classificar, CRITERIOS_GERAL, CRITERIOS_TORNEIO } from "./classificacao";
import * as repo from "./repositorio";

export const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/torneios/:id", async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return void res.status(400).json({ erro: "id inválido" });
    const [{ equipes, resultados }, nomes] = await Promise.all([repo.dadosDoTorneio(req.params.id), repo.nomes()]);
    res.json(classificar(equipes, resultados, nomes, new Map(), CRITERIOS_TORNEIO));
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "erro interno" });
  }
});

router.get("/geral", async (_req, res) => {
  try {
    const [{ equipes, resultados, titulos }, nomes] = await Promise.all([repo.dadosGerais(), repo.nomes()]);
    res.json(classificar(equipes, resultados, nomes, titulos, CRITERIOS_GERAL));
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "erro interno" });
  }
});
