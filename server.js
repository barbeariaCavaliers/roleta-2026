const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { chromium } = require('playwright'); 

// ========================================================
// VARIÁVEIS GLOBAIS DE CONTROLE DO ROBÔ
// ========================================================
let sinalPendente = null; 
let historicoRoleta = [];
const numerosVermelhos = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

// CONTADORES E HISTÓRICO DE ESTRATÉGIAS
let greens = 0;
let reds = 0;
let historicoEstrategias = []; // Armazena as últimas entradas finalizadas

// Mapeamento das Colunas
const colunas = {
    1: [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
    2: [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
    3: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36]
};

// Ordem oficial dos números no cilindro da roleta europeia
const ordemCilindro = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

// Auxiliar: menor distância entre dois números no cilindro
function obtenerDistanciaCilindro(num1, num2) {
    const idx1 = ordemCilindro.indexOf(num1);
    const idx2 = ordemCilindro.indexOf(num2);
    if (idx1 === -1 || idx2 === -1) return 99;
    
    const distDireta = Math.abs(idx1 - idx2);
    return Math.min(distDireta, 37 - distDireta);
}

// Auxiliar: identificar a dúzia
const pegarDuzia = (num) => {
    if (num >= 1 && num <= 12) return 1;
    if (num >= 13 && num <= 24) return 2;
    if (num >= 25 && num <= 36) return 3;
    return 0; 
};

// ========================================================
// ESTATÍSTICA: QUAL NÚMERO PUXOU QUAL
// ========================================================
function calcularEstatisticasPuxadas(historico) {
    if (!historico || historico.length < 2) return [];

    let mapaPuxadas = {};

    for (let i = 0; i < historico.length - 1; i++) {
        let atual = historico[i];       // Número que acabou de sair
        let anterior = historico[i + 1]; // O que saiu antes (o que "puxou")

        if (!mapaPuxadas[anterior]) {
            mapaPuxadas[anterior] = {};
        }
        if (!mapaPuxadas[anterior][atual]) {
            mapaPuxadas[anterior][atual] = 0;
        }
        mapaPuxadas[anterior][atual]++;
    }

    let estatisticasFormatadas = [];
    for (let num in mapaPuxadas) {
        let proximos = mapaPuxadas[num];
        let maisFrequente = Object.keys(proximos).reduce((a, b) => proximos[a] > proximos[b] ? a : b);
        
        estatisticasFormatadas.push({
            numero: parseInt(num),
            puxouMais: parseInt(maisFrequente),
            vezes: proximos[maisFrequente]
        });
    }

    estatisticasFormatadas.sort((a, b) => b.vezes - a.vezes);
    return estatisticasFormatadas.slice(0, 5); // Retorna os top 5 padrões mais fortes
}

// ========================================================
// SERVIDOR WEB & SOCKET.IO
// ========================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ========================================================
// MOTOR DE ANÁLISE DE ESTRATÉGIAS
// ========================================================
function analisarEstrategia(historico) {
    if (!historico || historico.length < 1) {
        return { status: "AGUARDANDO PADRÃO", sinal: "Aguardando mais giros da roleta..." };
    }

    const numMaisRecente = historico[0];

    // --------------------------------------------------------
    // ESTRATÉGIA 1: VIZINHO DO 0, 6, 10 e 28 (Gatilhos 4, 8, 14, 20, 27, 36)
    // --------------------------------------------------------
    const gatilhosVizinhos1 = [4, 8, 14, 20, 27, 36];

    if (gatilhosVizinhos1.includes(numMaisRecente)) {
        return {
            status: "SINAL CONFIRMADO",
            nomeEstrategia: "Vizinhos do 0, 6, 10, 28",
            tipo: "VIZINHO_GATILHO",
            alvos: [0, 6, 10, 28], 
            sinal: `🎯 GATILHO DETECTADO (${numMaisRecente})! Jogar nos números 0, 6, 10 e 28 (+ 2 vizinhos de cada lado)!`
        };
    }

    // --------------------------------------------------------
    // ESTRATÉGIA 2: VIZINHO DO 1, 11, 21 e 22 (Gatilhos  0 , 3, 9,10, 11,12,16, 23, 31)
    // --------------------------------------------------------
    const gatilhosVizinhos2 = [0 , 3, 9,10, 11,12,16, 23, 31];

    if (gatilhosVizinhos2.includes(numMaisRecente)) {
        return {
            status: "SINAL CONFIRMADO",
            nomeEstrategia: "Vizinhos do 1, 11, 21, 22",
            tipo: "VIZINHO_GATILHO",
            alvos: [1, 11, 21, 22],
            sinal: `🎯 GATILHO DETECTADO (${numMaisRecente})! Jogar 1, 11, 21, 22 + 2 vizinhos de cada lado (Cobrir o 0)!`
        };
    }

    return { 
        status: "ANALISANDO MESA", 
        sinal: `Último número foi ${numMaisRecente}. Aguardando gatilho...` 
    };
}

// Socket Connection
io.on('connection', (socket) => {
    console.log('[Painel] Um usuário se conectou.');
    const ultimoNum = historicoRoleta[0] || '--';
    
    const totalSinais = greens + reds;
    const assertividadeCalculada = totalSinais > 0 ? ((greens / totalSinais) * 100).toFixed(1) : "0.0";
    const estatisticas = calcularEstatisticasPuxadas(historicoRoleta);

    socket.emit('atualizacao_sinal', {
        numero: ultimoNum,
        historico: historicoRoleta,
        status: historicoRoleta.length > 0 ? analisarEstrategia(historicoRoleta).status : "AGUARDANDO GIRO",
        sinal: historicoRoleta.length > 0 ? analisarEstrategia(historicoRoleta).sinal : "Aguardando a roleta girar na mesa ao vivo...",
        greens: greens !== undefined ? greens : 0,
        reds: reds !== undefined ? reds : 0,
        assertividade: assertividadeCalculada,
        historicoEstrategias: historicoEstrategias || [],
        estatisticasPuxadas: estatisticas
    });
});

// ==========================================
// CAPTURA AVANÇADA DE ELEMENTOS DE JOGO
// ==========================================
async function iniciarRoboDefinitivo() {
    console.log('[Robô] Inicializando navegador com sessão persistente...');
    const caminhoSessao = path.join(__dirname, 'sessao_bot');
    
    try {
        const context = await chromium.launchPersistentContext(caminhoSessao, {
            headless: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1366, height: 768 }
        });

        const page = context.pages()[0] || await context.newPage();
        let ultimoNumeroRegistrado = null;
        let tempoUltimoGiro = Date.now();

        await page.goto('https://www.tipminer.com/br/cassinos/pragmatic/roleta-brasileira', { waitUntil: 'load', timeout: 60000 });
        console.log('[Robô] Página carregada com sucesso!');

        setInterval(async () => {
            try {
                const numerosGrid = await page.evaluate(() => {
                    const blocos = document.querySelectorAll('.history-grid > div, .roulette-history > div, [class*="result-"], [class*="item"]');
                    const resultadosLimpos = [];

                    blocos.forEach(bloco => {
                        const texto = bloco.innerText || "";
                        if (/\d{2}:\d{2}/.test(texto)) {
                            const lines = texto.split('\n');
                            const numeroTexto = lines[0].trim(); 
                            if (numeroTexto !== "" && /^\d+$/.test(numeroTexto)) {
                                const num = parseInt(numeroTexto, 10);
                                if (num >= 0 && num <= 36) resultadosLimpos.push(num);
                            }
                        }
                    });

                    const listaSemDuplicados = [];
                    resultadosLimpos.forEach(num => {
                        if (listaSemDuplicados.length === 0 || listaSemDuplicados[listaSemDuplicados.length - 1] !== num) {
                            listaSemDuplicados.push(num);
                        }
                    });

                    return listaSemDuplicados;
                });

                if (numerosGrid && numerosGrid.length > 0) {
                    const numeroSorteado = numerosGrid[0]; 

                    if (numeroSorteado !== ultimoNumeroRegistrado) {
                        ultimoNumeroRegistrado = numeroSorteado;
                        tempoUltimoGiro = Date.now();
                        historicoRoleta = numerosGrid.slice(0, 100);

                        console.log(`[Roleta Real] NOVO GIRO DETECTADO: ${numeroSorteado}`);

                        let duziaAtual = pegarDuzia(numeroSorteado);
                        let colunaAtual = 0;
                        if (colunas[1].includes(numeroSorteado)) colunaAtual = 1;
                        if (colunas[2].includes(numeroSorteado)) colunaAtual = 2;
                        if (colunas[3].includes(numeroSorteado)) colunaAtual = 3;

                        let analise = { status: "ANALISANDO MESA", sinal: `Último número foi ${numeroSorteado}. Aguardando padrão...` };

                        // Validação de Sinais Ativos com 2 Gales (Entrada + G1 + G2)
                        if (sinalPendente) {
                            let ganhou = false;

                            if (sinalPendente.tipo === 'DUZIA' && sinalPendente.alvos.includes(duziaAtual)) ganhou = true;
                            if (sinalPendente.tipo === 'COLUNA' && sinalPendente.alvos.includes(colunaAtual)) ganhou = true;

                            if (sinalPendente.tipo === 'VIZINHO_GATILHO') {
                                const alvos = sinalPendente.alvos; 
                                let bateuVizinho = false;

                                alvos.forEach(alvo => {
                                    if (obtenerDistanciaCilindro(numeroSorteado, alvo) <= 2) {
                                        bateuVizinho = true;
                                    }
                                });

                                if (bateuVizinho || numeroSorteado === 0) {
                                    ganhou = true;
                                }
                            }

                            if (ganhou) {
                                greens++; 
                                const tipoResultado = sinalPendente.tentativa === 0 ? 'Green Direto' : `Green no G${sinalPendente.tentativa}`;
                                analise = { 
                                    status: "GREEN CONFIRMADO", 
                                    sinal: `✅ ${tipoResultado}! (Número ${numeroSorteado})` 
                                };

                                historicoEstrategias.unshift({
                                    estrategia: sinalPendente.nomeEstrategia,
                                    resultado: 'GREEN',
                                    detalhe: tipoResultado,
                                    numero: numeroSorteado
                                });

                                sinalPendente = null; 
                            } else {
                                sinalPendente.tentativa++;

                                if (sinalPendente.tentativa > 2) {
                                    reds++; 
                                    analise = { 
                                        status: "SINAL FINALIZADO", 
                                        sinal: `❌ RED! Loss após 2 Gales. Aguardando novos padrões.` 
                                    };

                                    historicoEstrategias.unshift({
                                        estrategia: sinalPendente.nomeEstrategia,
                                        resultado: 'RED',
                                        detalhe: 'Loss (G2 falhou)',
                                        numero: numeroSorteado
                                    });

                                    sinalPendente = null; 
                                } else {
                                    analise = {
                                        status: "EM GALE",
                                        sinal: `⚠️ NÃO BATEU (${numeroSorteado}). Vamos para o GALE ${sinalPendente.tentativa} nas mesmas entradas!`
                                    };
                                }
                            }

                            if (historicoEstrategias.length > 10) historicoEstrategias.pop();

                        } else {
                            const resultadoEstrategia = analisarEstrategia(historicoRoleta);
                            analise.status = resultadoEstrategia.status;
                            analise.sinal = resultadoEstrategia.sinal;

                            if (resultadoEstrategia.status === "SINAL CONFIRMADO") {
                                sinalPendente = { 
                                    nomeEstrategia: resultadoEstrategia.nomeEstrategia,
                                    tipo: resultadoEstrategia.tipo, 
                                    alvos: resultadoEstrategia.alvos,
                                    tentativa: 0 
                                };
                            }
                        }

                        const totalSinaisAtuais = greens + reds;
                        const assertividadeAtual = totalSinaisAtuais > 0 ? ((greens / totalSinaisAtuais) * 100).toFixed(1) : "0.0";
                        const estatisticas = calcularEstatisticasPuxadas(historicoRoleta);

                        io.emit('atualizacao_sinal', {
                            numero: numeroSorteado,
                            historico: historicoRoleta,
                            status: analise.status,
                            sinal: analise.sinal,
                            greens: greens,
                            reds: reds,
                            assertividade: assertividadeAtual,
                            historicoEstrategias: historicoEstrategias,
                            estatisticasPuxadas: estatisticas
                        });
                    }
                }

                if (Date.now() - tempoUltimoGiro > 180000) {
                    console.log('[Robô] Forçando F5 de sincronia...');
                    await page.reload({ waitUntil: 'load' });
                    tempoUltimoGiro = Date.now();
                }

            } catch (erroLoop) {
                console.error('[Erro Loop]:', erroLoop);
            }
        }, 3000);

    } catch (erroGeral) {
        console.error('[Robô] Erro na inicialização:', erroGeral.message);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Painel comercial rodando na porta ${PORT}`);
    iniciarRoboDefinitivo();
});
