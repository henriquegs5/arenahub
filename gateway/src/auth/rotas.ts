import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_EXPIRES_IN, JWT_SECRET } from "../config";
import { contarDLQ, descartarDLQ, listarDLQ, reprocessarDLQ } from "../messaging";
import { transacao, transacaoCom } from "../outbox";
import * as usuarios from "./usuarios";
import { Papel, PAPEIS, PAPEIS_PUBLICOS } from "./usuarios";

/**
 * DECISÃO DE ARQUITETURA — a autenticação vive DENTRO do Gateway.
 *
 * O enunciado exige EXATAMENTE QUATRO microsserviços de domínio: eventos,
 * ingressos, pagamento e notificações. Autenticação não é um deles, e um quinto
 * serviço só para isso descumpriria o enunciado.
 *
 * O Gateway já é o componente de infraestrutura que VALIDA o JWT em toda
 * requisição (padrões arquiteturais API Gateway + GoF Facade e Proxy). Emitir o
 * token é a outra metade dessa mesma responsabilidade, então as contas vivem
 * aqui, no banco próprio do Gateway (gateway_db), que nenhum serviço de domínio
 * acessa.
 *
 * Isto NÃO transforma o Gateway num serviço de domínio: ele não conhece evento,
 * ingresso nem pagamento. Os serviços continuam sabendo apenas o ID do usuário,
 * recebido nos cabeçalhos x-user-id e x-user-role, mais as cópias de nome que
 * chegam pelos eventos usuario.*. Ver README.md, "Decisões de arquitetura".
 */
export const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const erro = (res: Response, status: number, mensagem: string) => res.status(status).json({ erro: mensagem });
const publico = (u: usuarios.Usuario) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel });

/** Identidade de quem chama, já validada pelo middleware de autenticação. */
interface Autor { id: string; papel: Papel }

function quem(req: Request): Autor | null {
  const id = req.headers["x-user-id"];
  const papel = req.headers["x-user-role"];
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  if (!PAPEIS.includes(papel as Papel)) return null;
  return { id, papel: papel as Papel };
}

function exigir(req: Request, res: Response): Autor | null {
  const a = quem(req);
  if (!a) { erro(res, 401, "não autenticado"); return null; }
  return a;
}

function exigirAdm(req: Request, res: Response): Autor | null {
  const a = exigir(req, res);
  if (!a) return null;
  if (a.papel !== "ADM") { erro(res, 403, "ação restrita ao administrador"); return null; }
  return a;
}

const donoOuAdm = (a: Autor | null, donoId: string) => !!a && (a.id === donoId || a.papel === "ADM");

// ---------- cadastro e login (rotas públicas) ----------
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { nome, email, senha, papel } = req.body ?? {};
    if (typeof nome !== "string" || nome.trim().length < 2) return erro(res, 400, "nome inválido");
    if (typeof email !== "string" || !EMAIL_RE.test(email)) return erro(res, 400, "email inválido");
    if (typeof senha !== "string" || senha.length < 6) return erro(res, 400, "senha deve ter ao menos 6 caracteres");
    // O cadastro público nunca cria administrador.
    if (!PAPEIS_PUBLICOS.includes(papel)) return erro(res, 400, "papel deve ser PARTICIPANTE ou ORGANIZADOR");

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
          // Quem publica informa os destinatários e os nomes legíveis: o serviço de
          // Notificações não consulta ninguém para descobrir a quem avisar.
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

// ---------- conta do usuário ----------
router.get("/me", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const u = await usuarios.porId(a.id);
    if (!u) return erro(res, 404, "usuário não encontrado");
    res.json(publico(u));
  } catch (e) { console.error(e); erro(res, 500, "erro interno"); }
});

/**
 * Catálogo de usuários. Qualquer autenticado vê apenas {id, nome} — o mínimo de
 * que a interface precisa para mostrar nomes em vez de IDs. O ADM vê tudo.
 */
router.get("/usuarios", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    if (a.papel === "ADM") return void res.json(await usuarios.listarCompleto());
    const filtro = typeof req.query.ids === "string"
      ? req.query.ids.split(",").filter((x) => UUID_RE.test(x))
      : undefined;
    res.json(await usuarios.listarNomes(filtro));
  } catch (e) { console.error(e); erro(res, 500, "erro interno"); }
});

router.get("/usuarios/:id", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
    const u = await usuarios.porId(req.params.id);
    if (!u) return erro(res, 404, "usuário não encontrado");
    res.json(donoOuAdm(a, u.id) ? publico(u) : { id: u.id, nome: u.nome });
  } catch (e) { console.error(e); erro(res, 500, "erro interno"); }
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
    if (!PAPEIS.includes(papel)) return erro(res, 400, "papel inválido");
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
 * Publica usuario.removido para que Eventos, Ingressos e Pagamento compensem
 * (ingressos do titular, eventos do organizador) — tratado no lote 5.
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
        payload: { usuarioId: alvo.id, nome: alvo.nome, papel: alvo.papel, removidoPor: a.id, destinatarios: [] },
      }];
    });

    res.json({ removido: alvo.id });
  } catch (e) { console.error(e); erro(res, 500, "erro interno"); }
});

// ---------- administração da dead letter do próprio Gateway ----------
router.get("/dlq", async (req, res) => {
  if (!exigirAdm(req, res)) return;
  try { res.json({ total: await contarDLQ(), mensagens: await listarDLQ(50) }); }
  catch (e) { console.error(e); erro(res, 500, "erro interno"); }
});

router.post("/dlq/reprocessar", async (req, res) => {
  if (!exigirAdm(req, res)) return;
  try { res.json({ reprocessadas: await reprocessarDLQ(50) }); }
  catch (e) { console.error(e); erro(res, 500, "erro interno"); }
});

router.delete("/dlq", async (req, res) => {
  if (!exigirAdm(req, res)) return;
  try { res.json({ descartadas: await descartarDLQ() }); }
  catch (e) { console.error(e); erro(res, 500, "erro interno"); }
});
