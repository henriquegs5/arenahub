import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional
import uuid
from fastapi import FastAPI, Request, Response, HTTPException, status, Query
from fastapi.responses import JSONResponse
import uvicorn
from pydantic import BaseModel, Field

from .config import SERVICE_NAME, PORT, DATABASE_URL, RABBITMQ_URL, SUBSCRIBES
from .db import init_db, close_db, db_ok, get_pool
from .messaging import (
    connect_broker, close_broker, broker_ok, subscribe,
    contar_dlq, listar_dlq, reprocessar_dlq, descartar_dlq
)
from .outbox import migrate_outbox, iniciar_relay, pendentes
from .repositorio import migrate, buscar_evento, listar_eventos, carregar_estrutura
from .estados import STATUS_EVENTO, StatusEvento, TransicaoInvalida
from .precos import POLITICAS_PRECO, PoliticaPreco
from .validacoes import ItemPedido
from .auth import exigir, exigir_adm, exigir_papel, quem, UUID_RE
from .servico import ErroNegocio
from . import servico
from . import saga

relay_task: Optional[asyncio.Task] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global relay_task
    await init_db()
    await migrate()
    await migrate_outbox()
    await connect_broker(RABBITMQ_URL)

    async def amqp_handler(event: Dict[str, Any]):
        etype = event.get("type")
        corr = event.get("correlationId")
        vers = event.get("version", 1)
        print(f"[{SERVICE_NAME}] evento {etype}.v{vers} corr={corr}")
        match etype:
            case "compra.solicitada":
                await saga.tratar_compra_solicitada(event)
            case "pedido.cancelado":
                await saga.tratar_pedido_cancelado(event)
            case "evento.cancelado":
                await saga.tratar_evento_cancelado(event)
            case "usuario.removido":
                await saga.tratar_usuario_removido(event)

    await subscribe(SUBSCRIBES, amqp_handler)
    relay_task = asyncio.create_task(iniciar_relay())
    yield
    if relay_task:
        relay_task.cancel()
    await close_broker()
    await close_db()

app = FastAPI(title="ArenaHub Eventos", lifespan=lifespan)

@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    request.state.correlation_id = correlation_id
    response: Response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    return response

@app.exception_handler(ErroNegocio)
async def erro_negocio_handler(request: Request, exc: ErroNegocio):
    return JSONResponse(status_code=exc.status, content={"erro": exc.mensagem})

@app.exception_handler(TransicaoInvalida)
async def transicao_invalida_handler(request: Request, exc: TransicaoInvalida):
    return JSONResponse(status_code=409, content={"erro": str(exc)})

# ================= Health =================

@app.get("/health")
async def health():
    db = await db_ok()
    outbox = await pendentes() if db else -1
    return JSONResponse(
        status_code=200 if db else 503,
        content={
            "service": SERVICE_NAME,
            "status": "ok" if db else "degraded",
            "db": db,
            "broker": broker_ok(),
            "eventosPendentes": outbox,
        }
    )

# ================= DLQ (ADM) =================

@app.get("/dlq")
async def get_dlq(request: Request):
    exigir_adm(request)
    return {"total": await contar_dlq(), "mensagens": await listar_dlq(50)}

@app.post("/dlq/reprocessar")
async def post_reprocessar_dlq(request: Request):
    exigir_adm(request)
    return {"reprocessadas": await reprocessar_dlq(50)}

@app.delete("/dlq")
async def delete_dlq(request: Request):
    exigir_adm(request)
    return {"descartadas": await descartar_dlq()}

# ================= Metadados =================

def rotulo_politica(p: PoliticaPreco) -> str:
    match p:
        case "INTEIRA": return "Inteira"
        case "MEIA": return "Meia-entrada"
        case "PROMOCIONAL": return "Promocional do lote"
        case "CORTESIA": return "Cortesia"

@app.get("/meta/politicas")
async def get_politicas(request: Request):
    exigir(request)
    return [{"valor": p, "rotulo": rotulo_politica(p)} for p in POLITICAS_PRECO]

# ================= Catálogo e Detalhes =================

@app.get("/")
async def listar(
    request: Request,
    status_filtro: Optional[str] = Query(None, alias="status"),
    busca: Optional[str] = Query(None),
    meus: Optional[str] = Query(None)
):
    a = exigir(request)
    if status_filtro and status_filtro not in STATUS_EVENTO:
        raise HTTPException(status_code=400, detail={"erro": "status inválido"})

    busca_str = busca.strip() if busca and busca.strip() else None
    so_meus = meus in ("1", "true")

    eventos = await listar_eventos(
        ver_tudo=a.papel == "ADM",
        organizador_id=a.id,
        status=status_filtro,
        busca=busca_str,
        so_do_organizador=a.id if so_meus else None
    )

    resumo = []
    for e in eventos:
        arvore = await carregar_estrutura(None, e)
        resumo.append({
            "id": e.id,
            "nome": e.nome,
            "descricao": e.descricao,
            "dataHora": e.data_hora.isoformat(),
            "local": e.local,
            "status": e.status,
            "organizadorId": e.organizador_id,
            "motivoCancelamento": e.motivo_cancelamento,
            "capacidade": arvore.capacidade(),
            "reservados": arvore.reservados(),
            "disponiveis": arvore.disponiveis(),
            "precoMinimoCentavos": arvore.preco_minimo(),
            "setores": len(arvore.filhos()),
        })
    return resumo

@app.get("/{id}")
async def obter_evento(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    e = await buscar_evento(id)
    if not e:
        raise HTTPException(status_code=404, detail={"erro": "evento não encontrado"})

    meu = e.organizador_id == a.id or a.papel == "ADM"
    if not meu and e.status == "RASCUNHO":
        raise HTTPException(status_code=404, detail={"erro": "evento não encontrado"})

    arvore = await carregar_estrutura(None, e)
    return servico.detalhar(e, arvore)

@app.get("/{id}/disponibilidade")
async def obter_disponibilidade(id: str, request: Request):
    exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    e = await buscar_evento(id)
    if not e:
        raise HTTPException(status_code=404, detail={"erro": "evento não encontrado"})

    arvore = await carregar_estrutura(None, e)
    return {
        "eventoId": e.id,
        "capacidade": arvore.capacidade(),
        "reservados": arvore.reservados(),
        "disponiveis": arvore.disponiveis(),
        "setores": [
            {
                "id": s.id,
                "nome": s.nome,
                "capacidade": s.capacidade(),
                "reservados": s.reservados(),
                "disponiveis": s.disponiveis(),
                "lotes": [
                    {
                        "id": l.id,
                        "nome": l.nome,
                        "capacidade": l.capacidade(),
                        "reservados": l.reservados(),
                        "disponiveis": l.disponiveis(),
                        "vigente": l.vigente(),
                    }
                    for l in s.filhos()
                ],
            }
            for s in arvore.filhos()
        ],
    }

# ================= CRUD Evento =================

def validar_dados_evento(corpo: dict, obrigatorio: bool) -> tuple[dict, list[dict]]:
    p: list[dict] = []
    dados: dict = {}

    if "nome" in corpo or obrigatorio:
        val = corpo.get("nome")
        if not isinstance(val, str) or len(val.strip()) < 3:
            p.append({"campo": "nome", "mensagem": "informe um nome com ao menos 3 caracteres"})
        else:
            dados["nome"] = val.strip()

    if "local" in corpo or obrigatorio:
        val = corpo.get("local")
        if not isinstance(val, str) or len(val.strip()) < 3:
            p.append({"campo": "local", "mensagem": "informe o local do evento"})
        else:
            dados["local"] = val.strip()

    if "dataHora" in corpo or obrigatorio:
        val = corpo.get("dataHora")
        try:
            d = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
            dados["data_hora"] = d
        except Exception:
            p.append({"campo": "dataHora", "mensagem": "informe uma data e hora válidas"})

    if "descricao" in corpo:
        val = corpo.get("descricao")
        if val is not None and not isinstance(val, str):
            p.append({"campo": "descricao", "mensagem": "descrição inválida"})
        else:
            dados["descricao"] = None if val is None else str(val).strip()
    elif obrigatorio:
        dados["descricao"] = None

    return dados, p

@app.post("/", status_code=201)
async def criar_evento_endpoint(request: Request):
    a = exigir_papel(request, "ORGANIZADOR")
    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    dados, problemas = validar_dados_evento(corpo, True)
    if problemas:
        return JSONResponse(status_code=400, content={"erro": problemas[0]["mensagem"], "problemas": problemas})

    d = servico.repo.DadosEvento(
        nome=dados["nome"],
        descricao=dados["descricao"],
        data_hora=dados["data_hora"],
        local=dados["local"]
    )
    e = await servico.criar(d, a)
    arvore = await carregar_estrutura(None, e)
    return servico.detalhar(e, arvore)

@app.patch("/{id}")
async def editar_evento_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    dados, problemas = validar_dados_evento(corpo, False)
    if problemas:
        return JSONResponse(status_code=400, content={"erro": problemas[0]["mensagem"], "problemas": problemas})
    if not dados:
        raise HTTPException(status_code=400, detail={"erro": "nada para alterar"})

    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
    e = await servico.editar(id, a, dados, corr_id)
    arvore = await carregar_estrutura(None, e)
    return servico.detalhar(e, arvore)

@app.delete("/{id}")
async def excluir_evento_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    await servico.excluir(id, a)
    return {"removido": id}

# ================= Transições de Estado =================

async def responder_evento(id: str):
    e = await buscar_evento(id)
    if not e:
        raise HTTPException(status_code=404, detail={"erro": "evento não encontrado"})
    arvore = await carregar_estrutura(None, e)
    return servico.detalhar(e, arvore)

@app.post("/{id}/publicar")
async def publicar_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    await servico.publicar(id, a)
    return await responder_evento(id)

@app.post("/{id}/abrir-vendas")
async def abrir_vendas_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    await servico.abrir_vendas(id, a)
    return await responder_evento(id)

@app.post("/{id}/encerrar-vendas")
async def encerrar_vendas_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    await servico.encerrar_vendas(id, a)
    return await responder_evento(id)

@app.post("/{id}/realizar")
async def realizar_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    await servico.realizar(id, a)
    return await responder_evento(id)

@app.post("/{id}/cancelar")
async def cancelar_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    motivo = str(corpo.get("motivo", "")).strip()
    if len(motivo) < 3:
        raise HTTPException(status_code=400, detail={"erro": "informe o motivo do cancelamento"})

    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
    await servico.cancelar(id, a, motivo, corr_id)
    return await responder_evento(id)

# ================= Setores =================

@app.post("/{id}/setores", status_code=201)
async def criar_setor_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    nome = str(corpo.get("nome", "")).strip()
    if len(nome) < 2:
        raise HTTPException(status_code=400, detail={"erro": "informe um nome para o setor"})
    descricao = corpo.get("descricao")
    desc_str = str(descricao).strip() if descricao else None

    setor = await servico.criar_setor(id, a, nome, desc_str)
    return {"id": setor.id, "eventoId": setor.evento_id, "nome": setor.nome, "descricao": setor.descricao}

@app.patch("/{id}/setores/{setor_id}")
async def editar_setor_endpoint(id: str, setor_id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    if not UUID_RE.match(setor_id):
        raise HTTPException(status_code=400, detail={"erro": "setorId inválido"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    nome = str(corpo["nome"]).strip() if "nome" in corpo else None
    if nome is not None and len(nome) < 2:
        raise HTTPException(status_code=400, detail={"erro": "informe um nome para o setor"})

    descricao = None
    if "descricao" in corpo:
        descricao = None if corpo["descricao"] is None else str(corpo["descricao"]).strip()

    if nome is None and "descricao" not in corpo:
        raise HTTPException(status_code=400, detail={"erro": "nada para alterar"})

    setor = await servico.editar_setor(id, setor_id, a, nome, descricao)
    return {"id": setor.id, "eventoId": setor.evento_id, "nome": setor.nome, "descricao": setor.descricao}

@app.delete("/{id}/setores/{setor_id}")
async def excluir_setor_endpoint(id: str, setor_id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    if not UUID_RE.match(setor_id):
        raise HTTPException(status_code=400, detail={"erro": "setorId inválido"})

    await servico.excluir_setor(id, setor_id, a)
    return {"removido": setor_id}

# ================= Lotes =================

def validar_dados_lote(corpo: dict, obrigatorio: bool) -> tuple[dict, list[dict]]:
    p: list[dict] = []
    dados: dict = {}

    if "nome" in corpo or obrigatorio:
        val = corpo.get("nome")
        if not isinstance(val, str) or len(val.strip()) < 2:
            p.append({"campo": "nome", "mensagem": "informe um nome para o lote"})
        else:
            dados["nome"] = val.strip()

    if "precoCentavos" in corpo or obrigatorio:
        val = corpo.get("precoCentavos")
        if not isinstance(val, int) or val < 0:
            p.append({"campo": "precoCentavos", "mensagem": "o preço deve ser um inteiro em centavos, zero ou maior"})
        else:
            dados["preco_centavos"] = val

    if "capacidade" in corpo or obrigatorio:
        val = corpo.get("capacidade")
        if not isinstance(val, int) or val < 1 or val > 1_000_000:
            p.append({"campo": "capacidade", "mensagem": "a capacidade deve ser um inteiro entre 1 e 1000000"})
        else:
            dados["capacidade"] = val

    if "descontoPercentual" in corpo:
        val = corpo.get("descontoPercentual")
        if not isinstance(val, int) or val < 0 or val > 100:
            p.append({"campo": "descontoPercentual", "mensagem": "o desconto deve ser um inteiro de 0 a 100"})
        else:
            dados["desconto_percentual"] = val
    elif obrigatorio:
        dados["desconto_percentual"] = 0

    if "politicaPadrao" in corpo:
        val = corpo.get("politicaPadrao")
        if val not in POLITICAS_PRECO:
            p.append({"campo": "politicaPadrao", "mensagem": f"política deve ser uma de: {', '.join(POLITICAS_PRECO)}"})
        else:
            dados["politica_padrao"] = val
    elif obrigatorio:
        dados["politica_padrao"] = "INTEIRA"

    for campo in ["inicioVendas", "fimVendas"]:
        chave_db = "inicio_vendas" if campo == "inicioVendas" else "fim_vendas"
        if campo in corpo:
            val = corpo.get(campo)
            if val is None:
                dados[chave_db] = None
            else:
                try:
                    dados[chave_db] = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
                except Exception:
                    p.append({"campo": campo, "mensagem": "data inválida"})
        elif obrigatorio:
            dados[chave_db] = None

    if dados.get("inicio_vendas") and dados.get("fim_vendas") and dados["inicio_vendas"] > dados["fim_vendas"]:
        p.append({"campo": "fimVendas", "mensagem": "o fim das vendas não pode ser antes do início"})

    if "ativo" in corpo:
        val = corpo.get("ativo")
        if not isinstance(val, bool):
            p.append({"campo": "ativo", "mensagem": "ativo deve ser verdadeiro ou falso"})
        else:
            dados["ativo"] = val
    elif obrigatorio:
        dados["ativo"] = True

    return dados, p

@app.post("/{id}/setores/{setor_id}/lotes", status_code=201)
async def criar_lote_endpoint(id: str, setor_id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    if not UUID_RE.match(setor_id):
        raise HTTPException(status_code=400, detail={"erro": "setorId inválido"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    dados, problemas = validar_dados_lote(corpo, True)
    if problemas:
        return JSONResponse(status_code=400, content={"erro": problemas[0]["mensagem"], "problemas": problemas})

    d = servico.repo.DadosLote(
        nome=dados["nome"],
        preco_centavos=dados["preco_centavos"],
        desconto_percentual=dados["desconto_percentual"],
        politica_padrao=dados["politica_padrao"],
        capacidade=dados["capacidade"],
        inicio_vendas=dados.get("inicio_vendas"),
        fim_vendas=dados.get("fim_vendas"),
        ativo=dados["ativo"]
    )
    lote = await servico.criar_lote(id, setor_id, a, d)
    return {
        "id": lote.id,
        "setorId": lote.setor_id,
        "nome": lote.nome,
        "precoCentavos": lote.preco_centavos,
        "descontoPercentual": lote.desconto_percentual,
        "politicaPadrao": lote.politica_padrao,
        "capacidade": lote.capacidade(),
        "reservados": lote.reservados(),
        "disponiveis": lote.disponiveis(),
        "inicioVendas": lote.inicio_vendas.isoformat() if lote.inicio_vendas else None,
        "fimVendas": lote.fim_vendas.isoformat() if lote.fim_vendas else None,
        "ativo": lote.ativo,
        "vigente": lote.vigente(),
    }

@app.patch("/{id}/lotes/{lote_id}")
async def editar_lote_endpoint(id: str, lote_id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    if not UUID_RE.match(lote_id):
        raise HTTPException(status_code=400, detail={"erro": "loteId inválido"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    dados, problemas = validar_dados_lote(corpo, False)
    if problemas:
        return JSONResponse(status_code=400, content={"erro": problemas[0]["mensagem"], "problemas": problemas})
    if not dados:
        raise HTTPException(status_code=400, detail={"erro": "nada para alterar"})

    lote = await servico.editar_lote(id, lote_id, a, dados)
    return {
        "id": lote.id,
        "setorId": lote.setor_id,
        "nome": lote.nome,
        "precoCentavos": lote.preco_centavos,
        "descontoPercentual": lote.desconto_percentual,
        "politicaPadrao": lote.politica_padrao,
        "capacidade": lote.capacidade(),
        "reservados": lote.reservados(),
        "disponiveis": lote.disponiveis(),
        "inicioVendas": lote.inicio_vendas.isoformat() if lote.inicio_vendas else None,
        "fimVendas": lote.fim_vendas.isoformat() if lote.fim_vendas else None,
        "ativo": lote.ativo,
        "vigente": lote.vigente(),
    }

@app.delete("/{id}/lotes/{lote_id}")
async def excluir_lote_endpoint(id: str, lote_id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    if not UUID_RE.match(lote_id):
        raise HTTPException(status_code=400, detail={"erro": "loteId inválido"})

    await servico.excluir_lote(id, lote_id, a)
    return {"removido": lote_id}

# ================= Cotação =================

@app.post("/{id}/cotacao")
async def cotacao_endpoint(id: str, request: Request):
    exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    itens = corpo.get("itens")
    if not isinstance(itens, list) or len(itens) == 0:
        raise HTTPException(status_code=400, detail={"erro": "informe ao menos um item"})
    if len(itens) > 20:
        raise HTTPException(status_code=400, detail={"erro": "no máximo 20 itens por cotação"})

    normalizados: list[ItemPedido] = []
    for it in itens:
        lote_id = it.get("loteId")
        if not isinstance(lote_id, str) or not UUID_RE.match(lote_id):
            raise HTTPException(status_code=400, detail={"erro": "loteId inválido"})

        qtd = it.get("quantidade")
        if not isinstance(qtd, int) or qtd < 1 or qtd > 20:
            raise HTTPException(status_code=400, detail={"erro": "quantidade deve ser um inteiro entre 1 e 20"})

        pol = it.get("politica", "INTEIRA")
        if pol not in POLITICAS_PRECO:
            raise HTTPException(status_code=400, detail={"erro": f"política deve ser uma de: {', '.join(POLITICAS_PRECO)}"})

        normalizados.append(ItemPedido(lote_id=lote_id, quantidade=qtd, politica=pol))

    return await servico.cotar(id, normalizados)

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="0.0.0.0", port=PORT, log_level="info")
