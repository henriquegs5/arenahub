import amqp from "amqplib";
import { randomUUID } from "node:crypto";
import { SERVICE_NAME } from "./config";

/**
 * Mensageria do serviço. Arquivo DUPLICADO de propósito em cada serviço:
 * não existe biblioteca de domínio compartilhada — o contrato comum é o JSON Schema.
 *
 * Garantias:
 *  - publicação durável no exchange topic `arenahub.events`;
 *  - consumo com retentativa e, no esgotamento, DEAD LETTER (`<servico>.events.dlq`),
 *    para que uma mensagem com falha permanente NUNCA desapareça em silêncio;
 *  - reconexão automática ao broker, reassinando as mesmas routing keys.
 */

// Envelope padrão de todos os eventos (ver contracts/README.md).
export interface EventEnvelope<T = unknown> {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  payload: T;
}

export const EXCHANGE = "arenahub.events";
export const EXCHANGE_DLX = "arenahub.events.dlx";
export const FILA = `${SERVICE_NAME}.events`;
export const FILA_DLQ = `${SERVICE_NAME}.events.dlq`;

const TENTATIVAS = Number(process.env.EVENTO_TENTATIVAS ?? 3);
const ESPERA_MS = Number(process.env.EVENTO_ESPERA_MS ?? 500);

/**
 * Falha que NÃO adianta repetir (contrato violado, regra impossível).
 * Vai direto para a dead letter, sem gastar retentativas.
 */
export class ErroPermanente extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroPermanente";
  }
}

type Conexao = Awaited<ReturnType<typeof amqp.connect>>;
type Channel = Awaited<ReturnType<Conexao["createChannel"]>>;

let conexao: Conexao | undefined;
let channel: Channel | undefined;
let url = "";
let assinatura: { keys: string[]; handler: (e: EventEnvelope) => Promise<void> } | undefined;
let reconectando = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(`[${SERVICE_NAME}]`, ...a);

async function abrir(): Promise<void> {
  conexao = await amqp.connect(url);
  channel = await conexao.createChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(EXCHANGE_DLX, "direct", { durable: true });
  await channel.assertQueue(FILA_DLQ, { durable: true });
  await channel.bindQueue(FILA_DLQ, EXCHANGE_DLX, SERVICE_NAME);

  conexao.on("error", () => { /* o tratamento acontece no evento close */ });
  conexao.on("close", () => {
    if (reconectando) return;
    channel = undefined;
    log("conexão com o RabbitMQ caiu; reconectando...");
    void reconectar();
  });
}

async function reconectar(): Promise<void> {
  reconectando = true;
  for (;;) {
    try {
      await abrir();
      if (assinatura) await consumir(assinatura.keys, assinatura.handler);
      log("reconectado ao RabbitMQ");
      reconectando = false;
      return;
    } catch {
      await sleep(2000);
    }
  }
}

export async function connectBroker(endereco: string, retries = 30): Promise<void> {
  url = endereco;
  for (let i = 1; i <= retries; i++) {
    try {
      await abrir();
      log("conectado ao RabbitMQ");
      return;
    } catch {
      log(`aguardando RabbitMQ (${i}/${retries})...`);
      await sleep(2000);
    }
  }
  throw new Error("RabbitMQ indisponível");
}

export const brokerOk = (): boolean => channel !== undefined;

/**
 * Publicação direta no broker. O caminho normal é a OUTBOX (ver outbox.ts), que grava
 * o evento na mesma transação do fato e só depois o entrega ao broker.
 */
export function publicarEnvelope(envelope: EventEnvelope): boolean {
  if (!channel) return false;
  return channel.publish(
    EXCHANGE,
    `${envelope.type}.v${envelope.version}`,
    Buffer.from(JSON.stringify(envelope)),
    {
      persistent: true,
      contentType: "application/json",
      messageId: envelope.eventId,
      correlationId: envelope.correlationId,
    }
  );
}

export function montarEnvelope<T>(name: string, version: number, payload: T, correlationId: string = randomUUID()): EventEnvelope<T> {
  return {
    eventId: randomUUID(),
    type: name,
    version,
    occurredAt: new Date().toISOString(),
    correlationId,
    producer: SERVICE_NAME,
    payload,
  };
}

/** Publicação imediata, sem outbox. */
export function publishEvent<T>(name: string, version: number, payload: T, correlationId?: string): boolean {
  return publicarEnvelope(montarEnvelope(name, version, payload, correlationId));
}

/** Declara a fila do serviço; se já existir com argumentos antigos, recria. */
async function declararFila(): Promise<void> {
  const args = {
    durable: true as const,
    arguments: { "x-dead-letter-exchange": EXCHANGE_DLX, "x-dead-letter-routing-key": SERVICE_NAME },
  };
  try {
    await channel!.assertQueue(FILA, args);
  } catch {
    // Fila criada por uma versão anterior, sem dead letter: recria (ambiente de desenvolvimento).
    log(`fila ${FILA} existia com outra configuração; recriando com dead letter`);
    await abrir();
    await channel!.deleteQueue(FILA);
    await channel!.assertQueue(FILA, args);
  }
}

async function consumir(keys: string[], handler: (e: EventEnvelope) => Promise<void>): Promise<void> {
  if (!channel || keys.length === 0) return;
  await declararFila();
  for (const key of keys) await channel.bindQueue(FILA, EXCHANGE, key);
  await channel.prefetch(8);
  await channel.consume(FILA, async (msg) => {
    if (!msg || !channel) return;
    const ch = channel;
    let evento: EventEnvelope;
    try {
      evento = JSON.parse(msg.content.toString()) as EventEnvelope;
    } catch (err) {
      console.error(`[${SERVICE_NAME}] mensagem ilegível enviada para a dead letter`, err);
      return void ch.nack(msg, false, false);
    }

    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      try {
        await handler(evento);
        return void ch.ack(msg);
      } catch (err) {
        const permanente = err instanceof ErroPermanente || (err as Error)?.name === "ErroPermanente";
        const ultima = tentativa === TENTATIVAS;
        console.error(
          `[${SERVICE_NAME}] falha ao tratar ${evento.type}.v${evento.version} ` +
            `(tentativa ${tentativa}/${TENTATIVAS}${permanente ? ", erro permanente" : ""}) corr=${evento.correlationId}`,
          err
        );
        if (permanente || ultima) {
          console.error(`[${SERVICE_NAME}] evento ${evento.eventId} enviado para ${FILA_DLQ}`);
          return void ch.nack(msg, false, false);
        }
        await sleep(ESPERA_MS * tentativa);
      }
    }
  });
}

export async function subscribe(keys: string[], handler: (e: EventEnvelope) => Promise<void>): Promise<void> {
  assinatura = { keys, handler };
  await consumir(keys, handler);
}

// ---------- inspeção e reprocessamento da dead letter (administração) ----------

export interface ItemDLQ {
  eventId: string; type: string; version: number; occurredAt: string;
  correlationId: string; producer: string; payload: unknown;
}

/** Lê as mensagens paradas na dead letter SEM removê-las. */
export async function listarDLQ(limite = 50): Promise<ItemDLQ[]> {
  if (!conexao) return [];
  const ch = await conexao.createChannel();
  const itens: ItemDLQ[] = [];
  try {
    for (let i = 0; i < limite; i++) {
      const msg = await ch.get(FILA_DLQ, { noAck: false });
      if (!msg) break;
      try {
        itens.push(JSON.parse(msg.content.toString()) as ItemDLQ);
      } catch {
        itens.push({
          eventId: "?", type: "ilegível", version: 0, occurredAt: "",
          correlationId: "", producer: "?", payload: msg.content.toString().slice(0, 500),
        });
      }
      ch.nack(msg, false, true); // devolve à fila: inspecionar não consome
    }
  } finally {
    await ch.close().catch(() => undefined);
  }
  return itens;
}

/**
 * Devolve as mensagens da dead letter a fila DESTE servico para nova tentativa.
 *
 * Vai direto para a fila (default exchange + nome da fila) e NAO de volta ao
 * exchange `arenahub.events`, por dois motivos:
 *  - uma mensagem morta carrega a routing key da dead letter (o nome do servico),
 *    nao a original, e nenhuma fila esta ligada a essa chave: republicar no
 *    exchange a perderia em silencio;
 *  - o exchange espalharia a mensagem para TODOS os servicos interessados, mas so
 *    este falhou em trata-la.
 */
export async function reprocessarDLQ(limite = 50): Promise<number> {
  if (!conexao || !channel) return 0;
  const ch = await conexao.createChannel();
  let n = 0;
  try {
    for (let i = 0; i < limite; i++) {
      const msg = await ch.get(FILA_DLQ, { noAck: false });
      if (!msg) break;
      const ok = channel.sendToQueue(FILA, msg.content, {
        persistent: true,
        contentType: "application/json",
      });
      if (ok) { ch.ack(msg); n++; } else { ch.nack(msg, false, true); break; }
    }
  } finally {
    await ch.close().catch(() => undefined);
  }
  return n;
}

/** Descarta de vez as mensagens da dead letter (decisao do administrador). */
export async function descartarDLQ(limite = 500): Promise<number> {
  if (!conexao) return 0;
  const ch = await conexao.createChannel();
  let n = 0;
  try {
    for (let i = 0; i < limite; i++) {
      const msg = await ch.get(FILA_DLQ, { noAck: false });
      if (!msg) break;
      ch.ack(msg);
      n++;
    }
  } finally {
    await ch.close().catch(() => undefined);
  }
  return n;
}

/** Quantas mensagens estao paradas na dead letter. */
export async function contarDLQ(): Promise<number> {
  if (!conexao) return -1;
  const ch = await conexao.createChannel();
  try {
    return (await ch.checkQueue(FILA_DLQ)).messageCount;
  } catch {
    return -1;
  } finally {
    await ch.close().catch(() => undefined);
  }
}
