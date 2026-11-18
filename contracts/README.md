# contracts/

JSON Schema de cada evento (`events/*.schema.json`). Fonte da verdade dos contratos.
Descrição legível em `docs/02-contratos-eventos.md`.

Regra: serviços NÃO importam código uns dos outros. Cada serviço declara seus próprios tipos a partir destes schemas.
