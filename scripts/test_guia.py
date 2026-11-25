import urllib.request, urllib.error, json, time, subprocess, sys

B = "http://localhost:8080/api"

def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    url = ("http://localhost:8080" + path) if path in ("/status", "/health") else (B + path)
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except: return e.code, raw

print("=== 0. PREPARAÇÃO ===")
# 0.1 Login Admin
s, r = req("POST", "/auth/login", {"email": "admin@arenahub.local", "senha": "arenahub123"})
assert s == 200, f"Falha no login admin: {s} {r}"
admin_token = r["token"]
print(" [OK] Admin logado com sucesso")

# 0.2 Cadastro / Login Participante (visual1@teste.com)
s, r = req("POST", "/auth/register", {"nome": "Participante Visual", "email": "visual1@teste.com", "senha": "senha1234", "papel": "PARTICIPANTE"})
s, r = req("POST", "/auth/login", {"email": "visual1@teste.com", "senha": "senha1234"})
assert s == 200, f"Falha login participante: {s} {r}"
part_token = r["token"]
part_id = r["usuario"]["id"]
print(" [OK] Participante visual1@teste.com logado")

# 0.3 Criar Organizador e Evento "Saga Cup 27677215" com "Lote único" e "Lote 66"
s, r = req("POST", "/auth/register", {"nome": "Organizador Saga", "email": "org_saga@teste.com", "senha": "senha1234", "papel": "ORGANIZADOR"})
s, r = req("POST", "/auth/login", {"email": "org_saga@teste.com", "senha": "senha1234"})
org_token = r["token"]
org_id = r["usuario"]["id"]

s, ev = req("POST", "/eventos", {"nome": "Saga Cup 27677215", "local": "Arena Gamer SP", "dataHora": "2026-12-10T19:00:00Z"}, org_token)
if s == 201:
    eid = ev["id"]
    s, st = req("POST", f"/eventos/{eid}/setores", {"nome": "Setor Principal"}, org_token)
    setor_id = st["id"]
    # Lote único: R$ 100,00 (10000 centavos)
    s, lt1 = req("POST", f"/eventos/{eid}/setores/{setor_id}/lotes", {"nome": "Lote único", "precoCentavos": 10000, "capacidade": 50}, org_token)
    lote_unico = lt1["id"]
    # Lote 66: R$ 80,66 (8066 centavos)
    s, lt2 = req("POST", f"/eventos/{eid}/setores/{setor_id}/lotes", {"nome": "Lote 66", "precoCentavos": 8066, "capacidade": 20}, org_token)
    lote_66 = lt2["id"]
    req("POST", f"/eventos/{eid}/publicar", None, org_token)
    req("POST", f"/eventos/{eid}/abrir-vendas", None, org_token)
    print(" [OK] Evento 'Saga Cup 27677215' criado e com vendas abertas")
else:
    # Já existia, buscar
    s, evs = req("GET", "/eventos", None, admin_token)
    ev_saga = next(e for e in evs if "Saga Cup" in e["nome"])
    eid = ev_saga["id"]
    s, ev_full = req("GET", f"/eventos/{eid}", None, admin_token)
    lote_unico = ev_full["setores"][0]["lotes"][0]["id"]
    lote_66 = ev_full["setores"][0]["lotes"][1]["id"]
    print(" [OK] Evento 'Saga Cup 27677215' reutilizado")

# 0.4 Emitir 1 ingresso para teste de check-in
s, p = req("POST", "/ingressos/pedidos", {
    "eventoId": eid,
    "itens": [{"loteId": lote_unico, "quantidade": 1, "politica": "INTEIRA"}],
    "meio": "PIX",
    "referenciaPagamento": "pix-token-teste-prep"
}, part_token)
assert s == 202, f"Erro compra: {s} {p}"
pid = p["id"]
for _ in range(20):
    time.sleep(1)
    s, ped = req("GET", f"/ingressos/pedidos/{pid}", None, part_token)
    if ped["status"] == "CONCLUIDO": break

cod_checkin = ped["ingressos"][0]["codigo"]
print(f" [OK] Ingresso emitido para teste de check-in: {cod_checkin}")

print("\n=== 1. CHECK-IN (ADM) ===")
# 1.1 Validar código emitido
s, v1 = req("POST", "/ingressos/validar", {"codigo": cod_checkin}, admin_token)
print(f" 1.1 Entrada liberada (1ª leitura): status={s}, aprovado={v1.get('aprovado')}, motivo={v1.get('motivo')}")
assert v1.get("aprovado") is True

# 1.2 Validar o mesmo código novamente
s, v2 = req("POST", "/ingressos/validar", {"codigo": cod_checkin}, admin_token)
print(f" 1.2 Entrada recusada (2ª leitura): status={s}, aprovado={v2.get('aprovado')}, motivo={v2.get('motivo')}")
assert v2.get("aprovado") is False and "já foi utilizado" in v2.get("motivo", "")

# 1.3 Validar código inexistente
s, v3 = req("POST", "/ingressos/validar", {"codigo": "ARENA-XXXX-XXXX-XXXX"}, admin_token)
print(f" 1.3 Código inexistente: status={s}, aprovado={v3.get('aprovado')}, motivo={v3.get('motivo')}")
assert v3.get("aprovado") is False and "não encontrado" in v3.get("motivo", "")

print("\n=== 2. USUÁRIOS (ADM) ===")
# 2.1 Listar como ADM
s, users = req("GET", "/auth/usuarios", None, admin_token)
print(f" 2.1 Listagem de usuários pelo ADM: status={s}, total={len(users)}")
assert s == 200 and len(users) >= 2

# 2.2 Tentar criar ADM pelo registro público
s, r = req("POST", "/auth/register", {"nome": "Tentativa ADM", "email": "fakeadm@teste.com", "senha": "senha1234", "papel": "ADM"})
print(f" 2.2 Cadastro público com papel ADM rejeitado: status={s}, erro={r.get('erro')}")
assert s in (400, 403)

# 2.3 Remover conta de teste
s, temp = req("POST", "/auth/register", {"nome": "Temp User", "email": "temp_delete@teste.com", "senha": "senha1234", "papel": "PARTICIPANTE"})
s, temp_log = req("POST", "/auth/login", {"email": "temp_delete@teste.com", "senha": "senha1234"})
temp_id = temp_log["usuario"]["id"]
s, r = req("DELETE", f"/auth/usuarios/{temp_id}", None, admin_token)
print(f" 2.3 Exclusão de usuário pelo ADM: status={s}, resp={r}")
assert s == 200

print("\n=== 3. SISTEMA (ADM) ===")
s, st = req("GET", "/status", None, admin_token)
print(f" 3.1 Status dos 4 serviços e disjuntores: status={s}, data={st}")
for k, v in st.items():
    assert v.get("servico") == "no ar", f"Serviço {k} não está no ar: {v}"
    assert v.get("circuito") == "FECHADO", f"Disjuntor de {k} não está FECHADO: {v}"

for svc in ["eventos", "ingressos", "pagamento", "notificacoes"]:
    s, dlq = req("GET", f"/{svc}/dlq", None, admin_token)
    print(f" 3.2 DLQ {svc}: total={dlq.get('total')}")

print("\n=== 4. TELA DE COMPRA (PARTICIPANTE) ===")
# 4.1 Compra aprovada
s, p = req("POST", "/ingressos/pedidos", {
    "eventoId": eid,
    "itens": [{"loteId": lote_unico, "quantidade": 1, "politica": "INTEIRA"}],
    "meio": "PIX",
    "referenciaPagamento": "pix-token-teste-100"
}, part_token)
print(f" 4.1 Pedido compra normal: status={s}, pedidoId={p['id']}")
assert s == 202
p_normal_id = p["id"]
for _ in range(20):
    time.sleep(1)
    s, ped = req("GET", f"/ingressos/pedidos/{p_normal_id}", None, part_token)
    if ped["status"] in ("CONCLUIDO", "RECUSADO", "CANCELADO"): break
print(f"     Status final do pedido: {ped['status']}, ingressos={len(ped['ingressos'])}")
assert ped["status"] == "CONCLUIDO"

# 4.2 Compra com gatilho de recusa (CARTAO_RECUSADO)
s, p_rec = req("POST", "/ingressos/pedidos", {
    "eventoId": eid,
    "itens": [{"loteId": lote_unico, "quantidade": 1, "politica": "INTEIRA"}],
    "meio": "CARTAO_RECUSADO",
    "referenciaPagamento": "tok-recusa-123"
}, part_token)
print(f" 4.2 Pedido com CARTAO_RECUSADO: status={s}, pedidoId={p_rec['id']}")
assert s == 202
for _ in range(20):
    time.sleep(1)
    s, ped_rec = req("GET", f"/ingressos/pedidos/{p_rec['id']}", None, part_token)
    if ped_rec["status"] in ("CONCLUIDO", "RECUSADO", "CANCELADO"): break
print(f"     Status final do pedido recusado: {ped_rec['status']} (compensação acionada)")
assert ped_rec["status"] == "RECUSADO"

# 4.3 Compra com gatilho de 66 centavos (Lote 66 = R$ 80,66)
s, p_66 = req("POST", "/ingressos/pedidos", {
    "eventoId": eid,
    "itens": [{"loteId": lote_66, "quantidade": 1, "politica": "INTEIRA"}],
    "meio": "PIX",
    "referenciaPagamento": "pix-token-66"
}, part_token)
print(f" 4.3 Pedido com 66 centavos: status={s}, pedidoId={p_66['id']}")
assert s == 202
for _ in range(20):
    time.sleep(1)
    s, ped_66 = req("GET", f"/ingressos/pedidos/{p_66['id']}", None, part_token)
    if ped_66["status"] in ("CONCLUIDO", "RECUSADO", "CANCELADO"): break
print(f"     Status final do pedido 66 centavos: {ped_66['status']}")
assert ped_66["status"] == "RECUSADO"

print("\n=== 5. TOLERÂNCIA A FALHAS ===")
# 5.1 Parar Pagamento
print(" 5.1 Parando pagamento: docker compose stop pagamento...")
subprocess.run(["docker", "compose", "stop", "pagamento"], check=True)
time.sleep(2)

s, st = req("GET", "/status", None, admin_token)
print(f"     Status dos serviços após parar pagamento: pagamento={st.get('pagamento', {}).get('servico')}")
s_cat, cat = req("GET", "/eventos", None, part_token)
print(f"     Catálogo de eventos com pagamento fora: status={s_cat}, total_eventos={len(cat)}")
assert s_cat == 200

s_ing, ings = req("GET", "/ingressos", None, part_token)
print(f"     Meus Ingressos com pagamento fora: status={s_ing}, total_ingressos={len(ings)}")
assert s_ing == 200

# Subir Pagamento de volta
print("     Reiniciando pagamento: docker compose start pagamento...")
subprocess.run(["docker", "compose", "start", "pagamento"], check=True)
time.sleep(4)
s, st = req("GET", "/status", None, admin_token)
print(f"     Status pagamento recuperado: {st.get('pagamento')}")

# 5.2 Parar Notificações
print("\n 5.2 Parando notificacoes: docker compose stop notificacoes...")
subprocess.run(["docker", "compose", "stop", "notificacoes"], check=True)
time.sleep(2)

s, st = req("GET", "/status", None, admin_token)
print(f"     Status notificacoes: {st.get('notificacoes', {}).get('servico')}")

# Fazer compra enquanto notificacoes está fora do ar
s, p_fn = req("POST", "/ingressos/pedidos", {
    "eventoId": eid,
    "itens": [{"loteId": lote_unico, "quantidade": 1, "politica": "INTEIRA"}],
    "meio": "PIX",
    "referenciaPagamento": "pix-token-no-notif"
}, part_token)
print(f"     Compra com notificacoes parado respondeu 202: status={s}, id={p_fn['id']}")
assert s == 202
for _ in range(20):
    time.sleep(1)
    s, ped_fn = req("GET", f"/ingressos/pedidos/{p_fn['id']}", None, part_token)
    if ped_fn["status"] == "CONCLUIDO": break
print(f"     Pedido concluiu normalmente sem notificacoes: status={ped_fn['status']}")
assert ped_fn["status"] == "CONCLUIDO"

# Subir Notificações de volta
print("     Reiniciando notificacoes: docker compose start notificacoes...")
subprocess.run(["docker", "compose", "start", "notificacoes"], check=True)
time.sleep(4)
s, st = req("GET", "/status", None, admin_token)
print(f"     Status notificacoes recuperado: {st.get('notificacoes')}")

print("\n=== TODOS OS TESTES DO GUIA CONCLUÍDOS COM SUCESSO! ===")
