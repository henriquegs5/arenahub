import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_EXPIRES_IN, JWT_SECRET } from "./config";
import { listarDLQ, reprocessarDLQ } from "./messaging";
import { transacao, transacaoCom } from "./outbox";
import * as usuarios from "./usuarios";
import { Papel } from "./usuarios";
import { donoOuAdm, erro, exigir, exigirAdm, UUID_RE } from "./auth";

export const router = Router();

const PAPEIS_PUBLICOS: Papel[] = ["JOGADOR", "ORGANIZADOR"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publico = (u: usuarios.Usuario) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel });

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { nome, email, senha, papel } = req.body ?? {};
    if (typeof nome !== "string" || nome.trim().length < 2) return erro(res, 400, "nome inválido");
    if (typeof email !== "string" || !EMAIL_RE.test(email)) return erro(res, 400, "email inválido");
    if (typeof senha !== "string" || senha.length < 6) return erro(res, 400, "senha deve ter ao menos 6 caracteres");
    // O cadastro público nunca cria administrador.
    if (!PAPEIS_PUBLICOS.includes(papel)) return erro(res, 400, "papel deve ser JOGADOR ou ORGANIZADOR");

    const emailNorm = email.trim().toLowerCase();
    if (await usuarios.porEmail(emailNorm)) return erro(res, 409, "email já cadastrado");

    const senhaHash = await bcrypt.hash(senha, 10);
    const criado = await transacaoCom(async (c) => {
      const u = await usuarios.criar(c, nome.trim(), emailNorm, papel, senhaHash);
      return {
        valor: u,
        eventos: [{
          nome: "usuario.registrado",
          correlationId: res.locals.correlationId,
          payload: { usuarioId: u.id, nome: u.nome, email: u.email, papel: u.papel, destinatarios: [u.id] },
        }],
      };
    });

    res.status(201).json(publico(criado));
  } catch (e: any) {
    if (e?.code === "23505") return erro(res, 409, "email já cadastrado");
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, senha } = req.body ?? {};
    if (typeof email !== "string" || typeof senha !== "string") return erro(res, 400, "email e senha são obrigatórios");

    const u = await usuarios.porEmail(email.trim().toLowerCase());
    if (!u || !(await bcrypt.compare(senha, u.senhaHash))) return erro(res, 401, "credenciais inválidas");

    const token = jwt.sign({ sub: u.id, papel: u.papel, nome: u.nome }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });
    res.json({ token, usuario: publico(u) });
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

// O Gateway valida o JWT e injeta x-user-id; o serviço confia nesse cabeçalho
// (a porta não é exposta fora da rede do Docker).
router.get("/me", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const u = await usuarios.porId(a.id);
    if (!u) return erro(res, 404, "usuário não encontrado");
    res.json(publico(u));
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

// ---------- administração da dead letter ----------
router.get("/dlq", async (req, res) => {
  if (!exigirAdm(req, res)) return;
  try { res.json(await listarDLQ(50)); }
  catch (e) { console.error(e); erro(res, 500, "erro interno"); }
});

router.post("/dlq/reprocessar", async (req, res) => {
  if (!exigirAdm(req, res)) return;
  try { res.json({ reprocessadas: await reprocessarDLQ(50) }); }
  catch (e) { console.error(e); erro(res, 500, "erro interno"); }
});

/**
 * Catálogo de usuários. Qualquer autenticado vê apenas `{id, nome}` — o mínimo de
 * que a interface precisa para mostrar nomes em vez de IDs. O administrador vê a
 * lista completa (e-mail, papel, data de criação).
 */
router.get("/usuarios", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    if (a.papel === "ADM") return void res.json(await usuarios.listarCompleto());

    const filtro = typeof req.query.ids === "string" ? req.query.ids.split(",").filter((x) => UUID_RE.test(x)) : undefined;
    res.json(await usuarios.listarNomes(filtro));
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

router.get("/usuarios/:id", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
    const u = await usuarios.porId(req.params.id);
    if (!u) return erro(res, 404, "usuário não encontrado");
    res.json(donoOuAdm(a, u.id) ? publico(u) : { id: u.id, nome: u.nome });
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

/** Edição de perfil: o próprio usuário (nome e senha) ou o ADM (também o papel). */
async function editar(req: Request, res: Response, alvoId: string) {
  const a = exigir(req, res); if (!a) return;
  if (!donoOuAdm(a, alvoId)) return erro(res, 403, "você só pode editar a sua própria conta");

  const { nome, senha, senhaAtual, papel } = req.body ?? {};
  const campos: { nome?: string; senhaHash?: string; papel?: Papel } = {};

  if (nome !== undefined) {
    if (typeof nome !== "string" || nome.trim().length < 2) return erro(res, 400, "nome inválido");
    campos.nome = nome.trim();
  }

  const alvo = await usuarios.porId(alvoId);
  if (!alvo) return erro(res, 404, "usuário não encontrado");

  if (senha !== undefined) {
    if (typeof senha !== "string" || senha.length < 6) return erro(res, 400, "senha deve ter ao menos 6 caracteres");
    // Trocando a própria senha, é preciso confirmar a atual. O ADM redefine sem ela.
    if (a.papel !== "ADM") {
      if (typeof senhaAtual !== "string" || !(await bcrypt.compare(senhaAtual, alvo.senhaHash)))
        return erro(res, 403, "senha atual incorreta");
    }
    campos.senhaHash = await bcrypt.hash(senha, 10);
  }

  if (papel !== undefined) {
    if (a.papel !== "ADM") return erro(res, 403, "somente o administrador altera papéis");
    if (!["JOGADOR", "ORGANIZADOR", "ADM"].includes(papel)) return erro(res, 400, "papel inválido");
    if (alvo.papel === "ADM" && papel !== "ADM" && (await usuarios.contarAdms()) <= 1)
      return erro(res, 409, "não é possível rebaixar o último administrador");
    campos.papel = papel as Papel;
  }

  if (Object.keys(campos).length === 0) return erro(res, 400, "nada para alterar");

  await transacao(async (c) => {
    await usuarios.atualizar(c, alvoId, campos);
    return [{
      nome: "usuario.atualizado",
      correlationId: res.locals.correlationId,
      payload: {
        usuarioId: alvoId,
        nome: campos.nome ?? alvo.nome,
        papel: campos.papel ?? alvo.papel,
        destinatarios: [alvoId],
      },
    }];
  });

  const atualizado = await usuarios.porId(alvoId);
  res.json(publico(atualizado!));
}

router.patch("/me", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    await editar(req, res, a.id);
  } catch (e) { console.error(e); if (!res.headersSent) erro(res, 500, "erro interno"); }
});

router.patch("/usuarios/:id", async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
    await editar(req, res, req.params.id);
  } catch (e) { console.error(e); if (!res.headersSent) erro(res, 500, "erro interno"); }
});

/**
 * Exclusão de conta: o próprio usuário ou o ADM.
 * Publica `usuario.removido` para que Equipes e Torneios compensem (lote 5).
 */
router.delete("/usuarios/:id", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
    if (!donoOuAdm(a, req.params.id)) return erro(res, 403, "você só pode excluir a sua própria conta");

    const alvo = await usuarios.porId(req.params.id);
    if (!alvo) return erro(res, 404, "usuário não encontrado");
    if (alvo.papel === "ADM" && (await usuarios.contarAdms()) <= 1)
      return erro(res, 409, "não é possível excluir o último administrador");

    await transacao(async (c) => {
      await usuarios.remover(c, alvo.id);
      return [{
        nome: "usuario.removido",
        correlationId: res.locals.correlationId,
        payload: { usuarioId: alvo.id, nome: alvo.nome, removidoPor: a.id, destinatarios: [] },
      }];
    });

    res.json({ removido: alvo.id });
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});
