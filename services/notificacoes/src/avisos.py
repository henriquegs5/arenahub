from datetime import datetime
from typing import Any, Dict, Optional
from .canais import Aviso

def rotulo_papel(papel: Optional[str]) -> str:
    if papel == "ORGANIZADOR":
        return "organizador"
    if papel == "ADM":
        return "administrador"
    return "participante"

def em_reais(centavos: Any) -> str:
    if isinstance(centavos, (int, float)):
        val = centavos / 100.0
        # Formato R$ 100,00
        return f"R$\xa0{val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return "—"

def quando_e_onde(p: Dict[str, Any]) -> str:
    partes = []
    data_hora = p.get("eventoDataHora")
    if data_hora:
        try:
            d = datetime.fromisoformat(str(data_hora).replace("Z", "+00:00"))
            partes.append(d.strftime("%d/%m/%Y, %H:%M"))
        except Exception:
            partes.append(str(data_hora))
    local = p.get("eventoLocal")
    if local:
        partes.append(str(local))
    return f" {' · '.join(partes)}." if partes else ""

def conteudo(tipo: str, p: Dict[str, Any]) -> Optional[Dict[str, str]]:
    if tipo == "usuario.registrado":
        return {
            "tipo": "USUARIO_REGISTRADO",
            "titulo": "Bem-vindo ao ArenaHub",
            "mensagem": f"Olá, {p.get('nome', '')}! Sua conta de {rotulo_papel(p.get('papel'))} foi criada. Explore os eventos e garanta seu ingresso."
        }
    elif tipo == "usuario.atualizado":
        return {
            "tipo": "USUARIO_ATUALIZADO",
            "titulo": "Conta atualizada",
            "mensagem": f"Os dados da sua conta foram alterados. Perfil atual: {rotulo_papel(p.get('papel'))}."
        }
    elif tipo == "ingresso.emitido":
        ingressos = p.get("ingressos", [])
        n = len(ingressos) if isinstance(ingressos, list) else 0
        codigos = ", ".join([i.get("codigo") for i in ingressos if isinstance(i, dict) and i.get("codigo")])
        codigos_txt = f"{'Código' if n == 1 else 'Códigos'}: {codigos or 'disponível em Meus ingressos'}."
        return {
            "tipo": "INGRESSO_EMITIDO",
            "titulo": "Ingresso emitido" if n == 1 else f"{n} ingressos emitidos",
            "mensagem": f'Compra confirmada para "{p.get("eventoNome", "")}".{quando_e_onde(p)} {codigos_txt} Total: {em_reais(p.get("totalCentavos"))}.'
        }
    elif tipo == "pagamento.recusado":
        return {
            "tipo": "PAGAMENTO_RECUSADO",
            "titulo": "Pagamento recusado",
            "mensagem": f'O pagamento de {em_reais(p.get("valorCentavos"))} para "{p.get("eventoNome", "o evento")}" não foi autorizado. Motivo: {p.get("motivo", "não informado")}. Os lugares foram liberados e o pedido, cancelado.'
        }
    elif tipo == "pedido.cancelado":
        return {
            "tipo": "PEDIDO_CANCELADO",
            "titulo": "Pedido cancelado" if p.get("canceladoPeloUsuario") else "Pedido não concluído",
            "mensagem": f'Seu pedido para "{p.get("eventoNome", "o evento")}" foi encerrado. Motivo: {p.get("motivo", "tempo de reserva expirado")}.'
        }
    elif tipo == "estorno.concluido":
        return {
            "tipo": "ESTORNO_CONCLUIDO",
            "titulo": "Estorno concluído",
            "mensagem": f'{em_reais(p.get("valorCentavos"))} de "{p.get("eventoNome", "o evento")}" foram estornados para o seu {p.get("meio", "meio de pagamento")}.'
        }
    elif tipo == "ingressos.afetados":
        n = len(p.get("ingressos", [])) if isinstance(p.get("ingressos"), list) else 0
        return {
            "tipo": "EVENTO_ALTERADO",
            "titulo": "Aviso sobre seu ingresso",
            "mensagem": f'{p.get("motivo", "Houve uma atualização no evento")}. Seus {n} ingresso(s) continuam registrados.'
        }
    return None

def montar_avisos(evento: Dict[str, Any]) -> list[Aviso]:
    p = evento.get("payload", {})
    destinatarios = p.get("destinatarios", [])
    if not isinstance(destinatarios, list) or not destinatarios:
        return []

    tipo = evento.get("type", "")
    info = conteudo(tipo, p)
    if not info:
        return []

    resultado: list[Aviso] = []
    for uid in destinatarios:
        aviso = Aviso(
            tipo=info["tipo"],
            titulo=info["titulo"],
            mensagem=info["mensagem"],
            usuarioId=str(uid) if uid else None,
            eventoId=str(p["eventoId"]) if p.get("eventoId") else None,
            pedidoId=str(p["pedidoId"]) if p.get("pedidoId") else None,
            ingressoId=str(p["ingressoId"]) if p.get("ingressoId") else None,
            dados=p,
            email=p.get("email") if uid == p.get("usuarioId") else None,
            ocorridoEm=evento.get("occurredAt")
        )
        resultado.append(aviso)
    return resultado
