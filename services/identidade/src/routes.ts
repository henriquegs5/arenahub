import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_EXPIRES_IN, JWT_SECRET } from "./config";
import { publishEvent } from "./messaging";
import * as usuarios from "./usuarios";
import { Papel } from "./usuarios";

export const router = Router();

const PAPEIS: Papel[] = ["JOGADOR", "ORGANIZADOR"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publico = (u: usuarios.Usuario) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel });
const erro = (res: Response, status: number, mensagem: string) => res.status(status).json({ erro: mensagem });

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { nome, email, senha, papel } = req.body ?? {};
    if (typeof nome !== "string" || nome.trim().length < 2) return erro(res, 400, "nome inválido");
    if (typeof email !== "string" || !EMAIL_RE.test(email)) return erro(res, 400, "email inválido");
    if (typeof senha !== "string" || senha.length < 6) return erro(res, 400, "senha deve ter ao menos 6 caracteres");
    if (!PAPEIS.includes(papel)) return erro(res, 400, "papel deve ser JOGADOR ou ORGANIZADOR");

    const emailNorm = email.trim().toLowerCase();
    if (await usuarios.porEmail(emailNorm)) return erro(res, 409, "email já cadastrado");

    const u = await usuarios.criar(nome.trim(), emailNorm, papel, await bcrypt.hash(senha, 10));
    publishEvent(
      "usuario.registrado", 1,
      { usuarioId: u.id, nome: u.nome, email: u.email, papel: u.papel },
      res.locals.correlationId
    );
    res.status(201).json(publico(u));
  } catch (e) {
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

// O Gateway valida o JWT e injeta x-user-id; o serviço confia nesse cabeçalho (porta não exposta fora do Docker).
router.get("/me", async (req: Request, res: Response) => {
  try {
    const id = req.headers["x-user-id"];
    if (typeof id !== "string") return erro(res, 401, "não autenticado");
    const u = await usuarios.porId(id);
    if (!u) return erro(res, 404, "usuário não encontrado");
    res.json(publico(u));
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

router.get("/usuarios", async (_req: Request, res: Response) => {
  try {
    res.json(await usuarios.listarPublico());
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});
