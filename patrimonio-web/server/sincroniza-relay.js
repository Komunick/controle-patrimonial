'use strict';

/*
 * Sincronizador entre o Controle Patrimonial da VM e o relay público.
 *
 * Requer Node.js 18 ou mais recente (fetch nativo) e não instala bibliotecas.
 * O ciclo é seguro para repetição: termos são idempotentes no relay e uma
 * assinatura só é confirmada como baixada depois de chegar ao sistema local.
 */

const INTERVALO_MS = 60 * 1000;
const TIMEOUT_MS = 20 * 1000;
const OPERADOR = encodeURIComponent('Sincronizador Relay');

function semBarraFinal(valor) {
  return String(valor || '').trim().replace(/\/+$/, '');
}

function erroDeResposta(resposta, dados) {
  const mensagem = dados && dados.error
    ? dados.error
    : `HTTP ${resposta.status} ao acessar ${resposta.url}`;
  const erro = new Error(mensagem);
  erro.status = resposta.status;
  erro.dados = dados;
  return erro;
}

async function requisitarJson(base, caminho, opcoes) {
  const config = opcoes || {};
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), config.timeout || TIMEOUT_MS);
  const headers = Object.assign({ Accept: 'application/json' }, config.headers || {});
  const fetchOpts = {
    method: config.method || 'GET',
    headers,
    signal: controlador.signal,
  };
  if (Object.prototype.hasOwnProperty.call(config, 'body')) {
    headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(config.body);
  }

  let resposta;
  try {
    resposta = await fetch(new URL(caminho, `${semBarraFinal(base)}/`), fetchOpts);
  } catch (erro) {
    if (erro && erro.name === 'AbortError') {
      throw new Error(`Tempo esgotado ao acessar ${semBarraFinal(base)}${caminho}.`);
    }
    throw erro;
  } finally {
    clearTimeout(temporizador);
  }

  const texto = await resposta.text();
  let dados = null;
  if (texto) {
    try { dados = JSON.parse(texto); }
    catch (_) { throw new Error(`Resposta não JSON recebida de ${resposta.url}.`); }
  }
  if (!resposta.ok) throw erroDeResposta(resposta, dados);
  return dados;
}

function headersRelay(config) {
  return { 'x-segredo': config.relaySegredo };
}

function headersSistema() {
  return { 'X-Operator': OPERADOR };
}

async function enviarTermos(config, resumo) {
  const entregas = await requisitarJson(config.sistemaUrl, '/api/epi', {
    headers: headersSistema(),
  });
  if (!Array.isArray(entregas)) throw new Error('O GET /api/epi local não devolveu uma lista.');

  const pendentes = entregas.filter((entrega) => entrega && entrega.status === 'pendente' && entrega.token);
  for (const entrega of pendentes) {
    try {
      // A lista local não traz a empresa; o termo público traz o retrato completo.
      const termo = await requisitarJson(
        config.sistemaUrl,
        `/api/epi/termo?token=${encodeURIComponent(entrega.token)}`,
        { headers: headersSistema() },
      );
      if (termo.status !== 'pendente') continue;
      const payload = {
        token: entrega.token,
        person_name: termo.person_name,
        itens: termo.itens,
        obs: termo.obs || null,
        empresa: termo.company,
        entregue_por: termo.entregue_por,
        created_at: termo.created_at,
      };
      const resultado = await requisitarJson(config.relayUrl, '/api/termos', {
        method: 'POST',
        headers: headersRelay(config),
        body: payload,
      });
      resumo.termos_enviados += resultado && resultado.criado ? 1 : 0;
      resumo.termos_ja_existentes += resultado && resultado.criado ? 0 : 1;
    } catch (erro) {
      resumo.erros += 1;
      console.error(`[sync] Não foi possível enviar o termo ${entrega.token}: ${erro.message}`);
    }
  }
}

async function assinaturaJaEstaLocal(config, token) {
  try {
    const termo = await requisitarJson(
      config.sistemaUrl,
      `/api/epi/termo?token=${encodeURIComponent(token)}`,
      { headers: headersSistema() },
    );
    return termo && termo.status === 'assinado';
  } catch (_) {
    return false;
  }
}

async function baixarAssinaturas(config, resumo) {
  const assinaturas = await requisitarJson(config.relayUrl, '/api/assinaturas?pendentes=1', {
    headers: headersRelay(config),
  });
  if (!Array.isArray(assinaturas)) {
    throw new Error('O GET /api/assinaturas do relay não devolveu uma lista.');
  }

  for (const assinatura of assinaturas) {
    const token = String(assinatura && assinatura.token || '');
    if (!token) continue;
    try {
      let chegouAoSistema = false;
      try {
        await requisitarJson(config.sistemaUrl, '/api/epi/assinar', {
          method: 'POST',
          headers: headersSistema(),
          body: {
            token,
            nome: assinatura.nome,
            documento: assinatura.documento || null,
            concordo: true,
            assinatura_png: assinatura.assinatura_png,
          },
        });
        chegouAoSistema = true;
      } catch (erroLocal) {
        // Recupera o caso: POST local funcionou, mas o relay não recebeu a
        // confirmação no ciclo anterior. Assim não ficamos presos no HTTP 409.
        if (erroLocal.status === 409 && await assinaturaJaEstaLocal(config, token)) {
          chegouAoSistema = true;
          console.warn(`[sync] O termo ${token} já estava assinado no sistema local; confirmando a baixa no relay.`);
        } else {
          throw erroLocal;
        }
      }

      if (chegouAoSistema) {
        await requisitarJson(
          config.relayUrl,
          `/api/assinaturas/${encodeURIComponent(token)}/baixada`,
          { method: 'POST', headers: headersRelay(config), body: {} },
        );
        resumo.assinaturas_importadas += 1;
      }
    } catch (erro) {
      resumo.erros += 1;
      console.error(`[sync] Não foi possível importar a assinatura ${token}: ${erro.message}`);
    }
  }
}

async function sincronizarUmaVez(config) {
  const resumo = {
    termos_enviados: 0,
    termos_ja_existentes: 0,
    assinaturas_importadas: 0,
    erros: 0,
  };

  // As duas fases são independentes: ainda buscamos assinaturas se a listagem
  // local falhar, e ainda enviamos termos se a consulta ao relay falhar.
  try { await enviarTermos(config, resumo); }
  catch (erro) {
    resumo.erros += 1;
    console.error(`[sync] Falha ao listar/enviar termos: ${erro.message}`);
  }
  try { await baixarAssinaturas(config, resumo); }
  catch (erro) {
    resumo.erros += 1;
    console.error(`[sync] Falha ao listar/baixar assinaturas: ${erro.message}`);
  }
  return resumo;
}

function configuracaoDoAmbiente() {
  const config = {
    relayUrl: semBarraFinal(process.env.RELAY_URL),
    relaySegredo: String(process.env.RELAY_SEGREDO || ''),
    sistemaUrl: semBarraFinal(process.env.SISTEMA_URL || 'http://127.0.0.1:8080'),
  };
  if (!config.relayUrl) throw new Error('Defina RELAY_URL com a URL pública do relay.');
  if (!config.relaySegredo) throw new Error('Defina RELAY_SEGREDO com o mesmo segredo do relay.');
  return config;
}

function iniciarLoop() {
  if (typeof fetch !== 'function') {
    throw new Error('Este script requer Node.js 18 ou mais recente (fetch nativo).');
  }
  const config = configuracaoDoAmbiente();
  let encerrando = false;
  let temporizador = null;

  console.log(`[sync] Relay: ${config.relayUrl}`);
  console.log(`[sync] Sistema local: ${config.sistemaUrl}`);
  console.log('[sync] Sincronização iniciada; intervalo de 60 segundos.');

  const ciclo = async () => {
    const inicio = new Date();
    const resumo = await sincronizarUmaVez(config);
    console.log(`[sync] ${inicio.toISOString()} — enviados=${resumo.termos_enviados}, existentes=${resumo.termos_ja_existentes}, importadas=${resumo.assinaturas_importadas}, erros=${resumo.erros}`);
    if (!encerrando) temporizador = setTimeout(ciclo, INTERVALO_MS);
  };

  const encerrar = () => {
    encerrando = true;
    if (temporizador) clearTimeout(temporizador);
    console.log('[sync] Sincronizador encerrado.');
  };
  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
  ciclo().catch((erro) => {
    console.error('[sync] Erro inesperado no ciclo:', erro);
    if (!encerrando) temporizador = setTimeout(ciclo, INTERVALO_MS);
  });
}

if (require.main === module) {
  try { iniciarLoop(); }
  catch (erro) {
    console.error(`[sync] ${erro.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  requisitarJson,
  sincronizarUmaVez,
  configuracaoDoAmbiente,
};
