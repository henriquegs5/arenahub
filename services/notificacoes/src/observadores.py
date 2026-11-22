from typing import Any, Dict
from .observer import Observador
from .canais import Notificador
from .avisos import montar_avisos
from .repositorio import esta_removido, registrar_removido, remover_do_usuario

class ObservadorAvisos(Observador):
    """
    Observador dos eventos que geram avisos aos participantes.
    Entrega por todos os canais que suportarem o aviso (Padrão Adapter).
    """
    def __init__(self, notificador: Notificador):
        self._notificador = notificador

    def tipos(self) -> list[str]:
        return [
            "usuario.registrado",
            "usuario.atualizado",
            "ingresso.emitido",
            "pagamento.recusado",
            "pedido.cancelado",
            "estorno.concluido",
            "ingressos.afetados",
        ]

    async def atualizar(self, e: Dict[str, Any]) -> None:
        for aviso in montar_avisos(e):
            if aviso.usuarioId and (await esta_removido(aviso.usuarioId)):
                continue
            await self._notificador.notificar(aviso)

class ObservadorUsuarioRemovido(Observador):
    """
    Integridade: conta excluída não deixa avisos órfãos para trás.
    É a compensação deste serviço para `usuario.removido`.
    """
    def tipos(self) -> list[str]:
        return ["usuario.removido"]

    async def atualizar(self, e: Dict[str, Any]) -> None:
        p = e.get("payload", {})
        usuario_id = p.get("usuarioId")
        if not usuario_id:
            return
        await registrar_removido(usuario_id)
        n = await remover_do_usuario(usuario_id)
        print(f"[notificacoes] conta {usuario_id} removida: {n} aviso(s) descartado(s)")
