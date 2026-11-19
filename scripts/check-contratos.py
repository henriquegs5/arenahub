# -*- coding: utf-8 -*-
"""
Confere a coerencia entre o CODIGO e os CONTRATOS de evento.

Regra 6 do projeto: todo evento novo precisa de JSON Schema em
contracts/events/<nome>.v<versao>.schema.json e de uma linha em
docs/02-contratos-eventos.md. Este script falha quando isso nao bate.

Verifica:
  1. todo evento declarado em PUBLISHES tem schema;
  2. todo evento declarado em SUBSCRIBES tem schema (alguem precisa publica-lo);
  3. todo schema existente e publicado por alguem (nao ha contrato orfao);
  4. o produtor declarado no schema confere com quem publica no codigo;
  5. todo evento aparece no catalogo de docs/02-contratos-eventos.md.

Rodar:  python scripts/check-contratos.py
"""
import io
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTOS_DIR = os.path.join(RAIZ, "contracts", "events")
DOC = os.path.join(RAIZ, "docs", "02-contratos-eventos.md")

# Servico -> caminho do config.ts. O gateway tambem publica eventos.
CONFIGS = {
    "gateway": os.path.join(RAIZ, "gateway", "src", "config.ts"),
    "eventos": os.path.join(RAIZ, "services", "eventos", "src", "config.ts"),
    "ingressos": os.path.join(RAIZ, "services", "ingressos", "src", "config.ts"),
    "pagamento": os.path.join(RAIZ, "services", "pagamento", "src", "config.ts"),
    "notificacoes": os.path.join(RAIZ, "services", "notificacoes", "src", "config.ts"),
}


def ler_lista(texto, nome):
    """Extrai os literais de string de `export const NOME: string[] = [...]`."""
    m = re.search(r"export const " + nome + r"\s*:\s*string\[\]\s*=\s*\[(.*?)\]", texto, re.S)
    if not m:
        return []
    return re.findall(r'"([^"]+)"', m.group(1))


def main():
    problemas = []

    publica = {}    # routing key -> servico
    consome = {}    # routing key -> [servicos]

    for servico, caminho in CONFIGS.items():
        if not os.path.exists(caminho):
            problemas.append("config nao encontrado: %s" % caminho)
            continue
        texto = io.open(caminho, encoding="utf-8").read()
        for key in ler_lista(texto, "PUBLISHES"):
            if key in publica:
                problemas.append(
                    "evento %s e publicado por DOIS servicos (%s e %s); cada evento tem um dono"
                    % (key, publica[key], servico))
            publica[key] = servico
        for key in ler_lista(texto, "SUBSCRIBES"):
            consome.setdefault(key, []).append(servico)

    schemas = {}
    for arquivo in sorted(os.listdir(EVENTOS_DIR)):
        if not arquivo.endswith(".schema.json"):
            continue
        caminho = os.path.join(EVENTOS_DIR, arquivo)
        try:
            doc = json.load(io.open(caminho, encoding="utf-8"))
        except ValueError as e:
            problemas.append("schema invalido em %s: %s" % (arquivo, e))
            continue
        key = arquivo[: -len(".schema.json")]          # ex.: ingresso.emitido.v1
        schemas[key] = doc

        producer = doc.get("properties", {}).get("producer", {}).get("const")
        if not producer:
            problemas.append("%s nao declara o produtor (properties.producer.const)" % arquivo)

        tipo = doc.get("properties", {}).get("type", {}).get("const")
        esperado = key.rsplit(".v", 1)[0]
        if tipo != esperado:
            problemas.append("%s: type.const e %r mas o arquivo diz %r" % (arquivo, tipo, esperado))

    # 1 e 4) todo evento publicado tem schema, com o produtor certo
    for key, servico in sorted(publica.items()):
        if key not in schemas:
            problemas.append("evento %s e publicado por %s mas NAO tem schema em contracts/events/"
                             % (key, servico))
            continue
        producer = schemas[key].get("properties", {}).get("producer", {}).get("const")
        if producer != servico:
            problemas.append("evento %s: o schema diz producer=%r, mas quem publica no codigo e %r"
                             % (key, producer, servico))

    # 2) todo evento consumido e publicado por alguem
    for key, servicos in sorted(consome.items()):
        if key not in schemas:
            problemas.append("evento %s e consumido por %s mas NAO tem schema"
                             % (key, ", ".join(servicos)))
        if key not in publica:
            problemas.append("evento %s e consumido por %s mas NINGUEM o publica"
                             % (key, ", ".join(servicos)))

    # 3) nao ha contrato orfao
    for key in sorted(schemas):
        if key not in publica:
            problemas.append("schema %s existe mas nenhum servico o publica; remova o contrato"
                             % key)

    # 5) todo evento esta no catalogo da documentacao
    if os.path.exists(DOC):
        doc_txt = io.open(DOC, encoding="utf-8").read()
        for key in sorted(schemas):
            if key not in doc_txt:
                problemas.append("evento %s nao aparece em docs/02-contratos-eventos.md" % key)
    else:
        problemas.append("docs/02-contratos-eventos.md nao encontrado")

    print("eventos publicados: %d | contratos: %d" % (len(publica), len(schemas)))
    for key in sorted(publica):
        destinos = consome.get(key, [])
        print("  %-34s %-13s -> %s" % (key, publica[key], ", ".join(destinos) if destinos else "(ninguem)"))

    if problemas:
        print("\nPROBLEMAS (%d):" % len(problemas))
        for p in problemas:
            print("  - %s" % p)
        return 1

    print("\nCONTRATOS COERENTES")
    return 0


if __name__ == "__main__":
    sys.exit(main())
