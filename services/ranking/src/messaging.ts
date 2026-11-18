import amqp from "amqplib";
import { randomUUID } from "node:crypto";
import { SERVICE_NAME } from "./config";

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
type Channel = Awaited<
  ReturnType<Awaited<ReturnType<typeof amqp.connect>>["createChannel"]>
>;
let channel: Channel | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function connectBroker(url: string, retries = 30): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      const conn = await amqp.connect(url);
      channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, "topic", { durable: true });
      console.log(`[${SERVICE_NAME}] conectado ao RabbitMQ`);
      return;
    } catch {
      console.log(`[${SERVICE_NAME}] aguardando RabbitMQ (${i}/${retries})...`);
      await sleep(2000);
    }
  }
  throw new Error("RabbitMQ indisponível");
}

export function publishEvent<T>(
  name: string,
  version: number,
  payload: T,
  correlationId: string = randomUUID()
): void {
  if (!channel) throw new Error("Broker não conectado");
  const envelope: EventEnvelope<T> = {
    eventId: randomUUID(),
    type: name,
    version,
    occurredAt: new Date().toISOString(),
    correlationId,
    producer: SERVICE_NAME,
    payload,
  };
  channel.publish(
    EXCHANGE,
    `${name}.v${version}`,
    Buffer.from(JSON.stringify(envelope)),
    { persistent: true, contentType: "application/json" }
  );
}

export async function subscribe(
  keys: string[],
  handler: (e: EventEnvelope) => Promise<void>
): Promise<void> {
  if (!channel || keys.length === 0) return;
  const queue = `${SERVICE_NAME}.events`;
  await channel.assertQueue(queue, { durable: true });
  for (const key of keys) await channel.bindQueue(queue, EXCHANGE, key);
  await channel.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      await handler(JSON.parse(msg.content.toString()) as EventEnvelope);
      channel!.ack(msg);
    } catch (err) {
      console.error(`[${SERVICE_NAME}] falha ao tratar evento`, err);
      channel!.nack(msg, false, false);
    }
  });
}
