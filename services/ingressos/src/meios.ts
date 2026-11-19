/**
 * Meios de pagamento conhecidos por ESTE serviço.
 *
 * Arquivo pequeno e duplicado de propósito: o serviço de Pagamento tem a sua
 * própria versão, com as estratégias e as regras de aprovação. Aqui só é preciso
 * saber se o valor recebido na compra é um meio existente, para recusar cedo um
 * pedido mal formado. Não existe biblioteca de domínio compartilhada — o
 * contrato comum entre os dois é o JSON Schema de `pagamento.solicitado.v1`.
 */
export const MEIOS_PAGAMENTO = ["PIX", "CARTAO_CREDITO", "BOLETO", "CARTAO_RECUSADO"] as const;

export type MeioPagamento = (typeof MEIOS_PAGAMENTO)[number];

export const meioValido = (m: unknown): m is MeioPagamento =>
  typeof m === "string" && (MEIOS_PAGAMENTO as readonly string[]).includes(m);

export const emReais = (centavos: number): string =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
