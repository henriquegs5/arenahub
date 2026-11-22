import asyncio
import json
import uuid
from typing import Any, Callable, Dict, Optional
import aio_pika
from aio_pika import ExchangeType, Message
from aio_pika.abc import AbstractRobustConnection, AbstractRobustChannel
from .config import SERVICE_NAME, EVENTO_TENTATIVAS, EVENTO_ESPERA_S

"""
Padrão GoF: SINGLETON para a conexão de mensageria com RabbitMQ.
Conexão resiliente com Dead Letter Queue (DLQ) para garantir que
nenhuma mensagem falha se perca.
"""

EXCHANGE = "arenahub.events"
EXCHANGE_DLX = "arenahub.events.dlx"
FILA = f"{SERVICE_NAME}.events"
FILA_DLQ = f"{SERVICE_NAME}.events.dlq"

class ErroPermanente(Exception):
    pass

_connection: Optional[AbstractRobustConnection] = None
_channel: Optional[AbstractRobustChannel] = None

def broker_ok() -> bool:
    return _channel is not None and not _channel.is_closed

async def connect_broker(url: str, retries: int = 30) -> None:
    global _connection, _channel
    for i in range(1, retries + 1):
        try:
            _connection = await aio_pika.connect_robust(url)
            _channel = await _connection.channel()
            # Declara exchanges
            exchange = await _channel.declare_exchange(EXCHANGE, ExchangeType.TOPIC, durable=True)
            dlx = await _channel.declare_exchange(EXCHANGE_DLX, ExchangeType.DIRECT, durable=True)
            # Declara DLQ e faz bind
            dlq = await _channel.declare_queue(FILA_DLQ, durable=True)
            await dlq.bind(dlx, routing_key=SERVICE_NAME)
            print(f"[{SERVICE_NAME}] conectado ao RabbitMQ")
            return
        except Exception as e:
            print(f"[{SERVICE_NAME}] aguardando RabbitMQ ({i}/{retries})...")
            await asyncio.sleep(2)
    raise RuntimeError("RabbitMQ indisponível")

async def close_broker() -> None:
    global _connection, _channel
    if _channel and not _channel.is_closed:
        await _channel.close()
    if _connection and not _connection.is_closed:
        await _connection.close()
    _channel = None
    _connection = None

async def subscribe(keys: list[str], handler: Callable[[Dict[str, Any]], Any]) -> None:
    if not _channel or not keys:
        return
    exchange = await _channel.get_exchange(EXCHANGE)
    dlx = await _channel.get_exchange(EXCHANGE_DLX)

    # Configuração de fila com Dead Letter
    queue_args = {
        "x-dead-letter-exchange": EXCHANGE_DLX,
        "x-dead-letter-routing-key": SERVICE_NAME
    }

    try:
        queue = await _channel.declare_queue(FILA, durable=True, arguments=queue_args)
    except Exception:
        # Se argumentos diferirem, recria
        queue = await _channel.declare_queue(FILA, durable=True, passive=True)
        await queue.delete()
        queue = await _channel.declare_queue(FILA, durable=True, arguments=queue_args)

    for k in keys:
        await queue.bind(exchange, routing_key=k)

    await _channel.set_qos(prefetch_count=8)

    async def on_message(message: aio_pika.abc.AbstractIncomingMessage):
        async with message.process(requeue=False, ignore_processed=True):
            try:
                data = json.loads(message.body.decode())
            except Exception:
                # Ilegível vai direto para dead-letter
                await dlx.publish(
                    Message(body=message.body, headers={"x-error": "mensagem ilegivel"}),
                    routing_key=SERVICE_NAME
                )
                await message.ack()
                return

            sucesso = False
            for tentativa in range(1, EVENTO_TENTATIVAS + 1):
                try:
                    await handler(data)
                    await message.ack()
                    sucesso = True
                    break
                except ErroPermanente as ep:
                    print(f"[{SERVICE_NAME}] Erro permanente no evento {data.get('type')}: {ep}")
                    break
                except Exception as err:
                    print(f"[{SERVICE_NAME}] Falha ({tentativa}/{EVENTO_TENTATIVAS}) ao tratar {data.get('type')}: {err}")
                    if tentativa < EVENTO_TENTATIVAS:
                        await asyncio.sleep(EVENTO_ESPERA_S * tentativa)

            if not sucesso:
                # Esgotou tentativas ou erro permanente -> Envia para DLQ
                print(f"[{SERVICE_NAME}] Enviando evento {data.get('eventId')} para DLQ {FILA_DLQ}")
                await dlx.publish(
                    Message(body=message.body, headers={"x-death-reason": "max_retries"}),
                    routing_key=SERVICE_NAME
                )
                await message.ack()

    await queue.consume(on_message)

async def listar_dlq(limite: int = 50) -> list[Dict[str, Any]]:
    if not _connection:
        return []
    ch = await _connection.channel()
    itens = []
    try:
        queue = await ch.declare_queue(FILA_DLQ, durable=True)
        # Modo inspeção sem consumir: lê as mensagens da fila
        for _ in range(limite):
            msg = await queue.get(no_ack=False, fail=False)
            if not msg:
                break
            try:
                data = json.loads(msg.body.decode())
                itens.append(data)
            except Exception:
                itens.append({"eventId": "?", "payload": msg.body.decode()[:500]})
            # Rejeita com requeue=True para manter na fila DLQ
            await msg.nack(requeue=True)
    finally:
        await ch.close()
    return itens

async def reprocessar_dlq(limite: int = 50) -> int:
    if not _connection or not _channel:
        return 0
    ch = await _connection.channel()
    total = 0
    try:
        dlq = await ch.declare_queue(FILA_DLQ, durable=True)
        target_queue = await ch.declare_queue(FILA, durable=True, arguments={
            "x-dead-letter-exchange": EXCHANGE_DLX,
            "x-dead-letter-routing-key": SERVICE_NAME
        })
        for _ in range(limite):
            msg = await dlq.get(no_ack=False, fail=False)
            if not msg:
                break
            # Publica diretamente na fila normal do serviço
            await ch.default_exchange.publish(
                Message(body=msg.body),
                routing_key=FILA
            )
            await msg.ack()
            total += 1
    finally:
        await ch.close()
    return total

async def descartar_dlq() -> int:
    if not _connection:
        return 0
    ch = await _connection.channel()
    try:
        dlq = await ch.declare_queue(FILA_DLQ, durable=True)
        purged = await dlq.purge()
        return purged
    finally:
        await ch.close()
