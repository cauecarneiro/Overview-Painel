'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Prazo = require('../../publico/prazo.js');

/* 10/10/2026 13:00 em São Paulo, o instante dos exemplos do card H1. */
const AGORA = 1791648000;
const FUSO = { fuso: 'America/Sao_Paulo' };

/* Uma janela de 5 horas (ou semanal) com u% usado e t% do período já decorrido. */
function janela(u, t, { tipo = '5h', provisorio = false, agora = AGORA } = {}) {
  const minutos = tipo === '5h' ? 300 : 10080;
  return { tipo, usado_pct: u, janela_min: minutos, renova_epoch: Math.round(agora + minutos * 60 * (1 - t / 100)), provisorio };
}

test('o gabarito do card: horário de "Deve durar até perto de", arredondado a 5 min', () => {
  const cinco = (u, t) => Prazo.descrever(janela(u, t), AGORA, FUSO);
  assert.equal(cinco(38, 30).prazo, 'Deve durar até perto de 15:25');   // 15:26:50 → 15:25
  assert.equal(cinco(60, 30).prazo, 'Deve durar até perto de 14:00');
  assert.equal(cinco(94, 80).prazo, 'Deve durar até perto de 13:15');   // 13:15:19
  assert.equal(cinco(38, 30).termina, 'O período de 5 horas termina em 3 h 30 min');
  assert.equal(cinco(46, 30).prazo, 'Deve durar até perto de 14:45');   // 14:45:39 → 14:45
  assert.equal(cinco(47, 30).prazo, 'Deve durar até perto de 14:40');   // 14:41:29 → 14:40
  const semana = Prazo.descrever(janela(38, 30, { tipo: 'semana' }), AGORA, FUSO);
  assert.equal(semana.termina, 'Termina em 4 d 21 h');
  assert.equal(semana.prazo, 'Deve durar até perto de ter, 23:15');
  assert.equal(semana.estado, 'em-curso');
});

test('uso igual ou menor que o tempo que passou: o horário é o do fim do período', () => {
  assert.equal(Prazo.descrever(janela(10, 60), AGORA, FUSO).prazo, 'Deve durar até perto de 15:00');
  assert.equal(Prazo.descrever(janela(40, 40), AGORA, FUSO).prazo, 'Deve durar até perto de 16:00');
});

test('o horário traz o dia da semana quando cai em outro dia', () => {
  const noite = AGORA + 9 * 3600;   // 22:00
  const d = Prazo.descrever(janela(38, 30, { agora: noite }), noite, FUSO);
  assert.equal(d.prazo, 'Deve durar até perto de dom, 00:25');
});

test('uso zero com prazo provisório: sem término, sem régua e sem duração', () => {
  const d = Prazo.descrever(janela(0, 0, { provisorio: true }), AGORA, FUSO);
  assert.deepEqual([d.estado, d.termina, d.prazo, d.tempo], ['sem-periodo', '', 'Ainda sem uso', null]);
});

test('menos de 10% do período com uso: é cedo; uso zero com período real não calcula duração', () => {
  const cedo = Prazo.descrever(janela(2, 2), AGORA, FUSO);
  assert.equal(cedo.prazo, 'É cedo para dizer até quando dura');
  assert.equal(cedo.termina, 'O período de 5 horas termina em 4 h 54 min');
  assert.equal(Math.round(cedo.tempo), 2);
  const zero = Prazo.descrever(janela(0, 20), AGORA, FUSO);
  assert.equal(zero.prazo, 'Sem uso para estimar a duração');
  assert.equal(zero.estado, 'em-curso');
});

test('período vencido ou leitura velha: dado anterior, sem prazo', () => {
  const vencida = Prazo.descrever(janela(38, 100), AGORA, FUSO);
  assert.deepEqual([vencida.estado, vencida.sufixo, vencida.termina, vencida.prazo, vencida.tempo],
    ['anterior', ' usado antes', 'Sem leitura atual deste período', 'Ainda não sabemos até quando dura', null]);
  const velha = Prazo.descrever(janela(38, 30), AGORA, { ...FUSO, velha: true });
  assert.equal(velha.estado, 'anterior');
  assert.equal(velha.sufixo, ' usado antes');
});

test('sem dado: uma frase só, no lugar certo de cada período', () => {
  const cinco = Prazo.descrever({ ...janela(null, 0), usado_pct: null, renova_epoch: null }, AGORA, FUSO);
  assert.deepEqual([cinco.estado, cinco.termina, cinco.prazo, cinco.usado], ['sem-dado', 'Sem dados por enquanto', '', null]);
  const semana = Prazo.descrever({ ...janela(null, 0, { tipo: 'semana' }), usado_pct: null, renova_epoch: null }, AGORA, FUSO);
  assert.deepEqual([semana.termina, semana.prazo], ['', 'Sem dados por enquanto']);
});

test('formato da duração: menos de 1 min, 40 min, 3 h 30 min, 4 d 21 h', () => {
  assert.equal(Prazo.duracao(0.4), 'menos de 1 min');
  assert.equal(Prazo.duracao(40), '40 min');
  assert.equal(Prazo.duracao(60), '1 h');
  assert.equal(Prazo.duracao(210), '3 h 30 min');
  assert.equal(Prazo.duracao(7020), '4 d 21 h');
  assert.equal(Prazo.duracao(1440), '1 d');
});

test('100% continua sendo uso observado, sem afirmar bloqueio nem renovação', () => {
  const d = Prazo.descrever(janela(100, 50), AGORA, FUSO);
  assert.equal(d.usado, 100);
  assert.equal(d.sufixo, ' usado');
  assert.equal(d.prazo, 'Deve durar até perto de 13:00');
  assert.equal(d.termina, 'O período de 5 horas termina em 2 h 30 min');
});

test('a idade da leitura: minutos, horas e dias, sem voltar no tempo', () => {
  assert.equal(Prazo.idade(0), 'há 0 min');
  assert.equal(Prazo.idade(59), 'há 0 min');
  assert.equal(Prazo.idade(60), 'há 1 min');
  assert.equal(Prazo.idade(59 * 60 + 59), 'há 59 min');
  assert.equal(Prazo.idade(3600), 'há 1 h');
  assert.equal(Prazo.idade(47 * 3600 + 3599), 'há 47 h');
  assert.equal(Prazo.idade(48 * 3600), 'há 2 dias');
  assert.equal(Prazo.idade(-30), 'há 0 min', 'relógio atrás da leitura não dá idade negativa');
});

test('o rótulo da leitura em dia: "agora" no primeiro minuto, depois a idade, sempre neutro', () => {
  assert.equal(Prazo.rotuloDaLeitura(0), 'Leitura agora');
  assert.equal(Prazo.rotuloDaLeitura(59), 'Leitura agora');
  assert.equal(Prazo.rotuloDaLeitura(-5), 'Leitura agora');
  assert.equal(Prazo.rotuloDaLeitura(60), 'Leitura há 1 min');
  assert.equal(Prazo.rotuloDaLeitura(20 * 60), 'Leitura há 20 min');
  assert.equal(Prazo.rotuloDaLeitura(2 * 3600), 'Leitura há 2 h');
  assert.doesNotMatch(Prazo.rotuloDaLeitura(900), /!|atrasad|vencid|expir/i, 'sem tom de alerta');
});

/* ---- os cortes da faixa de tempo: o dia (Semana) ou a hora (5 horas) em que cada um começa ---- */
test('cortes da Semana: sete, um por 24 h desde o início do período, rotulados pelo dia da semana em que começam', () => {
  const c = Prazo.cortes(janela(38, 30, { tipo: 'semana' }), FUSO);
  assert.deepEqual(c.map((x) => x.rotulo), ['qui', 'sex', 'sáb', 'dom', 'seg', 'ter', 'qua']);
  assert.ok(c.every((x, i) => i === 0 || x.inicio - c[i - 1].inicio === 86400), 'um corte a cada 24 h');
  assert.equal(c[0].inicio, Math.round(AGORA + 604800 * 0.7) - 604800, 'o primeiro começa com o período');
});

test('cortes das 5 horas: cinco, um por hora, rotulados pela hora do relógio em que começam, sem detalhe', () => {
  const c = Prazo.cortes(janela(38, 30), FUSO);
  assert.deepEqual(c.map((x) => x.rotulo), ['11:30', '12:30', '13:30', '14:30', '15:30']);
});

test('o rótulo é o dia em que o corte começa, não o dia que domina o corte (terça 23:15 → "ter" e depois "qua")', () => {
  const inicio = Date.UTC(2026, 9, 14, 2, 15) / 1000;   // ter 13/10/2026 23:15 em São Paulo
  const c = Prazo.cortes({ tipo: 'semana', janela_min: 10080, renova_epoch: inicio + 604800 }, FUSO);
  assert.deepEqual(c.slice(0, 2).map((x) => x.rotulo), ['ter', 'qua']);
});

test('sem período comprovado não há cortes', () => {
  assert.deepEqual(Prazo.cortes({ tipo: 'semana', janela_min: 10080, renova_epoch: null }), []);
  assert.deepEqual(Prazo.cortes({ tipo: '5h', janela_min: 0, renova_epoch: AGORA }), []);
  assert.deepEqual(Prazo.cortes({ tipo: '5h', janela_min: 300 }), []);
});

test('o corte da agulha: a faixa do percentual decorrido, travada nas pontas', () => {
  assert.equal(Prazo.corteAtual(0, 7), 0);
  assert.equal(Prazo.corteAtual(29.9, 7), 2);   // 29,9% de 7 cortes = 2,09
  assert.equal(Prazo.corteAtual(42.9, 7), 3);
  assert.equal(Prazo.corteAtual(99.99, 5), 4);
  assert.equal(Prazo.corteAtual(100, 5), 4, 'no fim fica no último corte');
  assert.equal(Prazo.corteAtual(null, 5), -1, 'sem tempo, nenhum corte é o atual');
});
