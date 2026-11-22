import unittest
from datetime import datetime, timezone, timedelta
try:
    from src.estrutura import EventoComposto, Setor, Lote
    from src.estados import estado_de, TransicaoInvalida
    from src.precos import criador_para, estrategia_para
    from src.validacoes import cadeia_de_reserva, ContextoReserva, ItemPedido
except ImportError:
    from .estrutura import EventoComposto, Setor, Lote
    from .estados import estado_de, TransicaoInvalida
    from .precos import criador_para, estrategia_para
    from .validacoes import cadeia_de_reserva, ContextoReserva, ItemPedido

def make_lote(id: str, setor_id: str, cap: int, res: int, preco: int = 10000) -> Lote:
    return Lote(
        id=id,
        setor_id=setor_id,
        nome=f"Lote {id}",
        preco_centavos=preco,
        desconto_percentual=20,
        politica_padrao="INTEIRA",
        capacidade_lote=cap,
        reservados_lote=res,
        inicio_vendas=None,
        fim_vendas=None,
        ativo=True
    )

class TestDominio(unittest.TestCase):
    # ---------------- COMPOSITE ----------------
    def test_composite_capacidade_disponibilidade(self):
        pista = Setor("s1", "e1", "Pista").adicionar(make_lote("l1", "s1", 100, 10)).adicionar(make_lote("l2", "s1", 50, 5))
        camarote = Setor("s2", "e1", "Camarote").adicionar(make_lote("l3", "s2", 20, 20))
        evento = EventoComposto("e1", "BGS").adicionar(pista).adicionar(camarote)

        self.assertEqual(pista.capacidade(), 150)
        self.assertEqual(pista.reservados(), 15)
        self.assertEqual(pista.disponiveis(), 135)

        self.assertEqual(camarote.disponiveis(), 0)

        self.assertEqual(evento.capacidade(), 170)
        self.assertEqual(evento.reservados(), 35)
        self.assertEqual(evento.disponiveis(), 135)

    def test_composite_sem_estrutura(self):
        vazio = EventoComposto("e2", "Sem estrutura")
        self.assertEqual(vazio.capacidade(), 0)
        self.assertEqual(vazio.disponiveis(), 0)

        vazio.adicionar(Setor("s9", "e2", "Setor vazio"))
        self.assertEqual(vazio.capacidade(), 0)

    def test_composite_achar_lote_preco_minimo(self):
        evento = EventoComposto("e3", "CCXP") \
            .adicionar(Setor("s1", "e3", "Pista").adicionar(make_lote("l1", "s1", 10, 0, 25000))) \
            .adicionar(Setor("s2", "e3", "Arquibancada").adicionar(make_lote("l2", "s2", 10, 0, 9000)))

        l2 = evento.achar_lote("l2")
        self.assertIsNotNone(l2)
        self.assertEqual(l2.nome, "Lote l2")
        self.assertIsNone(evento.achar_lote("inexistente"))
        self.assertEqual(evento.preco_minimo(), 9000)

    def test_composite_lote_fora_da_janela(self):
        agora = datetime.now(timezone.utc)
        ontem = agora - timedelta(days=1)
        anteontem = agora - timedelta(days=2)

        encerrado = Lote("l", "s", "Pre-venda", 5000, 0, "INTEIRA", 10, 0, anteontem, ontem, True)
        desligado = Lote("l2", "s", "Desligado", 5000, 0, "INTEIRA", 10, 0, None, None, False)

        self.assertFalse(encerrado.vigente(agora))
        self.assertFalse(desligado.vigente(agora))
        self.assertEqual(encerrado.disponiveis(), 10)

    # ---------------- STATE ----------------
    def test_state_ciclo_de_vida(self):
        e = estado_de("RASCUNHO")
        self.assertFalse(e.visivel_no_catalogo())
        self.assertFalse(e.aceita_vendas())

        e = e.publicar()
        self.assertEqual(e.nome, "PUBLICADO")
        self.assertFalse(e.aceita_vendas())

        e = e.abrir_vendas()
        self.assertEqual(e.nome, "VENDAS_ABERTAS")
        self.assertTrue(e.aceita_vendas())

        e = e.encerrar_vendas()
        self.assertEqual(e.nome, "VENDAS_ENCERRADAS")
        self.assertFalse(e.aceita_vendas())

        e = e.realizar()
        self.assertEqual(e.nome, "REALIZADO")

    def test_state_transicoes_invalidas(self):
        with self.assertRaises(TransicaoInvalida):
            estado_de("RASCUNHO").abrir_vendas()
        with self.assertRaises(TransicaoInvalida):
            estado_de("PUBLICADO").publicar()
        with self.assertRaises(TransicaoInvalida):
            estado_de("REALIZADO").cancelar()
        with self.assertRaises(TransicaoInvalida):
            estado_de("CANCELADO").abrir_vendas()

    def test_state_cancelar_de_qualquer_estado(self):
        for s in ["RASCUNHO", "PUBLICADO", "VENDAS_ABERTAS", "VENDAS_ENCERRADAS"]:
            self.assertEqual(estado_de(s).cancelar().nome, "CANCELADO")

    # ---------------- STRATEGY + FACTORY METHOD ----------------
    def test_strategy_precos(self):
        base = 10000
        desconto = 20

        self.assertEqual(estrategia_para("INTEIRA").preco_unitario(base, desconto), 10000)
        self.assertEqual(estrategia_para("MEIA").preco_unitario(base, desconto), 5000)
        self.assertEqual(estrategia_para("PROMOCIONAL").preco_unitario(base, desconto), 8000)
        self.assertEqual(estrategia_para("CORTESIA").preco_unitario(base, desconto), 0)

    def test_strategy_arredondamento(self):
        self.assertEqual(estrategia_para("MEIA").preco_unitario(2501, 0), 1251)
        self.assertEqual(estrategia_para("PROMOCIONAL").preco_unitario(10000, 150), 0)
        self.assertEqual(estrategia_para("PROMOCIONAL").preco_unitario(10000, -10), 10000)

    def test_factory_method(self):
        for p in ["INTEIRA", "MEIA", "PROMOCIONAL", "CORTESIA"]:
            self.assertEqual(criador_para(p).criar_estrategia().nome, p)

if __name__ == "__main__":
    unittest.main()
