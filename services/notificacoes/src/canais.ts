import { randomUUID } from "node:crypto";
import { pool } from "./db";

/**
 * Um aviso pertence SEMPRE a um destinatário (`usuarioId`). Quem publica o evento
 * informa os destinatários e os nomes legíveis; este serviço só formata e entrega.
 */
export interface Aviso {
  tipo: string;
  titulo: string;
  mensagem: string;
  usuarioId: string | null;
  eventoId: string | null;
  pedidoId: string | null;
  ingressoId: string | null;
  dados: Record<string, unknown>;
  email?: string | null;
  /** Momento em que o evento ocorreu (occurredAt), usado para ordenar o feed. */
  ocorridoEm?: string | null;
}

/** Interface única que o resto do serviço conhece (alvo do Adapter). */
export interface CanalNotificacao {
  readonly nome: string;
  suporta(aviso: Aviso): boolean;
  enviar(aviso: Aviso): Promise<void>;
}

/** Canal "tela": registra o aviso no banco para o front exibir. */
export class CanalTela implements CanalNotificacao {
  readonly nome = "tela";
  suporta() { return true; }
  async enviar(a: Aviso) {
    await pool.query(
      `INSERT INTO notificacoes (id, tipo, titulo, mensagem, usuario_id, evento_id, pedido_id, ingresso_id, dados, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, now()))`,
      [randomUUID(), a.tipo, a.titulo, a.mensagem, a.usuarioId, a.eventoId, a.pedidoId, a.ingressoId,
       JSON.stringify(a.dados), a.ocorridoEm ?? null]
    );
  }
}

/** Serviço de e-mail "de terceiros" (simulado), com interface diferente da nossa. */
class ClienteEmailExterno {
  enviarMensagem(destino: string, assunto: string, corpoHtml: string): void {
    console.log(`[email simulado] para=${destino} assunto="${assunto}" corpo=${corpoHtml}`);
  }
}

const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/**
 * Padrão GoF: ADAPTER.
 * Adapta ClienteEmailExterno.enviarMensagem(destino, assunto, corpoHtml)
 * à nossa interface CanalNotificacao.enviar(aviso).
 */
export class CanalEmailAdapter implements CanalNotificacao {
  readonly nome = "email";
  constructor(private readonly cliente: ClienteEmailExterno = new ClienteEmailExterno()) {}
  suporta(a: Aviso) { return !!a.email; }
  async enviar(a: Aviso) {
    this.cliente.enviarMensagem(a.email!, a.titulo, `<p>${escapar(a.mensagem)}</p>`);
  }
}

export class Notificador {
  constructor(private readonly canais: CanalNotificacao[]) {}

  async notificar(aviso: Aviso): Promise<void> {
    for (const canal of this.canais) {
      if (!canal.suporta(aviso)) continue;
      try {
        await canal.enviar(aviso);
      } catch (e) {
        if (canal.nome === "tela") throw e; // sem registro na tela, o evento é reprocessado
        console.error(`[notificacoes] canal ${canal.nome} falhou`, e);
      }
    }
  }
}
